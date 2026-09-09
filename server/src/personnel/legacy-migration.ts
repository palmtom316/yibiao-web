import { resolveInside } from '../security/files';
import { getDataDir } from '../document/paths';
import type { PrismaClient, Prisma } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAssetFilePath, getPersonnelCertFile } from '../document/paths';
import { hashFile } from '../business-bid/snapshots';
import { hashValue } from '../business-bid/sources';
import { ApiError, requireKnowledgeAccess } from '../security/access';
import { audit } from '../ledger/lifecycle';

export interface LegacyMapping { profileId?: string; newName?: string; certName: string; certType?: string }
export async function migrateLegacyPersonnel(prisma: PrismaClient, mappings: Record<string, LegacyMapping>, actorId: number, apply = false) {
  await requireKnowledgeAccess(prisma, actorId);
  const rows = await prisma.assetItem.findMany({ where: { library: 'personnel' }, orderBy: { id: 'asc' } });
  const report: Array<Record<string, any>> = [];
  for (const source of rows) {
    const files = Array.isArray(source.files) ? source.files as any[] : [];
    const hashes = [];
    if (files.some((file) => !/^[a-zA-Z0-9_-]+$/.test(file.fileId) || !/^(?:\.[a-z0-9]{1,12})?$/i.test(file.ext))) { report.push({ sourceId: source.id, status: 'conflict', reason: '旧文件清单格式无效', fileCount: files.length }); continue; }
    try { for (const file of files) hashes.push({ fileId: file.fileId, originalName: file.originalName, sha256: await hashFile(resolveInside(getDataDir(), path.relative(getDataDir(), getAssetFilePath(undefined, 'personnel', source.id, file.fileId, file.ext)))) }); }
    catch { report.push({ sourceId: source.id, status: 'conflict', reason: '原件缺失或不可读', fileCount: files.length }); continue; }
    const sourceHash = hashValue({ id: source.id, name: source.name, expiryDate: source.expiryDate, notes: source.notes, files: hashes });
    const existing = await prisma.legacyPersonnelMigration.findUnique({ where: { sourceId: source.id } });
    if (existing) {
      report.push({ sourceId: source.id, profileId: existing.profileId, certificateId: existing.certificateId, status: existing.sourceHash === sourceHash ? 'already-migrated' : 'conflict', reason: existing.sourceHash === sourceHash ? undefined : '源资料已变化，需人工处理', fileCount: files.length, files: hashes }); continue;
    }
    const mapping = mappings[source.id];
    if (!mapping || (!mapping.profileId && !mapping.newName?.trim()) || !mapping.certName?.trim()) { report.push({ sourceId: source.id, sourceName: source.name, status: 'pending-mapping', fileCount: files.length, files: hashes }); continue; }
    if (mapping.profileId && !await prisma.personnelProfile.findFirst({ where: { id: mapping.profileId, archivedAt: null } })) { report.push({ sourceId: source.id, status: 'conflict', reason: '指定人员不存在或已归档', fileCount: files.length }); continue; }
    // Never infer identity from duplicate names. Each source gets its own profile unless explicitly mapped.
    const profileId = mapping.profileId || `legacy-person-${hashValue(source.id).slice(0, 24)}`;
    const certificateId = `legacy-cert-${hashValue(source.id).slice(0, 24)}`;
    const plan = { sourceId: source.id, profileId, certificateId, status: apply ? 'migrated' : 'planned', fileCount: files.length, files: hashes };
    if (!apply) { report.push(plan); continue; }
    const targetRoot = path.dirname(getPersonnelCertFile(undefined, profileId, certificateId, 'placeholder', ''));
    const staging = `${targetRoot}.staging-${randomUUID()}`; let published = false;
    try {
      await fs.mkdir(staging, { recursive: true, mode: 0o700 });
      const copied: any[] = [];
      for (const [index, file] of files.entries()) {
        const fileId = randomUUID(); const target = path.join(staging, `${fileId}${file.ext}`);
        await fs.copyFile(resolveInside(getDataDir(), path.relative(getDataDir(), getAssetFilePath(undefined, 'personnel', source.id, file.fileId, file.ext))), target);
        if (await hashFile(target) !== hashes[index].sha256) throw new ApiError(409, '迁移原件校验失败');
        copied.push({ ...file, fileId, sha256: hashes[index].sha256 });
      }
      await fs.writeFile(path.join(staging, 'migration-manifest.json'), JSON.stringify({ ...plan, sourceHash, files: copied }), { mode: 0o600 });
      await fs.rename(staging, targetRoot); published = true;
      await prisma.$transaction(async (tx) => {
        if (!mapping.profileId) await tx.personnelProfile.create({ data: { id: profileId, name: mapping.newName!.trim(), createdByUserId: actorId, updatedByUserId: actorId } });
        await tx.personnelCertificate.create({ data: { id: certificateId, profileId, certName: mapping.certName.trim(), certType: mapping.certType || '', notes: source.notes,
          validityKind: source.expiryDate ? 'dated' : 'unknown', expiryDate: source.expiryDate, files: copied as Prisma.InputJsonValue, createdByUserId: actorId, updatedByUserId: actorId } });
        await tx.legacyPersonnelMigration.create({ data: { sourceId: source.id, profileId, certificateId, sourceHash, files: copied as Prisma.InputJsonValue, migratedByUserId: actorId } });
        await audit(tx, 'legacy-personnel', source.id, 'migrate', source.version, actorId, { profileId, certificateId, sourceHash });
      });
      report.push(plan);
    } catch (error) {
      if (published) await fs.rm(targetRoot, { recursive: true, force: true });
      report.push({ ...plan, status: 'conflict', reason: error instanceof ApiError ? error.message : '迁移失败；旧资料与原件保留' });
    } finally { await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined); }
  }
  const counts = Object.fromEntries(['planned', 'migrated', 'already-migrated', 'conflict', 'pending-mapping'].map((status) => [status, report.filter((row) => row.status === status).length]));
  return { apply, total: rows.length, counts, items: report };
}
