// Web adaptation of templateExtractionTask.cjs steps 4–8, upstream
// palmtom316/yibiao b079bc0d923c4a533b9c2de3a9f573f4c75d8137 (AGPL-3.0-only).
// Local scan → complete classification → content controls + field manifest.
// Values are never generated here. Human signatures/seals always remain manual.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createWorkspacePaths } from '../document/paths';
import { readBoundedFile, resolveInside } from '../security/files';
import { requireProjectAccess, ApiError } from '../security/access';
import { bindConfigScope, withConfigScope } from '../security/processing';
import { buildMerged } from '../config/store';
import { getAiService } from '../ai/service';
import { hashFile } from '../business-bid/snapshots';
import { parseQueue } from '../resources/queue';
import { runOpenXmlJob } from './service';

export interface TemplateCandidate { candidate_id: string; text: string; context: string; suggested_name: string; suggested_fill_by: string }
export interface TemplateField { candidate_id: string; name: string; fill_by: 'ai' | 'manual'; instruction?: string }
export interface TemplateSelection { fields: TemplateField[]; ignored_candidate_ids: string[] }
const manualPattern = /签字|签名|盖章|签章|手印|印章|照片|证件原件/;
export function validateTemplateSelection(candidates: TemplateCandidate[], selection: TemplateSelection) {
  if (!Array.isArray(selection.fields) || !Array.isArray(selection.ignored_candidate_ids)) throw new ApiError(400, '请逐项分类所有模板候选');
  const remaining = new Map(candidates.map((c) => [c.candidate_id, c]));
  const definitions = new Map<string, string>();
  for (const field of selection.fields) {
    const candidate = remaining.get(field.candidate_id);
    if (!candidate || !field.name?.trim() || field.name.length > 120 || !['ai', 'manual'].includes(field.fill_by) || (field.instruction?.length || 0) > 2000) throw new ApiError(400, '字段重复、不存在或名称/填写方式无效');
    if (manualPattern.test(`${candidate.suggested_name} ${candidate.text} ${field.name}`) && field.fill_by !== 'manual') throw new ApiError(400, '签字、盖章和人工材料必须手工填写');
    const signature = JSON.stringify([field.fill_by, field.instruction || '']);
    if (definitions.has(field.name) && definitions.get(field.name) !== signature) throw new ApiError(400, '同名字段必须使用相同填写方式和说明');
    definitions.set(field.name, signature); remaining.delete(field.candidate_id);
  }
  for (const id of selection.ignored_candidate_ids) {
    if (!remaining.delete(id)) throw new ApiError(400, '忽略项重复、不存在或已被设为字段');
  }
  if (remaining.size) throw new ApiError(400, '仍有待填位置未分类');
}
async function readManifest(prisma: PrismaClient, projectId: number, userId: number, id: string) {
  await requireProjectAccess(prisma, userId, projectId);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ApiError(400, '模板标识无效');
  const root = createWorkspacePaths(projectId).workspaceDir;
  const workspace = resolveInside(root, `openxml/${id}`);
  const manifest = JSON.parse(readBoundedFile(workspace, 'manifest.json', 10 * 1024 * 1024).toString());
  if (manifest.status !== 'success' || !Array.isArray(manifest.candidates)) throw new ApiError(409, '请先重新抽取 Word 模板');
  return { root, workspace, manifest };
}
export async function getTemplateFields(prisma: PrismaClient, projectId: number, userId: number, id: string) {
  const { manifest } = await readManifest(prisma, projectId, userId, id);
  return { artifactId: id, version: manifest.version, status: manifest.fieldStatus, candidates: manifest.candidates,
    selection: manifest.selection || { fields: manifest.candidates.map((c: TemplateCandidate, i: number) => ({ candidate_id: c.candidate_id, name: c.suggested_name || `待填位置 ${i + 1}`, fill_by: 'manual' })), ignored_candidate_ids: [] } };
}
export async function suggestTemplateFields(prisma: PrismaClient, projectId: number, userId: number, id: string) {
  const current = await getTemplateFields(prisma, projectId, userId, id);
  const config = bindConfigScope(await buildMerged(prisma, userId), { kind: 'project', projectId, userId });
  const selection = await withConfigScope(config, () => getAiService().requestJson(config, { messages: [
    { role: 'system', content: '对 Word 模板候选逐项分类，只标记不生成字段值。返回 {"fields":[{"candidate_id":"...","name":"...","fill_by":"ai|manual","instruction":"可选说明"}],"ignored_candidate_ids":[]}。所有候选必须且只能归入其中一类。签字、盖章、签章、手印和必须放置人工材料的位置必须 manual。同一语义多处填写使用完全相同的 name、fill_by 和 instruction；不同语义不得仅因名称相近而合并。非待填位置放入 ignored_candidate_ids。' },
    { role: 'user', content: JSON.stringify(current.candidates) },
  ], response_format: { type: 'json_object' } }));
  validateTemplateSelection(current.candidates, selection as unknown as TemplateSelection);
  return { ...current, selection };
}
export async function applyTemplateFields(prisma: PrismaClient, projectId: number, userId: number, id: string, expectedVersion: number, selection: TemplateSelection) {
  return parseQueue.run(async () => {
    const { root, workspace, manifest } = await readManifest(prisma, projectId, userId, id);
    if (manifest.version !== expectedVersion) throw new ApiError(409, '模板已被更新，请刷新字段后重试');
    validateTemplateSelection(manifest.candidates, selection);
    const revision = randomUUID(); const output = `output/${revision}.docx`; const fieldsOutput = `output/${revision}.json`;
    await runOpenXmlJob(workspace, { action: 'apply-template-fields', input: 'output/template.docx', output, fields_output: fieldsOutput, ...selection });
    const fields = JSON.parse(readBoundedFile(workspace, fieldsOutput).toString());
    if (fields.version !== 1 || !Array.isArray(fields.fields) || fields.fields.length !== selection.fields.length) throw new ApiError(422, '模板字段清单不完整');
    const result = { status: 'success', artifactId: id, version: manifest.version + 1, fieldStatus: 'confirmed', fieldCount: fields.fields.length,
      sourceId: manifest.sourceId, sourceHash: manifest.sourceHash, sha256: await hashFile(resolveInside(workspace, output)), chapters: manifest.chapters, message: `已确认 ${fields.fields.length} 个待填位置，Word 内容控件与字段清单已保存` };
    await fs.writeFile(path.join(workspace, `manifest-${revision}.json`), JSON.stringify({ ...manifest, ...result, selection, relativePath: `openxml/${id}/${output}`, fieldsRelativePath: `openxml/${id}/${fieldsOutput}` }), { mode: 0o600 });
    // Publish only after both immutable output files are valid. Previous revisions remain.
    await fs.rename(path.join(workspace, `manifest-${revision}.json`), path.join(workspace, 'manifest.json'));
    await prisma.technicalPlanMeta.update({ where: { projectId }, data: { templateExtractionJson: result } });
    return result;
  });
}
