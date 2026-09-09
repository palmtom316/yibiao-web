import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../security/access';
import { decimalAmount, expectedVersion, parseDate } from '../ledger/validation';
import { audit } from '../ledger/lifecycle';

const include = {
  assets: { include: { asset: true } },
  documents: { include: { document: { select: { documentId: true, fileName: true, version: true, status: true, archivedAt: true } } } },
  items: { include: { item: true } },
  team: { include: { profile: { include: { certificates: true } } } },
} as const;
export type PerformanceDetail = Prisma.PerformanceRecordGetPayload<{ include: typeof include }>;
function dto(row: PerformanceDetail) { return JSON.parse(JSON.stringify({ ...row, contractAmount: row.contractAmount?.toFixed(2) ?? null })); }
function fields(input: Record<string, unknown>, creating = false) {
  const out: Record<string, any> = {};
  for (const key of ['title', 'ownerName', 'location', 'durationText', 'roleText', 'projectType', 'summary', 'notes', 'currency']) {
    if (input[key] !== undefined) { if (typeof input[key] !== 'string') throw new ApiError(400, '业绩字段应为文字'); out[key] = (input[key] as string).trim(); }
  }
  if ((creating || out.title !== undefined) && !out.title) throw new ApiError(400, '请填写业绩名称');
  if (out.title?.length > 200 || out.summary?.length > 50000 || out.notes?.length > 50000) throw new ApiError(400, '业绩文字超过长度限制');
  if (input.contractAmount !== undefined) out.contractAmount = decimalAmount(input.contractAmount);
  for (const key of ['contractSignedAt', 'startedAt', 'completedAt']) if (input[key] !== undefined) out[key] = parseDate(input[key], key);
  if (out.startedAt && out.completedAt && out.startedAt > out.completedAt) throw new ApiError(400, '结束日期不得早于开始日期');
  if (input.isPubliclyCitable !== undefined) { if (typeof input.isPubliclyCitable !== 'boolean') throw new ApiError(400, '引用许可必须明确选择'); out.isPubliclyCitable = input.isPubliclyCitable; }
  if (input.tags !== undefined) { if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string')) throw new ApiError(400, '标签必须是文字列表'); out.tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 50); }
  if (out.currency && !/^[A-Z]{3}$/.test(out.currency)) throw new ApiError(400, '币种应为三位代码，例如 CNY');
  return out;
}
async function replaceLinks(tx: Prisma.TransactionClient, id: string, input: Record<string, any>) {
  if (!['assetIds', 'documentIds', 'knowledgeItems', 'team'].some((key) => input[key] !== undefined)) return;
  for (const key of ['assetIds', 'documentIds', 'knowledgeItems', 'team']) if (input[key] !== undefined && !Array.isArray(input[key])) throw new ApiError(400, '关联资料必须为列表');
  const current = await tx.performanceRecord.findUniqueOrThrow({ where: { id }, include });
  const assetIds = [...new Set<string>(input.assetIds ?? current.assets.map((link) => link.assetItemId))];
  const documentIds = [...new Set<string>(input.documentIds ?? current.documents.map((link) => link.documentId))];
  const items = input.knowledgeItems ?? current.items.map((link) => ({ documentId: link.documentId, itemId: link.itemId }));
  const team = input.team ?? current.team.map((link) => ({ profileId: link.profileId, role: link.role }));
  if (![assetIds, documentIds, items, team].every(Array.isArray) || [...assetIds, ...documentIds].some((value) => typeof value !== 'string') || Math.max(assetIds.length, documentIds.length, items.length, team.length) > 200) throw new ApiError(400, '关联资料列表无效或超过 200 项');
  const assets = await tx.assetItem.count({ where: { id: { in: assetIds }, library: 'company', OR: [{ archivedAt: null }, { id: { in: current.assets.map((link) => link.assetItemId) } }] } });
  const docs = await tx.knowledgeDocument.count({ where: { documentId: { in: documentIds }, OR: [{ archivedAt: null }, { documentId: { in: current.documents.map((link) => link.documentId) } }] } });
  if (assets !== assetIds.length || docs !== documentIds.length) throw new ApiError(409, '关联的公司原件或知识文档不存在或已归档');
  const seenItems = new Set<string>(); const seenTeam = new Set<string>();
  for (const item of items) {
    if (!documentIds.includes(item.documentId) || typeof item.itemId !== 'string') throw new ApiError(400, '知识条目必须属于已关联的文档');
    const key = `${item.documentId}::${item.itemId}`;
    if (seenItems.has(key)) throw new ApiError(400, '知识条目重复'); seenItems.add(key);
    const retained = current.items.some((link) => link.documentId === item.documentId && link.itemId === item.itemId);
    if (!await tx.knowledgeItem.findFirst({ where: { documentId: item.documentId, itemId: item.itemId, ...(retained ? {} : { archivedAt: null }) } })) throw new ApiError(409, '知识条目已变化，请刷新关联');
  }
  for (const member of team) {
    if (typeof member.role !== 'string' || !member.role.trim() || member.role.length > 120) throw new ApiError(400, '请填写项目岗位');
    if (!await tx.personnelProfile.findFirst({ where: { id: member.profileId, ...(current.team.some((link) => link.profileId === member.profileId) ? {} : { archivedAt: null }) } })) throw new ApiError(409, '团队人员不存在或已归档');
    const key = `${member.profileId}:${member.role.trim()}`;
    if (seenTeam.has(key)) throw new ApiError(400, '团队岗位重复'); seenTeam.add(key);
  }
  await tx.performanceKnowledgeItem.deleteMany({ where: { recordId: id } });
  await tx.performanceKnowledgeDocument.deleteMany({ where: { recordId: id } });
  await tx.performanceAsset.deleteMany({ where: { recordId: id } });
  await tx.performanceTeamMember.deleteMany({ where: { recordId: id } });
  await tx.performanceAsset.createMany({ data: assetIds.map((assetItemId) => ({ recordId: id, assetItemId })) });
  await tx.performanceKnowledgeDocument.createMany({ data: documentIds.map((documentId) => ({ recordId: id, documentId })) });
  await tx.knowledgeUseRestriction.createMany({ data: documentIds.map((documentId) => ({ documentId, performanceSourceId: id })), skipDuplicates: true });
  await tx.performanceKnowledgeItem.createMany({ data: items.map((item: any) => ({ recordId: id, documentId: item.documentId, itemId: item.itemId })) });
  await tx.performanceTeamMember.createMany({ data: team.map((member: any) => ({ recordId: id, profileId: member.profileId, role: member.role.trim() })) });
}
export function createPerformanceStore(prisma: PrismaClient) {
  async function get(id: string) {
    const row = await prisma.performanceRecord.findUnique({ where: { id }, include });
    if (!row) throw new ApiError(404, '业绩不存在'); return dto(row);
  }
  return {
    get,
    async list(q = '', requestedPage: unknown = 1, archived = false) {
      const where: Prisma.PerformanceRecordWhereInput = { archivedAt: archived ? { not: null } : null, ...(q.trim() ? { OR: ['title', 'ownerName', 'projectType', 'summary'].map((key) => ({ [key]: { contains: q.trim(), mode: 'insensitive' } })) } : {}) };
      const total = await prisma.performanceRecord.count({ where }); const pageSize = 50;
      const numeric = Number(requestedPage); const page = Math.max(1, Math.min(Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 1, Math.ceil(total / pageSize) || 1));
      const items = await prisma.performanceRecord.findMany({ where, include, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize });
      return { items: items.map(dto), total, page, pageSize };
    },
    async create(input: Record<string, any>, actorId: number) {
      const data = fields(input, true);
      const id = await prisma.$transaction(async (tx) => {
        const row = await tx.performanceRecord.create({ data: { ...data, title: data.title, createdByUserId: actorId, updatedByUserId: actorId } });
        await replaceLinks(tx, row.id, input); await audit(tx, 'performance', row.id, 'create', 1, actorId); return row.id;
      });
      return get(id);
    },
    async update(id: string, input: Record<string, any>, actorId: number, linksOnly = false) {
      const version = expectedVersion(input.version); const patch = linksOnly ? {} : fields(input);
      await prisma.$transaction(async (tx) => {
        const current = await tx.performanceRecord.findUniqueOrThrow({ where: { id } });
        const updated = await tx.performanceRecord.updateMany({ where: { id, version, ...(linksOnly ? {} : { archivedAt: null }) }, data: { ...patch, version: { increment: 1 }, updatedByUserId: actorId } });
        if (!updated.count) throw new ApiError(409, '业绩已被修改或归档，请刷新');
        if (current.isPubliclyCitable && patch.isPubliclyCitable === false) await tx.referenceRevocation.create({ data: { sourceType: 'performance', sourceId: id, throughVersion: version, revokedByUserId: actorId, reason: typeof input.revocationReason === 'string' && input.revocationReason.trim() ? input.revocationReason.trim() : '维护人撤销对外引用许可' } });
        await replaceLinks(tx, id, input); await audit(tx, 'performance', id, 'update', version + 1, actorId);
      });
      return get(id);
    },
    async archive(id: string, versionValue: unknown, actorId: number) {
      const version = expectedVersion(versionValue);
      await prisma.$transaction(async (tx) => {
        const result = await tx.performanceRecord.updateMany({ where: { id, version }, data: { archivedAt: new Date(), version: { increment: 1 }, updatedByUserId: actorId } });
        if (!result.count) throw new ApiError(409, '业绩版本已变化，请刷新');
        await audit(tx, 'performance', id, 'archive', version + 1, actorId);
      });
      return get(id);
    },
  };
}
