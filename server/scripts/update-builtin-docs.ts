import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { bundledDocs } from '../prisma/seed-docs';
const prisma = new PrismaClient();
const version = process.argv[process.argv.indexOf('--version') + 1];
if (version !== '2026-09-08') throw new Error('Choose the reviewed content version with --version 2026-09-08');
const known = JSON.parse(fs.readFileSync(new URL('../prisma/seed-docs-versions.json', import.meta.url), 'utf8'));
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const report = [];
try {
  for (const item of bundledDocs()) {
    const current = await prisma.docsArticle.findUnique({ where: { id: item.id } });
    const unchanged = current && !current.updatedById && known[item.id]?.some((old: any) => old.hash === digest(current.content) && old.title === current.title);
    const status = !current ? 'missing' : current.content === item.content && current.title === item.title ? 'current' : unchanged ? 'upgradable' : 'preserved-custom';
    report.push({ id: item.id, status, fromHash: current ? digest(current.content) : null, toHash: digest(item.content), version });
    if (process.argv.includes('--apply') && status === 'upgradable') {
      await prisma.docsArticle.updateMany({ where: { id: item.id, content: current!.content, title: current!.title, updatedById: null }, data: { content: item.content, title: item.title } });
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await prisma.$disconnect(); }
