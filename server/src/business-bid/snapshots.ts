import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type ProjectReferenceSnapshot } from '@prisma/client';
import { businessSource, hashValue, type Provenance } from './sources';
import { requireKnowledgeAccess, requireProjectAccess, ApiError } from '../security/access';
import { assertNotRevoked } from '../ledger/lifecycle';
import { getDataDir, createWorkspacePaths } from '../document/paths';
import { resolveInside } from '../security/files';
import { sanitizeFilename } from '../export/format';

export interface SnapshotFile { id: string; originalName: string; filename: string; mimeType: string; size: number; sha256: string; relativePath: string; sourceType: string; sourceId: string; sourceFileId: string }
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
// 行锁需要 raw SQL（FOR SHARE），但表名只能来自下方闭集映射；
// 闭集缺失的类型会在打进 SQL 之前先被 400 拒绝，ID 一律走参数绑定。
const LOCK_TABLES = {
  asset: 'asset_items',
  certificate: 'personnel_certificates',
  personnel: 'personnel_profiles',
  performance: 'performance_records',
  'knowledge-document': 'knowledge_documents',
} as const satisfies Record<string, string>;

async function lockSourceVersions(tx: Prisma.TransactionClient, provenance: Provenance[]) {
  for (const source of provenance) {
    let rows: Array<{ version: number }>;
    if (source.type === 'knowledge-item') {
      const [documentId, itemId] = source.id.split('::');
      rows = await tx.$queryRaw`SELECT version FROM knowledge_items WHERE "documentId"=${documentId} AND "itemId"=${itemId} FOR SHARE`;
    } else {
      const table = (LOCK_TABLES as Record<string, string | undefined>)[source.type]; if (!table) throw new ApiError(400, '引用来源类型无效');
      const key = source.type === 'knowledge-document' ? 'documentId' : 'id';
      rows = await tx.$queryRaw(Prisma.sql`SELECT version FROM ${Prisma.raw(table)} WHERE ${Prisma.raw(`"${key}"`)}=${source.id} FOR SHARE`);
    }
    if (rows[0]?.version !== source.version) throw new ApiError(409, '引用资料在复制期间发生变化，请重新核验');
    await assertNotRevoked(tx, source.type, source.id, source.version);
  }
}
export async function createReferenceSnapshot(prisma: PrismaClient, options: { projectId: number; userId: number; type: string; id: string; version: number; fingerprint: string; refreshOfId?: string }) {
  await requireProjectAccess(prisma, options.userId, options.projectId); await requireKnowledgeAccess(prisma, options.userId);
  const source = await businessSource(prisma, options.type, options.id);
  if (!source.allowed) throw new ApiError(409, source.issues.join('；'));
  if (source.version !== options.version || source.fingerprint !== options.fingerprint) throw new ApiError(409, '候选资料已变化，请刷新后重新核验');
  if (options.refreshOfId && !await prisma.projectReferenceSnapshot.findFirst({ where: { id: options.refreshOfId, projectId: options.projectId } })) throw new ApiError(403, '旧引用不属于当前项目');
  const snapshot = await prisma.projectReferenceSnapshot.create({ data: {
    projectId: options.projectId, sourceType: source.type, sourceId: source.id, sourceVersion: source.version, sourceHash: source.fingerprint,
    data: JSON.parse(JSON.stringify({ title: source.title, ...source.data })), provenance: source.provenance as unknown as Prisma.InputJsonValue,
    allowedUses: ['business-attachments', 'technical-facts', 'technical-narrative'], confirmedByUserId: options.userId, refreshOfId: options.refreshOfId,
  } });
  const workspace = createWorkspacePaths(options.projectId).workspaceDir;
  const stagingRelative = `references/.staging-${snapshot.id}`;
  const finalRelative = `references/${snapshot.id}`;
  const staging = resolveInside(workspace, stagingRelative, false); const target = resolveInside(workspace, finalRelative, false);
  let published = false; let ready = false;
  try {
    await fsp.mkdir(staging, { recursive: true, mode: 0o700 });
    const files: SnapshotFile[] = []; let total = 0;
    for (const [index, file] of source.files.entries()) {
      const input = resolveInside(getDataDir(), path.relative(getDataDir(), file.path));
      const stat = await fsp.stat(input); total += stat.size;
      if (!stat.isFile() || stat.size > 100 * 1024 * 1024 || total > 1024 * 1024 * 1024) throw new ApiError(422, '引用附件超出单文件 100 MiB / 总计 1 GiB 限制');
      const filename = `${String(index + 1).padStart(3, '0')}-${sanitizeFilename(file.originalName)}`;
      const dest = resolveInside(staging, filename, false);
      await fsp.copyFile(input, dest, fs.constants.COPYFILE_EXCL);
      const digest = await hashFile(dest);
      if ((file.sha256 && file.sha256 !== digest) || await hashFile(input) !== digest) throw new ApiError(409, '引用原件校验失败或复制期间被替换');
      files.push({ id: randomUUID(), originalName: file.originalName, filename, mimeType: file.mimeType, size: stat.size, sha256: digest, relativePath: `${finalRelative}/${filename}`, sourceType: file.ownerType, sourceId: file.ownerId, sourceFileId: file.fileId });
    }
    await fsp.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ snapshotId: snapshot.id, projectId: options.projectId, sourceHash: source.fingerprint, files }), { mode: 0o600 });
    if ((await businessSource(prisma, source.type, source.id)).fingerprint !== source.fingerprint) throw new ApiError(409, '引用来源版本变化，请重新确认');
    await fsp.rename(staging, target); published = true;
    const result = await prisma.$transaction(async (tx) => {
      await lockSourceVersions(tx, source.provenance);
      const snapshotData = JSON.parse(JSON.stringify({ title: source.title, ...source.data }));
      const imageFiles = files.filter((file) => file.sourceType === 'document-asset');
      for (const file of imageFiles) snapshotData.narrative = String(snapshotData.narrative || '').split(`yibiao-asset://${file.sourceId}`).join(`yibiao-asset://${file.id}`);
      await tx.documentAsset.createMany({ data: imageFiles.map((file) => ({ id: file.id, projectId: options.projectId, referenceSnapshotId: snapshot.id, kind: 'reference', mimeType: file.mimeType, size: file.size, sha256: file.sha256, relativePath: `${options.projectId}/workspace/${file.relativePath}` })) });
      await requireKnowledgeAccess(tx, options.userId); await requireProjectAccess(tx, options.userId, options.projectId);
      return tx.projectReferenceSnapshot.update({ where: { id: snapshot.id }, data: { status: 'ready', data: snapshotData, files: files as unknown as Prisma.InputJsonValue, sourceHash: hashValue({ fingerprint: source.fingerprint, files: files.map((file) => ({ sha256: file.sha256, filename: file.filename })) }) } });
    });
    ready = true; return result;
  } catch (error) {
    await prisma.projectReferenceSnapshot.update({ where: { id: snapshot.id }, data: { status: 'error', error: error instanceof ApiError ? error.message : '原件复制失败，可重新确认引用' } });
    throw error;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (published && !ready) await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined);
  }
}
export async function usableSnapshot(prisma: PrismaClient, id: string, projectId: number, userId: number, verifyFiles = false) {
  await requireProjectAccess(prisma, userId, projectId); await requireKnowledgeAccess(prisma, userId);
  const snapshot = await prisma.projectReferenceSnapshot.findFirst({ where: { id, projectId } });
  if (!snapshot) throw new ApiError(404, '引用版本不存在');
  if (snapshot.status !== 'ready') throw new ApiError(409, '引用版本尚未就绪');
  for (const origin of snapshot.provenance as unknown as Provenance[]) await assertNotRevoked(prisma, origin.type, origin.id, origin.version);
  if (verifyFiles) for (const file of snapshot.files as unknown as SnapshotFile[]) {
    let actual: string;
    try { actual = await hashFile(resolveInside(createWorkspacePaths(projectId).workspaceDir, file.relativePath)); }
    catch { throw new ApiError(409, `引用附件缺失：${file.originalName}`); }
    if (actual !== file.sha256) throw new ApiError(409, `引用附件校验失败：${file.originalName}`);
  }
  return snapshot;
}
export function snapshotDto(snapshot: ProjectReferenceSnapshot) {
  return { ...snapshot, files: (snapshot.files as unknown as SnapshotFile[]).map(({ relativePath, ...file }) => file) };
}

