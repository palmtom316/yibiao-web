import type { Database } from '../security/access';
import { ApiError } from '../security/access';
export async function assertSourceUnlinked(db: Database, type: string, id: string) {
  const links = type === 'asset' ? await db.performanceAsset.findMany({ where: { assetItemId: id }, include: { record: true } })
    : type === 'personnel' ? await db.performanceTeamMember.findMany({ where: { profileId: id }, include: { record: true } })
      : await db.performanceKnowledgeDocument.findMany({ where: { documentId: id }, include: { record: true } });
  if (links.length) throw new ApiError(409, `资料仍被业绩档案引用，请先解除关联：${[...new Set(links.map((link) => link.record.title))].join('、')}`, links.map((link) => ({ id: link.recordId, title: link.record.title })));
}
export async function audit(db: Database, sourceType: string, sourceId: string, action: string, version: number, actorUserId?: number, detail: object = {}) {
  await db.auditEvent.create({ data: { sourceType, sourceId, action, version, actorUserId, detail: JSON.parse(JSON.stringify(detail)) } });
}
export async function assertKnowledgeCitable(db: Database, documentIds: string[]) {
  if (!documentIds.length) return;
  const restrictions = await db.knowledgeUseRestriction.findMany({ where: { documentId: { in: documentIds } } });
  for (const restriction of restrictions) {
    const record = await db.performanceRecord.findUnique({ where: { id: restriction.performanceSourceId } });
    if (!record || !record.isPubliclyCitable || record.archivedAt) throw new ApiError(403, '知识资料的来源业绩未许可、已归档或缺失，不可对外引用');
  }
  const restricted = await db.performanceKnowledgeDocument.findFirst({ where: { documentId: { in: documentIds }, record: { isPubliclyCitable: false } }, include: { record: true } });
  if (restricted) throw new ApiError(403, '关联业绩未允许对外引用，不可用于生成或导出');
}
export async function assertNotRevoked(db: Database, sourceType: string, sourceId: string, version: number) {
  if (await db.referenceRevocation.findFirst({ where: { sourceType, sourceId, throughVersion: { gte: version } } })) throw new ApiError(409, '该资料版本已撤销对外引用，请重新核验');
}
