import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { createAiDiagnosticsService } from './service';

type DiagnosticsApp = FastifyInstance & {
  prisma: PrismaClient;
  aiDiagnostics: ReturnType<typeof createAiDiagnosticsService>;
};

interface DiagnosticListQuery {
  page?: string;
  pageSize?: string;
  taskType?: string;
  status?: string;
  model?: string;
  from?: string;
  to?: string;
  projectCode?: string;
}

function publicAttempt(attempt: { responseFile?: string | null } | null | undefined) {
  if (!attempt) return attempt;
  const { responseFile: _responseFile, ...value } = attempt;
  return { ...value, hasFailureContent: Boolean(attempt.responseFile) };
}

function parsePositiveInt(value: string | undefined, fallback: number): number | null {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseOptionalDate(value: string | undefined): Date | undefined | null {
  if (value == null || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function aiDiagnosticRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  const { prisma, aiDiagnostics } = app as DiagnosticsApp;

  app.get('/ai-diagnostics', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = (req.query || {}) as DiagnosticListQuery;
    const page = parsePositiveInt(query.page, 1);
    const pageSize = parsePositiveInt(query.pageSize, 20);
    if (page == null || page < 1 || pageSize == null || pageSize < 1 || pageSize > 100) {
      return reply.code(400).send({ error: '分页参数无效' });
    }
    const from = parseOptionalDate(query.from);
    const to = parseOptionalDate(query.to);
    if (from === null || to === null) return reply.code(400).send({ error: '日期参数无效' });

    const where: Prisma.AiDiagnosticRunWhereInput = {};
    if (query.taskType) where.taskType = query.taskType;
    if (query.status) where.status = query.status;
    if (query.model) where.model = { contains: query.model, mode: 'insensitive' };
    if (from || to) where.startedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
    if (query.projectCode) {
      const projects = await prisma.project.findMany({
        where: { projectCode: { contains: query.projectCode, mode: 'insensitive' } },
        select: { id: true },
      });
      const ids = projects.map((project) => project.id);
      if (ids.length === 0) return { items: [], page, pageSize };
      where.projectId = { in: ids };
    }
    const rows = await aiDiagnostics.listRuns({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize });
    return { items: rows || [], page, pageSize };
  });

  app.get('/ai-diagnostics/:traceId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { traceId } = req.params as { traceId: string };
    const run = await aiDiagnostics.getRun(traceId) as { attempts?: Array<{ id: string; responseFile?: string | null }> } | null | undefined;
    if (!run) return reply.code(404).send({ error: '诊断记录不存在或已过期' });
    return { ...run, attempts: (run.attempts || []).map(publicAttempt) };
  });

  app.get('/ai-diagnostics/:traceId/attempts/:attemptId/content', async (req: FastifyRequest, reply: FastifyReply) => {
    const { traceId, attemptId } = req.params as { traceId: string; attemptId: string };
    const run = await aiDiagnostics.getRun(traceId) as { attempts?: Array<{ id: string; responseFile?: string | null }> } | null | undefined;
    const attempt = run?.attempts?.find((item) => item.id === attemptId);
    if (!attempt?.responseFile) return reply.code(404).send({ error: '失败响应不存在或已过期' });
    try {
      return { content: await aiDiagnostics.readFailure(attempt.responseFile) };
    } catch {
      return reply.code(404).send({ error: '失败响应不存在或已过期' });
    }
  });
}