export async function snapshotHistory(prisma: PrismaClient, projectId: number, userId: number) {
  await requireProjectAccess(prisma, userId, projectId); await requireKnowledgeAccess(prisma, userId);
  const snapshots = await prisma.projectReferenceSnapshot.findMany({ where: { projectId }, orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }], take: 100 });
  const origins = [...new Map(snapshots.flatMap((snapshot) => snapshot.provenance as unknown as Provenance[]).map((o) => [`${o.type}:${o.id}`, o])).values()];
  const ids = (type: string) => origins.filter((o) => o.type === type).map((o) => o.id);
  const [assets, certificates, people, performances, documents, items, revocations] = await Promise.all([
    prisma.assetItem.findMany({ where: { id: { in: ids('asset') } }, select: { id: true, version: true, archivedAt: true } }),
    prisma.personnelCertificate.findMany({ where: { id: { in: ids('certificate') } }, select: { id: true, version: true, archivedAt: true } }),
    prisma.personnelProfile.findMany({ where: { id: { in: ids('personnel') } }, select: { id: true, version: true, archivedAt: true } }),
    prisma.performanceRecord.findMany({ where: { id: { in: ids('performance') } }, select: { id: true, version: true, archivedAt: true } }),
    prisma.knowledgeDocument.findMany({ where: { documentId: { in: ids('knowledge-document') } }, select: { documentId: true, version: true, archivedAt: true } }),
    prisma.knowledgeItem.findMany({ where: { OR: ids('knowledge-item').map((id) => { const [documentId, itemId] = id.split('::'); return { documentId, itemId }; }) }, select: { documentId: true, itemId: true, version: true, archivedAt: true } }),
    prisma.referenceRevocation.findMany({ where: { OR: origins.map((o) => ({ sourceType: o.type, sourceId: o.id })) } }),
  ]);
  const current = new Map<string, { version: number; archivedAt: Date | null }>();
  for (const [type, rows] of [['asset', assets], ['certificate', certificates], ['personnel', people], ['performance', performances]] as const) for (const row of rows) current.set(`${type}:${row.id}`, row);
  for (const row of documents) current.set(`knowledge-document:${row.documentId}`, row);
  for (const row of items) current.set(`knowledge-item:${row.documentId}::${row.itemId}`, row);
  return snapshots.map((snapshot) => {
    const provenance = snapshot.provenance as unknown as Provenance[];
    const missing = provenance.some((o) => !current.has(`${o.type}:${o.id}`));
    const archived = provenance.some((o) => current.get(`${o.type}:${o.id}`)?.archivedAt);
    const changed = provenance.some((o) => current.get(`${o.type}:${o.id}`)?.version !== o.version);
    const revoked = provenance.some((o) => revocations.some((r) => r.sourceType === o.type && r.sourceId === o.id && r.throughVersion >= o.version));
    return { ...snapshotDto(snapshot), sourceStatus: missing ? 'missing' : archived ? 'archived' : changed ? 'changed' : 'current', revoked };
  });
}
