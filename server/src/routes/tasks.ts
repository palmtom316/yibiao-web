import { createRequireModule, parseModules } from '../auth/permissions';
// 任务引擎命名空间路由（受保护，按 projectId 隔离；requireProject preHandler 已挂 req.projectId）。
// 1:1 对齐桌面 client/electron/ipc/taskIpc.cjs 的 11 个通道：
// 9 个 start-* / 1 个 pause-content-generation / 1 个 get-active。
// 每个 start 返回当前 BackgroundTaskState（已写库 + 已广播 'tasks' 事件）。
// get-active 先跑崩溃恢复再把残留 running 标 error（与桌面 getActiveTasks 一致）。
//
// L3：runners 未注册时 start-* 抛 400 "执行器尚未注册（待 P6-L4 移植）"，
// 但 get-active / 组锁 / 崩溃恢复 / SSE 广播 已可用，可独立验证。
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { getProjectId, getUserId } from '../auth/middleware';
import type { TaskService } from '../tasks/service';

export async function taskRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  const taskService = (app as unknown as { taskService: TaskService }).taskService;
  app.addHook('preHandler', async (req, reply) => {
    if (/\/start-(?:rejection-items-extraction|rejection-check|duplicate-analysis)(?:\?|$)/.test(req.url)) await createRequireModule((app as unknown as { prisma: import('@prisma/client').PrismaClient }).prisma, 'bid-check')(req, reply);
  });
  const bodyOf = (req: FastifyRequest) => ((req as FastifyRequest & { body: unknown }).body ?? undefined) as Record<string, unknown> | undefined;

  const startHandler =
    (fn: (projectId: number, payload: Record<string, unknown> | undefined) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(getProjectId(req), { ...bodyOf(req), __actorUserId: getUserId(req) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = /执行器尚未注册/.test(message) ? 501 : 409;
        return reply.code(code).send({ error: message });
      }
    };

  app.get('/tasks/snapshot', async (req) => {
    const projectId = getProjectId(req);
    const prisma = (app as unknown as { prisma: import('@prisma/client').PrismaClient }).prisma;
    const user = (req as unknown as { user: { role: string; id: number } }).user;
    const [{ createTechnicalPlanStore }, { createRejectionCheckStore }, { createDuplicateCheckStore }, { parseModules }] = await Promise.all([
      import('../technical-plan/store'), import('../rejection-check/store'), import('../duplicate-check/store'), import('../auth/permissions'),
    ]);
    const account = await prisma.user.findUnique({ where: { id: user.id } });
    const bidCheck = account?.role === 'admin' || parseModules(account?.modules).includes('bid-check');
    return {
      technicalPlanPatch: await createTechnicalPlanStore(prisma).loadTechnicalPlan(projectId),
      ...(bidCheck ? {
        rejectionCheck: await createRejectionCheckStore(prisma).loadRejectionCheck(projectId),
        duplicateCheck: await createDuplicateCheckStore(prisma).loadDuplicateCheck(projectId),
      } : {}),
    };
  });

  app.post('/tasks/start-bid-section-extraction', startHandler((u, p) => taskService.startBidSectionExtraction(u, p)));
  app.post('/tasks/start-bid-analysis', startHandler((u, p) => taskService.startBidAnalysis(u, p)));
  app.post('/tasks/start-outline-generation', startHandler((u, p) => taskService.startOutlineGeneration(u, p)));
  app.post('/tasks/start-global-facts-generation', startHandler((u, p) => taskService.startGlobalFactsGeneration(u, p)));
  app.post('/tasks/start-content-generation', startHandler((u, p) => taskService.startContentGeneration(u, p)));
  app.post('/tasks/start-rejection-items-extraction', startHandler((u, p) => taskService.startRejectionItemsExtraction(u, p)));
  app.post('/tasks/start-rejection-check', startHandler((u, p) => taskService.startRejectionCheck(u, p)));
  app.post('/tasks/start-duplicate-analysis', startHandler((u, p) => taskService.startDuplicateAnalysis(u, p)));
  app.post('/tasks/start-response-deviation-generation', startHandler((u, p) => taskService.startResponseDeviationGeneration(u, p)));

  app.post('/tasks/pause-content-generation', async (req, reply) => {
    try {
      return await taskService.pauseContentGeneration(getProjectId(req));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(409).send({ error: message });
    }
  });

  app.get('/tasks/active', async (req) => {
    const prisma = (app as unknown as { prisma: import('@prisma/client').PrismaClient }).prisma;
    const account = await prisma.user.findUnique({ where: { id: getUserId(req) } });
    const allowed = account?.role === 'admin' || parseModules(account?.modules).includes('bid-check');
    const tasks = await taskService.getActiveTasks(getProjectId(req));
    return allowed ? tasks : tasks.filter((task) => !['duplicate-analysis', 'rejection-check-run', 'rejection-items-extraction'].includes(task.type));
  });
}
