import 'dotenv/config';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { migrateLegacyPersonnel } from '../src/personnel/legacy-migration';
const value = (flag: string) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
const actor = Number(value('--actor-user-id'));
if (!Number.isSafeInteger(actor) || actor < 1) throw new Error('Provide --actor-user-id of the authorized migration operator');
const mapping = value('--mapping'); const prisma = new PrismaClient();
try {
  const report = await migrateLegacyPersonnel(prisma, mapping ? JSON.parse(fs.readFileSync(mapping, 'utf8')) : {}, actor, process.argv.includes('--apply'));
  console.log(JSON.stringify(report, null, 2));
  if (report.counts.conflict) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
