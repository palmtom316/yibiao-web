import { getDataDir } from '../document/paths';
import { readBoundedFile } from '../security/files';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type BusinessRequirement } from '@prisma/client';
import { requireProjectAccess, requireKnowledgeAccess, ApiError } from '../security/access';
import { expectedVersion, parseDate, businessDate } from '../ledger/validation';
import { audit } from '../ledger/lifecycle';
import { businessSource, sourceCandidateDto, hashValue } from './sources';
import { evaluateCandidate, validateThresholds } from './evidence';
import { createReferenceSnapshot, usableSnapshot } from './snapshots';
import type { BackgroundJob } from '@prisma/client';
import type { AiService } from '../ai/service';
import { bindConfigScope } from '../security/processing';
import { buildMerged } from '../config/store';
import { createTechnicalPlanStore } from '../technical-plan/store';

export async function businessContext(prisma: Pick<PrismaClient, 'project' | 'technicalPlanMeta'>, projectId: number) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const meta = await prisma.technicalPlanMeta.findUnique({ where: { projectId } });
  const sourceHash = meta?.tenderOriginalMarkdownHash || meta?.tenderMarkdownHash || '';
  const sectionId = meta?.selectedSectionId || '';
  return { project, meta, sourceHash, sectionId, fingerprint: hashValue({ sourceHash, sectionId, referenceDate: businessDate(project.bidDeadline) }) };
}
export function createBusinessStore(prisma: PrismaClient) {
  async function access(projectId: number, userId: number) { await requireProjectAccess(prisma, userId, projectId); await requireKnowledgeAccess(prisma, userId); }
  async function requirement(projectId: number, id: string) {
    const row = await prisma.businessRequirement.findFirst({ where: { id, projectId, active: true } }); if (!row) throw new ApiError(404, '商务要求不存在'); return row;
  }
  async function workspace(projectId: number, userId: number) {
    await access(projectId, userId); const context = await businessContext(prisma, projectId);
    const rows = await prisma.businessRequirement.findMany({ where: { projectId, active: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { matches: { where: { selected: true }, include: { snapshot: true } } } });
    const requirements = await Promise.all(rows.map(async (row) => {
      const match = row.matches[0]; let reviewReason = '';
      if (row.scopeFingerprint !== context.fingerprint || (match && (match.requirementVersion !== row.version || match.scopeFingerprint !== context.fingerprint))) reviewReason = '招标来源、标段、要求或核验日期变化，需复核';
      if (match?.snapshotId) try { await usableSnapshot(prisma, match.snapshotId, projectId, userId); } catch { reviewReason = '引用已撤销或尚未就绪，需重新核验'; }
      return { ...row, matches: undefined, match: match ? { ...match, snapshot: undefined } : null, needsReview: Boolean(reviewReason), reviewReason };
    }));
    const revisions = await prisma.businessResponseRevision.findMany({ where: { projectId }, select: { id: true, revision: true, hash: true, status: true, createdAt: true }, orderBy: { revision: 'desc' } });
    return { projectId, bidDeadline: businessDate(context.project.bidDeadline), sourceHash: context.sourceHash, selectedSectionId: context.sectionId, requirements, revisions };
  }
  async function createRequirement(projectId: number, userId: number, input: Record<string, any>) {
    await access(projectId, userId); const context = await businessContext(prisma, projectId);
    if (typeof input.rawText !== 'string' || !input.rawText.trim() || input.rawText.length > 20000) throw new ApiError(400, '请填写商务要求原文（最多 20000 字）');
    const category = ['asset', 'performance', 'certificate', 'other'].includes(input.category) ? input.category : 'other';
    const source = input.sourceId ? await prisma.documentSource.findFirst({ where: { id: input.sourceId, projectId } }) : null;
    if (input.sourceId && !source) throw new ApiError(403, '来源文件不属于当前项目');
    return prisma.businessRequirement.create({ data: { projectId, category, rawText: input.rawText.trim(), sourceId: source?.id, sourceHash: source?.sha256 || context.sourceHash,
      sourceLocator: typeof input.sourceLocator === 'string' ? input.sourceLocator.slice(0, 500) : '人工录入', sectionId: context.sectionId, scopeFingerprint: context.fingerprint,
      thresholds: validateThresholds(input.thresholds), referenceDate: context.project.bidDeadline, originKey: randomUUID(), createdByUserId: userId, updatedByUserId: userId } });
  }
  async function updateRequirement(projectId: number, userId: number, id: string, input: Record<string, any>) {
    await access(projectId, userId); const current = await requirement(projectId, id); const version = expectedVersion(input.version); const context = await businessContext(prisma, projectId);
    const rawText = input.rawText === undefined ? current.rawText : input.rawText;
    if (typeof rawText !== 'string' || !rawText.trim() || rawText.length > 20000) throw new ApiError(400, '要求原文无效');
    const nextSource = input.sourceId ? await prisma.documentSource.findFirst({ where: { id: input.sourceId, projectId } }) : null;
    if (input.sourceId && !nextSource) throw new ApiError(403, '来源原件不属于当前项目');
    const data: Prisma.BusinessRequirementUpdateManyMutationInput = { rawText, thresholds: input.thresholds === undefined ? current.thresholds as Prisma.InputJsonValue : validateThresholds(input.thresholds), humanEdited: true,
      referenceDate: context.project.bidDeadline, scopeFingerprint: context.fingerprint, sourceHash: nextSource?.sha256 || current.sourceHash || context.sourceHash, sourceId: nextSource?.id || current.sourceId, sectionId: context.sectionId, version: { increment: 1 }, updatedByUserId: userId };
    if (['asset', 'performance', 'certificate', 'other'].includes(input.category)) data.category = input.category;
    if (typeof input.sourceLocator === 'string') data.sourceLocator = input.sourceLocator.slice(0, 500);
    const updated = await prisma.businessRequirement.updateMany({ where: { id, projectId, version }, data });
    if (!updated.count) throw new ApiError(409, '要求已更新，请刷新'); return requirement(projectId, id);
  }
  async function candidates(projectId: number, userId: number, requirementId: string, keyword = '') {
    await access(projectId, userId); const req = await requirement(projectId, requirementId); const context = await businessContext(prisma, projectId);
    const query = keyword.trim().slice(0, 100); const refs: { type: string; id: string }[] = [];
    if (req.category === 'asset' || req.category === 'other') refs.push(...(await prisma.assetItem.findMany({ where: { library: 'company', archivedAt: null, ...(query ? { OR: [{ name: { contains: query } }, { certificateNo: { contains: query } }, { category: { contains: query } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 50 })).map((row) => ({ type: 'asset', id: row.id })));
    if (req.category === 'certificate' || req.category === 'other') refs.push(...(await prisma.personnelCertificate.findMany({ where: { archivedAt: null, profile: { archivedAt: null }, ...(query ? { OR: [{ certName: { contains: query } }, { certificateNo: { contains: query } }, { profile: { name: { contains: query } } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 50 })).map((row) => ({ type: 'certificate', id: row.id })));
    if (req.category === 'performance' || req.category === 'other') refs.push(...(await prisma.performanceRecord.findMany({ where: { archivedAt: null, ...(query ? { OR: [{ title: { contains: query } }, { projectType: { contains: query } }, { tags: { has: query } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 50 })).map((row) => ({ type: 'performance', id: row.id })));
    const result = [];
    for (const ref of refs) {
      const source = await businessSource(prisma, ref.type, ref.id); const evidence = evaluateCandidate(source, validateThresholds(req.thresholds), context.project.bidDeadline);
      if (!req.humanEdited) evidence.push({ field: 'humanReview', label: '要求抽取复核', expected: '人工核对原文与门槛后保存要求', actual: '尚未复核', state: 'unknown' });
      const id = `candidate-${hashValue({ requirementId, requirementVersion: req.version, source: source.fingerprint, context: context.fingerprint })}`;
      const match = await prisma.businessMatch.upsert({ where: { id }, update: {}, create: { id, projectId, requirementId, requirementVersion: req.version, candidateType: source.type, candidateId: source.id, candidateVersion: source.version,
        scopeFingerprint: context.fingerprint, evidence: evidence as unknown as Prisma.InputJsonValue, conclusion: evidence.some((item) => item.state === 'unknown') ? 'pending' : 'candidate', reason: query ? `名称或标签检索：${query}，需人工核验` : '按资料类别列出，需人工核验' } });
      result.push({ ...sourceCandidateDto(source), matchId: match.id, evidence, conclusion: match.conclusion, requiresHumanConfirmation: true });
    }
    return { items: result, requirementVersion: req.version };
  }
  async function confirm(projectId: number, userId: number, requirementId: string, input: Record<string, any>) {
    await access(projectId, userId);
    const confirmationId = input.requestKey ? `confirmation-${hashValue({ projectId, requirementId, key: input.requestKey })}` : randomUUID();
    const existing = await prisma.businessMatch.findUnique({ where: { id: confirmationId } });
    if (existing) { if (existing.projectId !== projectId) throw new ApiError(403, '确认不属于当前项目'); return existing; }
    const req = await requirement(projectId, requirementId); const version = expectedVersion(input.requirementVersion);
    if (version !== req.version) throw new ApiError(409, '要求已被修改，请刷新候选');
    const context = await businessContext(prisma, projectId);
    const conclusion = input.conclusion;
    if (!['confirmed', 'partial', 'missing', 'not_applicable'].includes(conclusion)) throw new ApiError(400, '请选择人工核验结论');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw new ApiError(400, '请填写人工核验说明，不适用也需说明原因');
    let snapshotId: string | null = null; let evidence: unknown[] = []; let candidateType = 'none'; let candidateId = ''; let candidateVersion = 0;
    if (conclusion === 'confirmed' || conclusion === 'partial') {
      const source = await businessSource(prisma, input.type, input.id);
      if (source.fingerprint !== input.fingerprint || source.version !== Number(input.version)) throw new ApiError(409, '候选资料已变化，请重新检索');
      evidence = evaluateCandidate(source, validateThresholds(req.thresholds), context.project.bidDeadline);
      if (!req.humanEdited && conclusion === 'confirmed') throw new ApiError(409, '请先人工核对抽取原文和结构化门槛，保存要求后再确认');
      if (conclusion === 'confirmed' && evidence.some((item: any) => item.state !== 'met')) throw new ApiError(409, '有未满足或关键未知条件，请补齐资料后确认，或记录部分满足');
      if (!source.allowed) throw new ApiError(409, '资料未许可或已归档，不能确认引用');
      const snapshot = await createReferenceSnapshot(prisma, { projectId, userId, type: source.type, id: source.id, version: source.version, fingerprint: source.fingerprint, refreshOfId: input.refreshOfId });
      snapshotId = snapshot.id; candidateType = source.type; candidateId = source.id; candidateVersion = source.version;
    }
    return prisma.$transaction(async (tx) => {
      if ((await businessContext(tx, projectId)).fingerprint !== context.fingerprint) throw new ApiError(409, '招标或核验日期变化，请重新核验');
      const updated = await tx.businessRequirement.updateMany({ where: { id: req.id, projectId, version }, data: { version: { increment: 1 }, scopeFingerprint: context.fingerprint, referenceDate: context.project.bidDeadline, updatedByUserId: userId } });
      if (!updated.count) throw new ApiError(409, '要求确认状态已变化，请刷新');
      await tx.businessMatch.updateMany({ where: { requirementId, projectId, selected: true }, data: { selected: false } });
      const result = await tx.businessMatch.create({ data: { id: confirmationId, projectId, requirementId, requirementVersion: version + 1, candidateType, candidateId, candidateVersion,
        evidence: evidence as Prisma.InputJsonValue, scopeFingerprint: context.fingerprint, conclusion, reason, selected: true, confirmedByUserId: userId, confirmedAt: new Date(), snapshotId } });
      await audit(tx, 'business-requirement', requirementId, 'confirm', version + 1, userId, { conclusion, snapshotId }); return result;
    });
  }
  async function createRevision(projectId: number, userId: number, requestKey: string) {
    await access(projectId, userId); const key = `${projectId}:${requestKey}`;
    const existing = await prisma.businessResponseRevision.findUnique({ where: { requestKey: key } }); if (existing) return existing;
    const state = await workspace(projectId, userId);
    if (!state.requirements.length) throw new ApiError(400, '请先录入商务要求');
    const ready = state.requirements.every((req) => !req.needsReview && ['confirmed', 'not_applicable'].includes(req.match?.conclusion || ''));
    const ids = [...new Set(state.requirements.map((req) => req.match?.snapshotId).filter((id): id is string => Boolean(id)))];
    for (const id of ids) await usableSnapshot(prisma, id, projectId, userId, true);
    const data = { projectName: (await businessContext(prisma, projectId)).project.name, referenceDate: state.bidDeadline, sourceHash: state.sourceHash, sectionId: state.selectedSectionId,
      requirements: state.requirements.map((req) => ({ id: req.id, version: req.version, category: req.category, rawText: req.rawText, sourceId: req.sourceId, sourceHash: req.sourceHash, sourceLocator: req.sourceLocator, thresholds: req.thresholds, conclusion: req.needsReview ? 'pending' : req.match?.conclusion || 'pending', reason: req.match?.reason || req.reviewReason || '尚未核验', snapshotId: req.match?.snapshotId || null })) };
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id=${projectId} FOR UPDATE`;
      const same = await tx.businessResponseRevision.findUnique({ where: { requestKey: key } }); if (same) return same;
      if ((await businessContext(tx, projectId)).sourceHash !== state.sourceHash) throw new ApiError(409, '招标来源变化，请重试');
      for (const row of state.requirements) if (!await tx.businessRequirement.findFirst({ where: { id: row.id, projectId, version: row.version } })) throw new ApiError(409, '要求在编制期间发生变化，请重试');
      const last = await tx.businessResponseRevision.aggregate({ where: { projectId }, _max: { revision: true } });
      const revision = await tx.businessResponseRevision.create({ data: { projectId, revision: (last._max.revision || 0) + 1, requestKey: key, data: data as unknown as Prisma.InputJsonValue,
        hash: hashValue(data), status: ready ? 'ready' : 'draft', createdByUserId: userId } });
      await tx.businessRevisionSnapshot.createMany({ data: ids.map((snapshotId) => ({ revisionId: revision.id, projectId, snapshotId })) }); return revision;
    });
  }
  async function extract(job: BackgroundJob, ai: AiService) {
    const projectId = job.projectId!; await access(projectId, job.userId);
    if (await prisma.auditEvent.findFirst({ where: { sourceType: 'business-extraction', sourceId: job.id, action: 'complete' } })) return workspace(projectId, job.userId);
    const context = await businessContext(prisma, projectId);
    const sourceFiles = (context.meta?.tenderFilesJson || []) as any[];
    if (!sourceFiles.length || !sourceFiles.every((file) => file.sourceId)) throw new ApiError(409, '自动抽取需要招标原件，请重新上传；仍可人工录入要求');
    const markdown = await createTechnicalPlanStore(prisma).readTenderMarkdown(projectId);
    if (!markdown) throw new ApiError(400, '请先导入招标文件');
    const config = bindConfigScope(await buildMerged(prisma, job.userId), { kind: 'project', projectId, userId: job.userId });
    const result = await ai.requestJson(config, { messages: [{ role: 'system', content: '仅抽取商务资格、公司证照、类似业绩和人员证书要求，禁止生成技术目录。返回 {requirements:[{category:"asset|performance|certificate|other",rawText:"逐字原文证据"}]}。rawText 必须可在输入中原样定位，不推测金额或等级。' }, { role: 'user', content: markdown }], response_format: { type: 'json_object' } });
    const rows = Array.isArray(result?.requirements) ? result.requirements : [];
    if (!rows.length || rows.length > 200) throw new ApiError(422, '未取得有效商务要求，请人工录入或重试');
    if ((await businessContext(prisma, projectId)).fingerprint !== context.fingerprint) throw new ApiError(409, '抽取期间招标或标段变化，请重试');
    const evidenceSources: Array<{ id: string; hash: string; text: string }> = [];
    for (const file of sourceFiles) {
      const source = await prisma.documentSource.findFirst({ where: { id: file.sourceId, projectId } });
      if (!source) throw new ApiError(409, '招标原件已变化，请重新上传');
      const parsed = await prisma.documentParseVersion.findUnique({ where: { sourceId_version: { sourceId: source.id, version: file.parseVersion || source.currentParseVersion || 0 } } });
      if (!parsed?.markdownPath || parsed.status !== 'success') throw new ApiError(409, '招标解析版本不可用');
      evidenceSources.push({ id: source.id, hash: source.sha256, text: readBoundedFile(getDataDir(), parsed.markdownPath).toString('utf8') });
    }
    const extractionVersion = (await prisma.businessRequirement.aggregate({ where: { projectId }, _max: { extractionVersion: true } }))._max.extractionVersion || 0;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id=${projectId} FOR UPDATE`;
      if (await tx.auditEvent.findFirst({ where: { sourceType: 'business-extraction', sourceId: job.id, action: 'complete' } })) return;
      await tx.businessRequirement.updateMany({ where: { projectId, humanEdited: false, sectionId: context.sectionId }, data: { active: false } });
      for (const row of rows) {
        const rawText = typeof row.rawText === 'string' ? row.rawText.trim() : '';
        const offset = markdown.indexOf(rawText);
        if (!rawText || offset < 0 || rawText.length > 20000) throw new ApiError(422, '模型要求无法定位原文，已阻止保存');
        const evidenceSource = evidenceSources.find((source) => source.text.includes(rawText));
        if (!evidenceSource) throw new ApiError(422, '要求无法定位到具体原件，已阻止保存');
        const originKey = hashValue({ rawText, sectionId: context.sectionId });
        if (await tx.businessRequirement.findFirst({ where: { projectId, originKey, humanEdited: true } })) continue;
        await tx.businessRequirement.create({ data: { projectId, category: ['asset', 'performance', 'certificate'].includes(row.category) ? row.category : 'other', rawText, sourceId: evidenceSource.id,
          sourceHash: evidenceSource.hash, sourceLocator: `解析文本第 ${evidenceSource.text.slice(0, evidenceSource.text.indexOf(rawText)).split('\n').length} 行`, sectionId: context.sectionId, scopeFingerprint: context.fingerprint,
          referenceDate: context.project.bidDeadline, extractionVersion: extractionVersion + 1, originKey, humanEdited: false, createdByUserId: job.userId, updatedByUserId: job.userId } });
      }
      await audit(tx, 'business-extraction', job.id, 'complete', extractionVersion + 1, job.userId, { projectId, fingerprint: context.fingerprint });
    });
    return workspace(projectId, job.userId);
  }
  return { workspace, createRequirement, updateRequirement, candidates, confirm, createRevision, extract,
    async setDeadline(projectId: number, userId: number, value: unknown) { await access(projectId, userId); await prisma.project.update({ where: { id: projectId }, data: { bidDeadline: parseDate(value, '投标截止日期') } }); return workspace(projectId, userId); },
    async archiveRequirement(projectId: number, userId: number, id: string, version: unknown) { await access(projectId, userId); const result = await prisma.businessRequirement.updateMany({ where: { id, projectId, version: expectedVersion(version) }, data: { active: false, version: { increment: 1 }, updatedByUserId: userId } }); if (!result.count) throw new ApiError(409, '要求版本已变化'); return { success: true }; },
  };
}
