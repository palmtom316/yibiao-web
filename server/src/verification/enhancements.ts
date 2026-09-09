import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Document, Packer, Paragraph, Header, Footer, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import AdmZip from 'adm-zip';
import { runOpenXmlJob } from '../openxml/service';
import { renderLocalDiagram, sanitizeIllustrationHtml } from '../illustrations/render';
import { buildDocxResult } from '../export/docxBuilder';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-enhancements-'));
try {
  const input = await Packer.toBuffer(new Document({ sections: [{ headers: { default: new Header({ children: [new Paragraph('合成页眉')] }) }, footers: { default: new Footer({ children: [new Paragraph('合成页脚')] }) }, children: [
    new Paragraph({ text: '技术方案', heading: HeadingLevel.HEADING_1 }), new Paragraph('合成章节正文'), new Paragraph('投标人名称：________'), new Paragraph('法定代表人签字：________'),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('合成表格')] })] })] }),
  ] }] }));
  await fs.writeFile(path.join(root, 'source.docx'), input);
  const blocks = await runOpenXmlJob(root, { action: 'list-blocks', sources: ['source.docx'] });
  assert.ok(blocks.sources[0].blocks.some((block: any) => block.text.includes('技术方案')));
  await runOpenXmlJob(root, { action: 'extract-chapters', sources: ['source.docx'], chapters: [{ id: 'tech', title: '技术方案', source: 'source.docx', startBlock: 0, endBlock: blocks.sources[0].blocks.length - 1 }], output: 'output/template.docx' });
  const extracted = new AdmZip(await fs.readFile(path.join(root, 'output/template.docx')));
  assert.match(extracted.readAsText('word/document.xml'), /合成表格/);
  assert.ok(extracted.getEntries().some((entry) => /^word\/header\d*\.xml$/.test(entry.entryName)));
  assert.ok(extracted.getEntries().some((entry) => /^word\/footer\d*\.xml$/.test(entry.entryName)));
  const scanned = await runOpenXmlJob(root, { action: 'scan-template-fields', input: 'output/template.docx' });
  assert.ok(scanned.candidates.length >= 2);
  const fields = scanned.candidates.map((candidate: any, i: number) => ({ candidate_id: candidate.candidate_id, name: candidate.suggested_name || `字段${i + 1}`, fill_by: /签/.test(candidate.context + candidate.text) ? 'manual' : 'ai' }));
  await runOpenXmlJob(root, { action: 'apply-template-fields', input: 'output/template.docx', output: 'output/fields.docx', fields_output: 'output/fields.json', fields, ignored_candidate_ids: [] });
  const tagged = new AdmZip(await fs.readFile(path.join(root, 'output/fields.docx')));
  assert.match(tagged.readAsText('word/document.xml'), /yibiao:field:/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'output/fields.json'), 'utf8')).fields.length, fields.length);
  await fs.mkdir(path.join(root, 'pdf'));
  await promisify(execFile)('libreoffice', ['--headless', `-env:UserInstallation=file://${root}/office-profile`, '--convert-to', 'pdf', '--outdir', path.join(root, 'pdf'), path.join(root, 'output/template.docx')], { timeout: 30000, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', XDG_CACHE_HOME: '/tmp/yibiao-cache' } });
  assert.equal((await fs.readFile(path.join(root, 'pdf/template.pdf'))).subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(runOpenXmlJob(root, { action: 'list-blocks', sources: ['../source.docx'] }));
  await assert.rejects(runOpenXmlJob(root, { action: 'list-blocks', sources: ['source.docx'] }, 1), /超时/);
  const helper = process.env.YIBIAO_OPENXML_HELPER;
  try { process.env.YIBIAO_OPENXML_HELPER = path.join(root, 'missing-helper'); await assert.rejects(runOpenXmlJob(root, { action: 'list-blocks', sources: ['source.docx'] }), /未安装|不可启动/); }
  finally { if (helper === undefined) delete process.env.YIBIAO_OPENXML_HELPER; else process.env.YIBIAO_OPENXML_HELPER = helper; }
  const dirty = '<script>throw Error("must not execute")</script><iframe src="file:///etc/passwd"></iframe><div onmouseover="fetch(\'https://example.org\')">图表</div>';
  assert.doesNotMatch(sanitizeIllustrationHtml(dirty), /<script|<iframe|onmouseover/);
  const html = await renderLocalDiagram('html', `${dirty}<style>.box{border:3px solid #245ec0;padding:40px;font-size:32px}</style><div class="box">需求 → 实施 → 验收</div>`);
  const mermaid = await renderLocalDiagram('mermaid', 'flowchart LR\n A[需求] --> B[实施]\n B --> C[验收]');
  assert.equal(html.subarray(1, 4).toString(), 'PNG'); assert.equal(mermaid.subarray(1, 4).toString(), 'PNG');
  const generator = createRequire(import.meta.url)('../illustrations/vendor/contentIllustrationGeneration.cjs');
  const planner = createRequire(import.meta.url)('../illustrations/vendor/contentIllustrationPlanning.cjs');
  const outlineData = { outline: [{ id: '1', title: '流程', content: '需求确认后实施，验收结束交付。', content_mode: 'ai-generate' }, { id: '2', title: '组织', content: '项目经理组织实施，质量负责人核验。', content_mode: 'ai-generate' }] };
  const sections = Object.fromEntries(outlineData.outline.map((item) => [item.id, { status: 'success', content: item.content }]));
  const context = planner.buildIllustrationPlanningContext({ outlineData, sections, options: { useHtmlImages: true, useMermaidImages: true, htmlImageTypes: '组织图' }, aiImagesAvailable: false });
  const plan = planner.resolveIllustrationPlan(JSON.stringify({ items: [
    { kind: 'html', image_type: '组织图', title: '项目组织关系', section_ids: ['2'], placement: 'after', priority: 1 },
    { kind: 'mermaid', image_type: 'process', title: '实施验收流程', section_ids: ['1'], placement: 'after', priority: 1 },
  ] }), context).plan;
  assert.equal(plan.items.length, 2);
  const htmlItem = plan.items.find((item: any) => item.kind === 'html'); let htmlCalls = 0; let plannedHtml: Buffer | undefined;
  const htmlResult = await generator.generateHtmlIllustration({
    aiService: { chat: async () => { htmlCalls++; return `<html><head><style>body{margin:0;font-family:'Noto Sans CJK SC';font-size:${htmlCalls === 1 ? 12 : 28}px}.box{padding:32px;border:2px solid #245ec0}</style></head><body><div class="box">项目经理 → 实施与质量核验</div></body></html>`; } },
    execution: { planItem: htmlItem, reference: sections['2'].content }, plan,
    workspaceStore: { saveIllustrationHtml: () => ({ relativePath: 'native-fixture.html' }), saveIllustrationPng: ({ buffer }: { buffer: Buffer }) => { plannedHtml = buffer; return { assetUrl: 'yibiao-asset://fixture-html' }; } },
  });
  assert.ok(htmlCalls >= 2, 'layout diagnostics should trigger an actual HTML repair'); assert.ok(plannedHtml?.length);
  let mermaidCalls = 0;
  const mermaidResult = await generator.generateMermaidIllustration({ collectJsonResponse: async (request: any) => {
    mermaidCalls++; const result = request.normalizer({ code: mermaidCalls === 1 ? 'flowchart TD\n A[需求] --> B[验收]' : 'flowchart TD\n A["需求"] --> B["验收"]' }); request.validator(result); return result;
  } }, { planItem: plan.items.find((item: any) => item.kind === 'mermaid'), reference: sections['1'].content });
  assert.equal(mermaidCalls, 2); assert.equal(mermaidResult.attempts, 1);
  const word = await buildDocxResult({ project_name: '离线图表验收', outline: [{ id: '1', title: '配图', content: `![HTML](data:image/png;base64,${html.toString('base64')})\n\n\`\`\`mermaid\nflowchart LR\nA[输入] --> B[输出]\n\`\`\`` }] });
  const images = new AdmZip(word.buffer).getEntries().filter((entry) => /^word\/media\/.*\.png$/.test(entry.entryName));
  assert.equal(images.length, 2, JSON.stringify(word.warnings));
  const outputDir = process.env.YIBIAO_VERIFICATION_OUTPUT || '/tmp';
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'html.png'), html); await fs.writeFile(path.join(outputDir, 'mermaid.png'), mermaid);
  console.log(JSON.stringify({ openxml: 'passed', templateTableHeaderFooter: 'passed', templateOpensInLibreOffice: 'passed', templateFields: fields.length, html: 'passed', mermaid: 'passed', offlineWordImages: images.length,
    plannedImages: plan.items.length, htmlLayoutRepairs: htmlResult.visual_qa.layout_repair_attempts, mermaidRepairs: mermaidResult.attempts }));
} catch (error) { console.error((error as any).internalDetails || error); throw error; } finally { await fs.rm(root, { recursive: true, force: true }); }
