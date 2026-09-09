import { Prisma, type PrismaClient } from '@prisma/client';

export async function searchKnowledge(prisma: PrismaClient, keyword: unknown, requestedPage: unknown) {
  const word = typeof keyword === 'string' ? keyword.trim().slice(0, 200) : '';
  const pageSize = 100;
  if (!word) return { items: [], total: 0, page: 1, pageSize };
  const pattern = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
  const where = Prisma.sql`d.status = 'success' AND d."archivedAt" IS NULL AND k."archivedAt" IS NULL
    AND (d."fileName" ILIKE ${pattern} OR k.title ILIKE ${pattern} OR k.resume ILIKE ${pattern} OR k.content ILIKE ${pattern})
    AND NOT EXISTS (SELECT 1 FROM knowledge_use_restrictions kr LEFT JOIN performance_records p ON p.id=kr."performanceSourceId" WHERE kr."documentId"=d."documentId" AND (p.id IS NULL OR p."isPubliclyCitable"=false OR p."archivedAt" IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM performance_knowledge_documents pd JOIN performance_records p ON p.id=pd."recordId" WHERE pd."documentId"=d."documentId" AND p."isPubliclyCitable"=false)`;
  const counts = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT count(*) AS total FROM knowledge_items k JOIN knowledge_documents d ON d."documentId"=k."documentId" WHERE ${where}`);
  const total = Number(counts[0].total); const input = Number(requestedPage);
  const page = Math.max(1, Math.min(Number.isSafeInteger(input) && input > 0 ? input : 1, Math.ceil(total / pageSize) || 1));
  const items = await prisma.$queryRaw(Prisma.sql`SELECT k.id, k."itemId", k."documentId", k.title, k.resume, substring(k.content,1,4000) AS content, d."fileName"
    FROM knowledge_items k JOIN knowledge_documents d ON d."documentId"=k."documentId" WHERE ${where}
    ORDER BY d."fileName", d."documentId", k."sortOrder", k.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  return { items, total, page, pageSize };
}
