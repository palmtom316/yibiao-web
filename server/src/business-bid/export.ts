import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import archiver from 'archiver';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType } from 'docx';
import { createWorkspacePaths } from '../document/paths';
import { resolveInside } from '../security/files';
import { ApiError, requireKnowledgeAccess, requireProjectAccess } from '../security/access';
import { usableSnapshot, hashFile, type SnapshotFile } from './snapshots';
import { businessContext } from './store';
import { hashValue } from './sources';
import { exportQueue } from '../resources/queue';
import { sanitizeFilename } from '../export/format';
import type { JobUpdate } from '../jobs/service';

export const conclusionLabels: Record<string, string> = { candidate: '候选', pending: '待核验', confirmed: '已确认满足', partial: '部分满足', missing: '缺失', not_applicable: '不适用' };
async function checkRevision(prisma: PrismaClient, projectId: number, userId: number, revisionId: string, draft: boolean) {
  await requireProjectAccess(prisma, userId, projectId); await requireKnowledgeAccess(prisma, userId);
  const revision = await prisma.businessResponseRevision.findFirst({ where: { id: revisionId, projectId }, include: { snapshots: { orderBy: { snapshotId: 'asc' } } } });
  if (!revision) throw new ApiError(404, '商务响应版本不存在');
  if (!draft && revision.status !== 'ready') throw new ApiError(409, '存在待核验、部分满足或缺项，只能导出缺项草稿');
  const data = revision.data as any;
  if (hashValue(data) !== revision.hash) throw new ApiError(409, '响应版本校验失败');
  if (!draft) {
    const current = await businessContext(prisma, projectId);
    if (data.sourceHash !== current.sourceHash || data.sectionId !== current.sectionId || data.referenceDate !== (current.project.bidDeadline?.toISOString().slice(0, 10) || null)) throw new ApiError(409, '招标来源、标段或核验日期变化，请复核并创建新响应版本');
  }
  if (!draft) {
    const active = await prisma.businessRequirement.findMany({ where: { projectId, active: true }, select: { id: true, version: true } });
    if (active.length !== data.requirements.length || active.some((row) => !data.requirements.some((saved: any) => saved.id === row.id && saved.version === row.version))) throw new ApiError(409, '商务要求或结论已更新，请创建新的响应版本');
  }
  for (const link of revision.snapshots) await usableSnapshot(prisma, link.snapshotId, projectId, userId, !draft);
  return revision;
}
function responseDocument(data: any, revision: number, draft: boolean, warnings: string[]) {
  const cell = (value: unknown) => new TableCell({ children: [new Paragraph(String(value ?? ''))] });
  return new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: `${draft ? '【缺项草稿·不可用于正式投标】' : ''}${data.projectName} 商务响应清单`, bold: true, size: 32 })] }),
    new Paragraph(`响应版本：${revision}；核验日期：${data.referenceDate || '未设置'}；标段：${data.sectionId || '全项目'}`),
    ...warnings.map((warning) => new Paragraph(`警告：${warning}`)),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: ['序号', '要求原文', '人工结论', '核验说明', '原文位置'].map(cell) }),
      ...data.requirements.map((row: any, index: number) => new TableRow({ children: [index + 1, row.rawText, conclusionLabels[row.conclusion] || '待核验', row.reason, row.sourceLocator].map(cell) })),
    ] }),
  ] }] });
}
export async function createBusinessPackage(prisma: PrismaClient, projectId: number, userId: number, revisionId: string, draft: boolean, update: JobUpdate = async () => {}, signal?: AbortSignal) {
  return exportQueue.run(async () => {
    signal?.throwIfAborted(); await update('running', 5);
    const revision = await checkRevision(prisma, projectId, userId, revisionId, draft);
    const workspace = createWorkspacePaths(projectId).workspaceDir;
    const existing = await prisma.businessPackage.findUnique({ where: { revisionId_draft: { revisionId, draft } } });
    if (existing?.status === 'ready' && existing.relativePath) {
      try { if (await hashFile(resolveInside(workspace, existing.relativePath)) === existing.sha256) return { packageId: existing.id, draft }; } catch { /* recreate from immutable snapshots */ }
    }
    const item = await prisma.businessPackage.upsert({ where: { revisionId_draft: { revisionId, draft } }, update: { status: 'staging' }, create: { projectId, revisionId, draft } });
    const stagingRelative = `business-packages/.staging-${randomUUID()}`; const staging = resolveInside(workspace, stagingRelative, false);
    const finalRelative = `business-packages/${item.id}`; const target = resolveInside(workspace, finalRelative, false);
    let published = false;
    try {
      await fsp.mkdir(staging, { recursive: true, mode: 0o700 });
      const warnings: string[] = []; const attachments: Array<Record<string, any>> = [];
      for (const link of revision.snapshots) {
        const snapshot = await usableSnapshot(prisma, link.snapshotId, projectId, userId);
        for (const file of snapshot.files as unknown as SnapshotFile[]) {
          signal?.throwIfAborted();
          try {
            const input = resolveInside(workspace, file.relativePath);
            if (await hashFile(input) !== file.sha256) throw new Error('hash mismatch');
            attachments.push({ path: `附件/${String(attachments.length + 1).padStart(3, '0')}-${sanitizeFilename(file.originalName)}`, originalName: file.originalName, snapshotId: snapshot.id, sourceType: file.sourceType, sourceId: file.sourceId, sha256: file.sha256, size: file.size, input });
          } catch { if (!draft) throw new ApiError(409, `缺少有效附件：${file.originalName}`); warnings.push(`缺少附件：${file.originalName}`); }
        }
      }
      const data = revision.data as any;
      if (draft) warnings.unshift('本文件为缺项草稿，尚未完成的核验不得视为满足资格');
      const word = await Packer.toBuffer(responseDocument(data, revision.revision, draft, warnings));
      const wordName = draft ? '缺项草稿-商务响应清单.docx' : '商务响应清单.docx';
      const wordPath = path.join(staging, wordName); await fsp.writeFile(wordPath, word, { mode: 0o600 });
      const manifest = { formatVersion: 1, projectId, revisionId, revision: revision.revision, revisionHash: revision.hash, draft, warnings,
        requirements: data.requirements.map((row: any) => ({ requirementId: row.id, conclusion: row.conclusion, sourceSnapshotId: row.snapshotId })),
        word: { path: wordName, sha256: await hashFile(wordPath) }, files: attachments.map(({ input, ...file }) => file) };
      await fsp.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      await update('running', 30);
      const archive = archiver('zip', { zlib: { level: 5 }, forceZip64: true });
      const zipPath = path.join(staging, '原件包.zip');
      const output = fs.createWriteStream(zipPath, { flags: 'wx', mode: 0o600 });
      await new Promise<void>((resolve, reject) => {
        const abort = () => { archive.abort(); output.destroy(new Error('出包已取消')); };
        signal?.addEventListener('abort', abort, { once: true });
        output.on('close', () => { signal?.removeEventListener('abort', abort); resolve(); }); output.on('error', reject); archive.on('error', reject);
        archive.pipe(output); archive.file(wordPath, { name: wordName }); archive.file(path.join(staging, 'manifest.json'), { name: 'manifest.json' });
        for (const attachment of attachments) archive.file(attachment.input, { name: attachment.path });
        void archive.finalize().catch(reject);
      });
      signal?.throwIfAborted();
      await checkRevision(prisma, projectId, userId, revisionId, draft);
      await update('running', 95);
      const hash = await hashFile(zipPath); const wordHash = await hashFile(wordPath);
      // Only a prior failed/stale artifact is replaced; response and snapshot records are immutable.
      if (existing) { try { await fsp.rename(target, `${target}-history-${randomUUID()}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      await fsp.rename(staging, target); published = true;
      await prisma.businessPackage.update({ where: { id: item.id }, data: { status: 'ready', relativePath: `${finalRelative}/原件包.zip`, wordPath: `${finalRelative}/${wordName}`, sha256: hash, wordHash, manifest: manifest as unknown as Prisma.InputJsonValue } });
      return { packageId: item.id, draft, warnings };
    } catch (error) {
      await prisma.businessPackage.update({ where: { id: item.id }, data: { status: 'error' } });
      if (published) await fsp.rm(target, { recursive: true, force: true });
      throw error instanceof ApiError ? error : new ApiError(422, '出包失败，已确认版本和原件保留，可重试');
    } finally { await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined); }
  }, () => { void update('queued', 0).catch(() => undefined); });
}
export async function packageFile(prisma: PrismaClient, projectId: number, userId: number, id: string, word: boolean) {
  const item = await prisma.businessPackage.findFirst({ where: { id, projectId } });
  if (!item || item.status !== 'ready') throw new ApiError(404, '出包尚未完成或不存在');
  await checkRevision(prisma, projectId, userId, item.revisionId, item.draft);
  const relative = word ? item.wordPath : item.relativePath;
  if (!relative) throw new ApiError(409, '产物缺失，请重新出包');
  const file = resolveInside(createWorkspacePaths(projectId).workspaceDir, relative);
  if (await hashFile(file) !== (word ? item.wordHash : item.sha256)) throw new ApiError(409, '产物校验失败，请重新出包');
  return { file, filename: word ? path.basename(file) : `${item.draft ? '缺项草稿-' : ''}商务响应原件包.zip` };
}
