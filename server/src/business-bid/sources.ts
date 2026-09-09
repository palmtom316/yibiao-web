import path from 'node:path';
import { assertKnowledgeCitable } from '../ledger/lifecycle';
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { getAssetFilePath, getPersonnelCertFile, getDataDir } from '../document/paths';
import { ApiError } from '../security/access';
import { createPerformanceStore } from '../performance/store';

export interface Provenance { type: string; id: string; version: number }
export interface SourceFile { originalName: string; mimeType: string; size: number; path: string; sha256?: string; fileId: string; ownerType: string; ownerId: string }
export interface BusinessSource { type: string; id: string; version: number; title: string; data: Record<string, any>; files: SourceFile[]; provenance: Provenance[]; allowed: boolean; issues: string[]; fingerprint: string }
export function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value instanceof Date ? value.toISOString() : value) ?? 'null';
}
export function hashValue(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
const certificateFields = (row: any) => ({ name: row.name || row.certName, category: row.category || row.certType, certificateNo: row.certificateNo, qualificationLevel: row.qualificationLevel, holderName: row.holderName || row.profile?.name,
  issuer: row.issuer, validFrom: row.validFrom, validityKind: row.validityKind, expiryDate: row.expiryDate });

export async function businessSource(prisma: PrismaClient, type: string, id: string): Promise<BusinessSource> {
  const provenance: Provenance[] = []; const files: SourceFile[] = []; const issues: string[] = [];
  let version: number; let title: string; let data: Record<string, any>; let allowed = true;
  async function asset(row: any) {
    provenance.push({ type: 'asset', id: row.id, version: row.version });
    if (row.archivedAt || row.library !== 'company') { allowed = false; issues.push('原件资料已归档或不属于公司库'); }
    const related = await prisma.performanceAsset.findMany({ where: { assetItemId: row.id }, include: { record: true } });
    for (const link of related) {
      provenance.push({ type: 'performance', id: link.record.id, version: link.record.version });
      if (!link.record.isPubliclyCitable) { allowed = false; issues.push('原件关联的业绩尚未允许对外引用'); }
    }
    for (const file of Array.isArray(row.files) ? row.files : []) files.push({ ...file, path: getAssetFilePath(undefined, row.library, row.id, file.fileId, file.ext), ownerType: 'asset', ownerId: row.id });
  }
  function certificate(row: any, profile: any) {
    provenance.push({ type: 'certificate', id: row.id, version: row.version }, { type: 'personnel', id: profile.id, version: profile.version });
    if (row.archivedAt || profile.archivedAt) { allowed = false; issues.push('人员或证书已归档'); }
    for (const file of Array.isArray(row.files) ? row.files : []) files.push({ ...file, path: getPersonnelCertFile(undefined, profile.id, row.id, file.fileId, file.ext), ownerType: 'certificate', ownerId: row.id });
  }
  if (type === 'asset') {
    const row = await prisma.assetItem.findUnique({ where: { id } }); if (!row) throw new ApiError(404, '公司资料不存在');
    version = row.version; title = row.name; data = { fields: certificateFields(row), narrative: '' }; await asset(row);
  } else if (type === 'certificate') {
    const row = await prisma.personnelCertificate.findUnique({ where: { id }, include: { profile: true } }); if (!row) throw new ApiError(404, '人员证书不存在');
    version = row.version; title = `${row.profile.name} · ${row.certName}`; data = { fields: certificateFields(row), narrative: '', team: [{ name: row.profile.name, certificates: [certificateFields(row)] }] }; certificate(row, row.profile);
  } else if (type === 'performance') {
    const row = await createPerformanceStore(prisma).get(id);
    version = row.version; title = row.title; provenance.push({ type, id, version });
    if (!row.isPubliclyCitable || row.archivedAt) { allowed = false; issues.push(row.archivedAt ? '业绩已归档' : '业绩未允许对外引用'); }
    for (const link of row.assets) await asset(link.asset);
    const text = [row.summary];
    for (const link of row.documents) {
      provenance.push({ type: 'knowledge-document', id: link.documentId, version: link.document.version });
      if (link.document.archivedAt || link.document.status !== 'success') { allowed = false; issues.push('关联知识文档尚未完成或已归档'); }
    }
    try { await assertKnowledgeCitable(prisma, row.documents.map((link: any) => link.documentId)); } catch { allowed = false; issues.push('叙述的来源业绩未允许引用'); }
    for (const link of row.items) {
      provenance.push({ type: 'knowledge-item', id: `${link.documentId}::${link.itemId}`, version: link.item.version });
      if (link.item.archivedAt) { allowed = false; issues.push('关联知识条目已归档'); }
      text.push(link.item.content);
    }
    const team = row.team.map((member: any) => {
      if (member.profile.archivedAt) { allowed = false; issues.push('关联人员已归档'); }
      provenance.push({ type: 'personnel', id: member.profileId, version: member.profile.version });
      const certs = member.profile.certificates.filter((c: any) => !c.archivedAt);
      certs.forEach((c: any) => certificate(c, member.profile));
      return { name: member.profile.name, role: member.role, certificates: certs.map(certificateFields) };
    });
    const narrative = text.filter(Boolean).join('\n\n');
    const imageIds = [...new Set([...narrative.matchAll(/yibiao-asset:\/\/([a-z0-9-]+)/gi)].map((match) => match[1]))];
    for (const [index, imageId] of imageIds.entries()) {
      const image = await prisma.documentAsset.findUnique({ where: { id: imageId }, include: { parse: true } });
      if (!image || !image.knowledgeDocumentId || !row.documents.some((link: any) => link.documentId === image.knowledgeDocumentId) || (image.parse && image.parse.status !== 'success')) {
        allowed = false; issues.push('叙述中存在未授权或缺失的图片'); continue;
      }
      files.push({ originalName: `叙述图片-${index + 1}.png`, fileId: image.id, mimeType: image.mimeType, size: image.size, sha256: image.sha256, path: path.join(getDataDir(), image.relativePath), ownerType: 'document-asset', ownerId: image.id });
    }
    data = { fields: { title, ownerName: row.ownerName, location: row.location, contractAmount: row.contractAmount, currency: row.currency, contractSignedAt: row.contractSignedAt, startedAt: row.startedAt, completedAt: row.completedAt, projectType: row.projectType }, narrative, team };
  } else throw new ApiError(400, '候选资料类型无效');
  const uniqueProvenance = [...new Map(provenance.map((value) => [`${value.type}:${value.id}:${value.version}`, value])).values()].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  const uniqueFiles = [...new Map(files.map((file) => [`${file.ownerType}:${file.ownerId}:${file.fileId}`, file])).values()].sort((a, b) => `${a.ownerType}:${a.ownerId}:${a.fileId}`.localeCompare(`${b.ownerType}:${b.ownerId}:${b.fileId}`));
  const fingerprint = hashValue({ type, id, version, data, provenance: uniqueProvenance, files: uniqueFiles.map(({ path, ...file }) => file), allowed });
  return { type, id, version, title, data, provenance: uniqueProvenance, files: uniqueFiles, allowed, issues: [...new Set(issues)], fingerprint };
}
export function sourceCandidateDto(source: BusinessSource) {
  return { type: source.type, id: source.id, version: source.version, title: source.title, fields: source.data.fields, team: source.data.team, allowed: source.allowed, issues: source.issues, fingerprint: source.fingerprint,
    files: source.files.map(({ path, ...file }) => file) };
}
