import type { PrismaClient, ProjectReferenceSnapshot, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { usableSnapshot } from './snapshots';
import { ApiError, requireProjectAccess, requireKnowledgeAccess } from '../security/access';
import { businessDate } from '../ledger/validation';
import { assertNotRevoked } from '../ledger/lifecycle';
import type { Provenance } from './sources';

export const contentHash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function confirmedReferenceFacts(db: PrismaClient | Prisma.TransactionClient, projectId: number) {
  const references = await db.chapterReference.findMany({ where: { projectId, active: true }, include: { snapshot: true } });
  const snapshots = [...new Map(references.map((reference) => [reference.snapshotId, reference.snapshot])).values()];
  const groups = [];
  for (const snapshot of snapshots) {
    if (snapshot.status !== 'ready' || !snapshot.allowedUses.includes('technical-facts')) throw new ApiError(409, '章节引用尚未完成确认');
    for (const source of snapshot.provenance as unknown as Provenance[]) await assertNotRevoked(db, source.type, source.id, source.version);
    groups.push({ id: `confirmed_reference_${snapshot.id}`, title: `已确认资料：${(snapshot.data as any).title}`, content: renderReference(snapshot) });
  }
  return groups;
}
const escape = (value: unknown) => String(value ?? '未知').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
const labels: Record<string, string> = { title: '业绩名称', ownerName: '业主', location: '地点', contractAmount: '合同金额（元）', currency: '币种', contractSignedAt: '签订日期', startedAt: '开始日期', completedAt: '完成日期', projectType: '项目类型', name: '证照名称', category: '类别', certificateNo: '证号', qualificationLevel: '等级', holderName: '持有人', issuer: '颁发单位', validFrom: '生效日期', validityKind: '有效期类型', expiryDate: '到期日期' };
export function renderReference(snapshot: ProjectReferenceSnapshot): string {
  const data = snapshot.data as any;
  const fields = Object.entries(data.fields || {}).map(([key, value]) => `| ${labels[key] || key} | ${escape(key.endsWith('At') || key === 'validFrom' || key === 'expiryDate' ? businessDate(value as string) : value)} |`);
  const team = (data.team || []).map((member: any) => `- 人员：${escape(member.name)}；项目岗位：${escape(member.role)}${(member.certificates || []).map((cert: any) => `；${escape(cert.name)}，证号：${escape(cert.certificateNo)}`).join('')}`);
  return `<!-- yibiao-reference:${snapshot.id} -->\n\n### ${escape(data.title)}\n\n| 核对字段 | 已确认资料 |\n| --- | --- |\n${fields.join('\n')}\n\n${team.join('\n')}\n\n${String(data.narrative || '')}\n\n<!-- /yibiao-reference:${snapshot.id} -->`;
}
export async function validateReferenceBlocks(db: PrismaClient | Prisma.TransactionClient, projectId: number, nodeId: string, content: string) {
  const references = await db.chapterReference.findMany({ where: { projectId, nodeId, active: true }, include: { snapshot: true } });
  for (const reference of references) {
    const expected = renderReference(reference.snapshot);
    if (!content.includes(expected) || contentHash(expected) !== reference.insertedContentHash) throw new ApiError(409, '已确认引用区的权威字段或叙述被改变；请从资料快照刷新引用，保留区外人工正文');
  }
}
export async function attachChapterReferences(prisma: PrismaClient, projectId: number, userId: number, nodeId: string, snapshotIds: string[]) {
  await requireProjectAccess(prisma, userId, projectId); await requireKnowledgeAccess(prisma, userId);
  if (!Array.isArray(snapshotIds) || !snapshotIds.length || snapshotIds.length > 20) throw new ApiError(400, '请选择 1–20 份已确认引用');
  const snapshots: ProjectReferenceSnapshot[] = [];
  for (const id of [...new Set(snapshotIds)]) {
    const snapshot = await usableSnapshot(prisma, id, projectId, userId, true);
    if (!snapshot.allowedUses.includes('technical-facts') || !await prisma.businessMatch.findFirst({ where: { projectId, snapshotId: id, conclusion: 'confirmed' } })) throw new ApiError(409, '只有人工确认满足的引用可进入技术标');
    snapshots.push(snapshot);
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "nodeId" FROM technical_plan_outline_nodes WHERE "projectId"=${projectId} AND "nodeId"=${nodeId} FOR UPDATE`;
    const node = await tx.technicalPlanOutlineNode.findUnique({ where: { projectId_nodeId: { projectId, nodeId } } });
    if (!node) throw new ApiError(404, '目标章节不存在');
    if (await tx.technicalPlanOutlineNode.findFirst({ where: { projectId, parentNodeId: nodeId } })) throw new ApiError(400, '请选择可编辑正文的末级章节');
    let content = node.content;
    await validateReferenceBlocks(tx, projectId, nodeId, content);
    for (const snapshot of snapshots) {
      const existing = await tx.chapterReference.findUnique({ where: { projectId_nodeId_snapshotId: { projectId, nodeId, snapshotId: snapshot.id } } });
      if (existing?.active) continue;
      const block = renderReference(snapshot);
      if (snapshot.refreshOfId) {
        const previous = await tx.chapterReference.findFirst({ where: { projectId, nodeId, snapshotId: snapshot.refreshOfId, active: true }, include: { snapshot: true } });
        if (previous) { content = content.replace(renderReference(previous.snapshot), block); await tx.chapterReference.update({ where: { id: previous.id }, data: { active: false, locked: false } }); }
        else content += `\n\n${block}`;
      } else content += `\n\n${block}`;
      await tx.chapterReference.upsert({ where: { projectId_nodeId_snapshotId: { projectId, nodeId, snapshotId: snapshot.id } }, update: { active: true, locked: true, insertedContentHash: contentHash(block) }, create: { projectId, nodeId, snapshotId: snapshot.id, insertedContentHash: contentHash(block), createdByUserId: userId } });
    }
    await tx.technicalPlanOutlineNode.update({ where: { projectId_nodeId: { projectId, nodeId } }, data: { content: content.trim(), manualLocked: true, updatedAt: new Date().toISOString() } });
    await tx.technicalPlanContentSection.upsert({ where: { projectId_nodeId: { projectId, nodeId } }, create: { projectId, nodeId, status: 'success', updatedAt: new Date().toISOString() }, update: { status: 'success', updatedAt: new Date().toISOString() } });
  });
  return { success: true };
}
export async function verifyTechnicalReferences(prisma: PrismaClient, projectId: number, userId: number, outline: any[]) {
  const refs = await prisma.chapterReference.findMany({ where: { projectId, active: true } });
  const nodes = new Map<string, any>(); const visit = (items: any[]) => { for (const item of items) { nodes.set(item.id, item); if (Array.isArray(item.children)) visit(item.children); } }; visit(outline);
  for (const ref of refs) {
    if (!nodes.has(ref.nodeId)) continue;
    await usableSnapshot(prisma, ref.snapshotId, projectId, userId);
    await validateReferenceBlocks(prisma, projectId, ref.nodeId, String(nodes.get(ref.nodeId).content || ''));
  }
  // A caller cannot invent a snapshot block by posting its UUID as arbitrary export Markdown.
  for (const node of nodes.values()) for (const match of String(node.content || '').matchAll(/<!-- yibiao-reference:([a-z0-9-]+) -->/g)) {
    if (!refs.some((ref) => ref.snapshotId === match[1] && ref.nodeId === node.id)) throw new ApiError(403, '章节包含未确认的引用');
  }
}
