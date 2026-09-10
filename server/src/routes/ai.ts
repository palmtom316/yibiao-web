import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../auth/middleware';
import { bindConfigScope } from '../security/processing';
import { createRequireProject, getProjectIdHeader, getProjectId } from '../auth/middleware';
import type { PrismaClient } from '@prisma/client';
import { buildMerged } from '../config/store';
import { getAiService } from '../ai/service';

// 受保护路由（需登录）：AI 代理。服务端持真实 key，浏览器永远拿不到明文 key。
// POST /api/ai/chat             → 文本对话（上游流式内部聚合，返回完整 content 字符串）
// POST /api/ai/request-json     → JSON 结构化请求（带重试 + 修复，返回解析后对象）
// POST /api/ai/list-models      → 拉取上游模型列表（body 为表单 config 覆盖，可选）
// POST /api/ai/test-image-model → 生图模型连通性测试（body 为表单 config，含真实 key）
export async function aiRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma;
  const ai = getAiService();

  // aiService 抛出的 Error 带 .status/.message + 可能的 aiHttpError（上游响应）。
  // 关键：绝不能把上游 401（API key 无效）透传成路由 401——客户端 http 拦截器会把 401
  // 当作"JWT 失效"自动登出。上游错误统一映射为 502（网关），本地配置/校验错误 400。
  function sendError(reply: any, error: any) {
    let code = 500;
    if (error?.aiHttpError || error?.ai_http_error) code = 502;
    else if ([400, 403].includes(error?.statusCode)) code = error.statusCode;
    else if (error?.status === 400) code = 400;
    reply.code(code);
    return { success: false, message: error?.message || 'AI 请求失败' };
  }

  app.addHook('preHandler', async (req, reply) => {
    if (req.url.split('?')[0].endsWith('/chat') || req.url.split('?')[0].endsWith('/request-json')) {
      await createRequireProject(prisma)(req, reply);
    } else if ((req as FastifyRequest & { user: JwtPayload }).user.role !== 'admin') {
      return reply.code(403).send({ error: '仅管理员可测试处理端点' });
    }
  });

  // 在 config 上打戳当前项目 id（best-effort 读 X-Project-Id 头；/ai 非项目作用域，不强求），
  // 供 aiService 深栈里的 emitAiHttpError 据此向触发项目的 SSE 通道 fan-out AI 上游错误。
  function stampProjectId(config: any, req: FastifyRequest): any {
    const projectId = getProjectIdHeader(req);
    if (config && typeof config === 'object' && projectId) {
      config.__sseProjectId = projectId;
    }
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    const scopedId = getProjectId(req);
    return bindConfigScope(config, scopedId ? { kind: 'project', projectId: scopedId, userId: user.id } : { kind: 'administration', userId: user.id });
  }

  app.post('/ai/chat', async (req, reply) => {
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    const body = (req as FastifyRequest & { body: unknown }).body;
    try {
      const config = stampProjectId(await buildMerged(prisma, user.id), req);
      const content = await ai.chat(config, body);
      return { content };
    } catch (error: any) {
      return sendError(reply, error);
    }
  });

  app.post('/ai/request-json', async (req, reply) => {
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    const body = (req as FastifyRequest & { body: unknown }).body;
    try {
      const config = stampProjectId(await buildMerged(prisma, user.id), req);
      const result = await ai.requestJson(config, body);
      return { result };
    } catch (error: any) {
      return sendError(reply, error);
    }
  });

  app.post('/ai/list-models', async (req, reply) => {
    const user = (req as FastifyRequest & { user: JwtPayload }).user;
    const body = (req as FastifyRequest & { body: unknown }).body as any;
    try {
      const stored = await buildMerged(prisma, user.id);
      const provider = body?.text_model_provider || stored.text_model_provider;
      const profile = stored.text_model_profiles?.[provider] || {};
      const config = stampProjectId({ ...stored, ...profile, ...body, api_key: body?.api_key || profile.api_key || stored.api_key }, req);
      return await ai.listModels(config);
    } catch (error: any) {
      return sendError(reply, error);
    }
  });

  app.post('/ai/test-image-model', async (req, reply) => {
    const body = (req as FastifyRequest & { body: unknown }).body as any;
    try {
      // 表单 config（含真实 key）由前端提供；服务端只做代理测试，不落盘。
      const user = (req as FastifyRequest & { user: JwtPayload }).user;
      const stored = await buildMerged(prisma, user.id);
      const provider = body?.image_model?.provider || stored.image_model?.provider;
      const profile = stored.image_model_profiles?.[provider] || {};
      return await ai.testImageModel(stampProjectId({ ...stored, ...body, image_model: { ...profile, ...body?.image_model, api_key: body?.image_model?.api_key || profile.api_key } }, req));
    } catch (error: any) {
      return sendError(reply, error);
    }
  });
}
