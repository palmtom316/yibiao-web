import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { JobService } from '../jobs/service';
import { getProjectId, getUserId } from '../auth/middleware';
import { persistSource, parseSource } from './sources';
import { checkUploadLimits } from '../resources/uploads';
import { ApiError } from '../security/access';
import type { ParsedImport } from './parser';

export function registerImportJob(jobs: JobService, kind: string, publish: (projectId: number, docs: ParsedImport[], input: any) => Promise<unknown>) {
  jobs.register(kind, async (job, update, signal) => {
    const input = job.input as { sourceIds: string[] };
    const docs: ParsedImport[] = [];
    for (const sourceId of input.sourceIds) {
      if (signal.aborted) throw new ApiError(409, '任务已取消，原件保留');
      const source = await jobs.prisma.documentSource.findUniqueOrThrow({ where: { id: sourceId } });
      if (source.projectId !== job.projectId) throw new ApiError(403, '原件不属于当前项目');
      docs.push(await parseSource(jobs.prisma, sourceId, job.userId, update, signal));
    }
    if (signal.aborted) throw new ApiError(409, '任务已取消，原件保留');
    return publish(job.projectId!, docs, input);
  });
}
export async function startImport(req: FastifyRequest, kind: string, extra: Record<string, string> = {}) {
  const { prisma, jobs } = req.server as unknown as { prisma: PrismaClient; jobs: JobService };
  const projectId = getProjectId(req); const userId = getUserId(req);
  const sourceIds = []; let total = 0;
  for await (const part of req.files()) {
    const buffer = await part.toBuffer(); total += buffer.length;
    checkUploadLimits(buffer.length, total, sourceIds.length + 1);
    const source = await persistSource(prisma, { projectId }, userId, part.filename, part.mimetype, buffer);
    sourceIds.push(source.id);
  }
  if (!sourceIds.length) throw new ApiError(400, '请上传原件');
  return jobs.start({ kind, userId, projectId, input: { ...extra, sourceIds } });
}
