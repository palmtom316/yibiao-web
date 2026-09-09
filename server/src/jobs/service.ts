import { canonicalJson } from '../business-bid/sources';
import { randomUUID } from 'node:crypto';
import type { BackgroundJob, PrismaClient, Prisma } from '@prisma/client';
import { ApiError, requireProjectAccess, requireKnowledgeAccess } from '../security/access';
import { withProcessingScope } from '../security/processing';
import { eventBus } from '../events/bus';

export type JobUpdate = (status: string, progress: number) => Promise<void>;
export type JobRunner = (job: BackgroundJob, update: JobUpdate, signal: AbortSignal) => Promise<unknown>;
export class JobService {
  private runners = new Map<string, JobRunner>();
  private active = new Map<string, AbortController>();
  private closed = false;
  constructor(readonly prisma: PrismaClient) {}
  register(kind: string, runner: JobRunner) { this.runners.set(kind, runner); }
  async authorize(job: Pick<BackgroundJob, 'projectId' | 'knowledgeDocumentId' | 'userId'> & { kind?: string }, actorId: number) {
    if (job.kind?.startsWith('business-')) await requireKnowledgeAccess(this.prisma, actorId);
    if (job.projectId) await requireProjectAccess(this.prisma, actorId, job.projectId);
    else await requireKnowledgeAccess(this.prisma, actorId);
  }
  async start(input: { kind: string; userId: number; projectId?: number; knowledgeDocumentId?: string; input: Prisma.InputJsonValue; requestKey?: string }) {
    if (this.closed) throw new ApiError(503, '服务正在停止');
    if (!this.runners.has(input.kind)) throw new ApiError(503, '任务暂不可用');
    await this.authorize({ kind: input.kind, userId: input.userId, projectId: input.projectId || null, knowledgeDocumentId: input.knowledgeDocumentId || null }, input.userId);
    const requestKey = `${input.userId}:${input.projectId || input.knowledgeDocumentId}:${input.kind}:${input.requestKey || randomUUID()}`;
    const job = await this.prisma.backgroundJob.upsert({ where: { requestKey }, update: {}, create: { ...input, requestKey } });
    if (canonicalJson(job.input) !== canonicalJson(input.input)) throw new ApiError(409, '重试标识对应的输入已经变化');
    if (job.status === 'queued' && !this.active.has(job.id)) this.launch(job);
    return this.dto(job);
  }
  private launch(job: BackgroundJob) {
    const controller = new AbortController(); this.active.set(job.id, controller);
    const scope = job.projectId ? { kind: 'project' as const, projectId: job.projectId, userId: job.userId, requiredModules: job.kind.startsWith('business-') ? ['knowledge-base'] : [] } : { kind: 'shared' as const, userId: job.userId };
    const update: JobUpdate = async (status, progress) => {
      if (controller.signal.aborted) throw new ApiError(409, '任务已取消');
      const current = await this.prisma.backgroundJob.update({ where: { id: job.id }, data: { status, progress } });
      if (job.projectId) eventBus.emit(String(job.projectId), 'jobs', this.dto(current));
    };
    void withProcessingScope(scope, async () => {
      try {
        await update('running', 1);
        await this.authorize(job, job.userId);
        const result = await this.runners.get(job.kind)!(job, update, controller.signal);
        if (controller.signal.aborted) throw new ApiError(409, '任务已取消');
        await this.prisma.backgroundJob.update({ where: { id: job.id }, data: { result: JSON.parse(JSON.stringify(result ?? null)), status: 'success', progress: 100, error: null } });
      } catch (error) {
        await this.prisma.backgroundJob.updateMany({ where: { id: job.id }, data: { status: controller.signal.aborted ? 'cancelled' : 'error', error: error instanceof Error ? error.message.slice(0, 500) : '任务失败，可重试' } });
      } finally { this.active.delete(job.id); }
    }).catch(() => undefined);
  }
  async get(id: string, actorId: number) {
    const job = await this.prisma.backgroundJob.findUnique({ where: { id } });
    if (!job) throw new ApiError(404, '任务不存在'); await this.authorize(job, actorId); return job;
  }
  async retry(id: string, actorId: number) {
    const job = await this.get(id, actorId);
    if (this.closed) throw new ApiError(503, '服务正在停止');
    if (!this.runners.has(job.kind)) throw new ApiError(503, '任务暂不可重试');
    if (['error', 'cancelled'].includes(job.status)) {
      const result = await this.prisma.backgroundJob.updateMany({ where: { id, status: job.status }, data: { status: 'queued', error: null, attempts: { increment: 1 }, userId: actorId } });
      if (result.count) this.launch(await this.prisma.backgroundJob.findUniqueOrThrow({ where: { id } }));
    }
    return this.dto(await this.get(id, actorId));
  }
  async cancel(id: string, actorId: number) {
    await this.get(id, actorId); this.active.get(id)?.abort();
    await this.prisma.backgroundJob.updateMany({ where: { id, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', error: '已取消，原件和成功版本保留' } });
  }
  async recover() {
    await this.prisma.documentSource.updateMany({ where: { status: 'staging' }, data: { status: 'error' } });
    await this.prisma.backgroundJob.updateMany({ where: { status: { in: ['running', 'queued'] } }, data: { status: 'error', error: '服务重启中断，可从原件或已确认版本重试' } });
    await this.prisma.documentParseVersion.updateMany({ where: { status: 'running' }, data: { status: 'error', warnings: ['服务重启，成功旧版本仍保留'] } });
  }
  close() { this.closed = true; for (const controller of this.active.values()) controller.abort(); }
  dto(job: BackgroundJob) { return { jobId: job.id, kind: job.kind, status: job.status, progress: job.progress, result: job.status === 'success' ? job.result : undefined, error: job.error, attempts: job.attempts }; }
}
