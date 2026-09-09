import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getDataDir } from '../document/paths';
import { hashFile } from '../business-bid/snapshots';
import { loadAuthorizedAsset, sha256 } from '../document/sources';
import { exportWordToBuffer } from '../export/service';
import AdmZip from 'adm-zip';
if (process.env.YIBIAO_TEST_SCOPE !== 'yibiao-transform') throw Error('Synthetic scope required');
const prisma = new PrismaClient();
try {
  const fixture = JSON.parse(await fs.readFile(path.join(getDataDir(), 'verification', 'restore-fixture.json'), 'utf8'));
  assert.equal(fixture.kind, 'synthetic-local-fixture');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
  assert.equal(user.username, fixture.username); assert.equal(user.password, fixture.passwordHash); assert.equal(user.mustChangePassword, false);
  const article = await prisma.docsArticle.findUniqueOrThrow({ where: { id: fixture.article.id } });
  for (const key of ['title', 'content', 'sortOrder']) assert.equal((article as any)[key], fixture.article[key]);
  assert.equal(await prisma.personnelCertificate.count({ where: { profileId: fixture.profileId } }), 2);
  assert.ok(await prisma.knowledgeDocument.findUnique({ where: { documentId: fixture.documentId } }));
  for (const [relative, expected] of Object.entries(fixture.fileHashes)) assert.equal(await hashFile(path.join(getDataDir(), relative)), expected);
  const contents = await prisma.technicalPlanOutlineNode.count({ where: { content: { not: '' } } }); assert.ok(contents > 0);
  const asset = await prisma.documentAsset.findFirstOrThrow({ where: { knowledgeDocumentId: fixture.documentId } });
  const restoredImage = await loadAuthorizedAsset(prisma, user.id, asset.id);
  const word = await exportWordToBuffer({ project_name: '恢复后的图文验收', outline: [{ id: '1', title: '恢复知识图片', content: `![恢复图片](yibiao-asset://${asset.id})` }], assetResolver: async (id) => ({ buffer: (await loadAuthorizedAsset(prisma, user.id, id)).buffer, type: 'png' }) });
  const media = new AdmZip(word.buffer).getEntries().filter((entry) => !entry.isDirectory && /^word\/media\//.test(entry.entryName));
  assert.equal(media.length, 1); assert.equal(sha256(media[0]!.getData()), sha256(restoredImage.buffer));
  console.log(JSON.stringify({ restoredUserAndPassword: 'passed', customArticleAndOrder: 'passed', personnelCertificates: 2, originalHashes: Object.keys(fixture.fileHashes).length, savedChapters: contents, restoredImageInWord: 'passed' }));
} finally { await prisma.$disconnect(); }
