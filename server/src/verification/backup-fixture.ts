// Populate known synthetic originals for the independent restore exercise.
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, Packer, Paragraph, ImageRun } from 'docx';
import { createPersonnelStore } from '../personnel/store';
import { createKnowledgeBaseStore } from '../knowledge-base/store';
import { ingestUpload, prepareDocument } from '../knowledge-base/pipeline';
import { getDataDir, getPersonnelCertFile } from '../document/paths';
import { sha256 } from '../document/sources';
if (process.env.YIBIAO_TEST_SCOPE !== 'yibiao-transform') throw Error('Synthetic scope required');
const prisma = new PrismaClient();
try {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  assert.equal(admin.mustChangePassword, false);
  const personnel = createPersonnelStore(prisma);
  const profile = await personnel.createProfile({ name: '合成备份人员', notes: '仅用于恢复演练' }, admin.id);
  const fileHashes: Record<string, string> = {};
  for (const suffix of ['A', 'B']) {
    const bytes = Buffer.from(`synthetic-certificate-${suffix}`);
    const meta = { fileId: `restore-${suffix}`, originalName: '合成证书原件.txt', ext: '.txt', mimeType: 'text/plain', size: bytes.length, sha256: sha256(bytes) };
    const certificate = await personnel.addCertificate(profile.id, { certName: `合成证书${suffix}`, certificateNo: `SYNTH-${suffix}`, validityKind: 'dated', expiryDate: '2027-09-08', files: [meta] }, admin.id);
    const target = getPersonnelCertFile(undefined, profile.id, certificate.id, meta.fileId, meta.ext);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); fileHashes[path.relative(getDataDir(), target)] = meta.sha256;
  }
  const kb = createKnowledgeBaseStore(prisma); const folder = await kb.createFolder('合成恢复知识');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=', 'base64');
  const input = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('合成项目实施方案。实施前由项目经理组织现场勘查，核对设备安装位置、供电条件及线缆通路，形成记录并提交业主确认。实施期间按楼层划分作业区域，完成设备安装、接线和标签检查后开展逐点测试。质量负责人核对安装记录、测试结果与问题整改清单，验收通过后移交竣工图、操作说明和维护资料。运行维护阶段记录设备状态和故障处理过程，定期检查备份是否可恢复。以上均为本机恢复演练的合成资料，不作为真实项目证明。'), new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 32, height: 32 } })] })] }] }));
  const { document } = await ingestUpload(kb, folder.id, '合成知识原件.docx', '.docx', input, admin.id);
  const prepared = await prepareDocument(kb, document.id, admin.id); assert.equal(prepared.success, true, prepared.document.error);
  const source = await prisma.documentSource.findFirstOrThrow({ where: { knowledgeDocumentId: document.id } });
  fileHashes[source.relativePath] = source.sha256;
  for (const asset of await prisma.documentAsset.findMany({ where: { knowledgeDocumentId: document.id } })) fileHashes[asset.relativePath] = asset.sha256;
  const article = await prisma.docsArticle.upsert({ where: { id: 'synthetic-restore-article' }, create: { id: 'synthetic-restore-article', section: 'usage', title: '管理员自定义恢复验证', content: '自定义正文必须在重复初始化和恢复后保持不变。', sortOrder: 314, updatedById: admin.id }, update: {} });
  const fixture = { kind: 'synthetic-local-fixture', userId: admin.id, username: admin.username, passwordHash: admin.password, profileId: profile.id, documentId: document.id,
    article: { id: article.id, title: article.title, content: article.content, sortOrder: article.sortOrder }, fileHashes };
  const target = path.join(getDataDir(), 'verification', 'restore-fixture.json'); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, JSON.stringify(fixture), { mode: 0o600 });
  console.log(JSON.stringify({ fixture: 'ready', originalFiles: Object.keys(fileHashes).length, certificates: 2, knowledgeDocument: document.id }));
} finally { await prisma.$disconnect(); }
