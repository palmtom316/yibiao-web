import { ApiError } from '../security/access';
import { getUserId } from '../auth/middleware';
import { ledgerFields } from '../ledger/multipart';
import { expectedVersion } from '../ledger/validation';
// 资产/资质库路由（受保护 + 模块门禁 knowledge-base，公司共享）。
// 三库共用：工具模板库 tool / 公司资质库 company / 人员资质库 personnel，:library 参数白名单。
// 写操作用 multipart：字段 name/notes/expiryDate/tags/removeFileIds + 多个文件 part。
// 文件字节落 <dataDir>/shared/asset-library/<library>/<itemId>/<fileId><ext>；下载经 GET .../files/:fileId 流式返回。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createAssetLibraryStore, ASSET_LIBRARIES, type AssetLibrary, type AssetFileMeta, type ExpiryFilter } from '../asset-library/store';
import { getAssetFilePath } from '../document/paths';
import {
  mimeFor,
  collectAssetParts,
  persistUploaded,
  withUploadedFiles,
  asString,
  asStringList,
} from '../asset-library/multipart';

function parseLibrary(raw: unknown): AssetLibrary | null {
  return ASSET_LIBRARIES.includes(raw as AssetLibrary) ? (raw as AssetLibrary) : null;
}

function parseExpiry(raw: unknown): ExpiryFilter | undefined {
  const v = asString(raw as string | string[] | undefined);
  return v === 'active' || v === 'expiring' || v === 'expired' ? v : undefined;
}

async function persistFiles(library: AssetLibrary, itemId: string, uploads: { filename: string; mimetype: string; buffer: Buffer }[]): Promise<AssetFileMeta[]> {
  return persistUploaded(uploads, (fileId, ext) => getAssetFilePath(undefined, library, itemId, fileId, ext));
}

export async function assetLibraryRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma;
  const store = createAssetLibraryStore(prisma);
  app.addHook('preHandler', async (req, reply) => {
    if ((req.params as { library?: string }).library === 'personnel' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) reply.code(410).send({ message: '旧人员库已停止写入，请使用一人多证人员库' });
  });

  // GET /asset-library/:library?q=&expiry= → { items, counts }
  app.get('/asset-library/:library', async (req, reply) => {
    const library = parseLibrary((req as FastifyRequest & { params: { library: string } }).params.library);
    if (!library) return reply.code(400).send({ success: false, message: '无效的库类型' });
    const query = (req as FastifyRequest & { query: { q?: string; expiry?: string } }).query;
    const [items, counts] = await Promise.all([
      store.listItems(library, { q: query.q, expiry: parseExpiry(query.expiry) }),
      store.countByExpiry(library),
    ]);
    if (library === 'personnel') {
      const mappings = await prisma.legacyPersonnelMigration.findMany({ where: { sourceId: { in: items.map((item) => item.id) } } });
      return { items: items.map((item) => ({ ...item, migratedTo: mappings.find((mapping) => mapping.sourceId === item.id) || null })), counts, readOnly: true };
    }
    return { items, counts };
  });

  // POST /asset-library/:library (multipart) → { item }
  app.post('/asset-library/:library', async (req, reply) => {
    const library = parseLibrary((req as FastifyRequest & { params: { library: string } }).params.library);
    if (!library) return reply.code(400).send({ success: false, message: '无效的库类型' });
    const { fields, files } = await collectAssetParts(req);
    const name = asString(fields.name).trim();
    if (!name) return reply.code(400).send({ success: false, message: '名称不能为空' });
    if (!asString(fields.category)) throw new ApiError(400, '请先选择资料类型');

    const item = await store.createItem(library, {
      ...ledgerFields(fields),
      name,
      notes: asString(fields.notes),
      expiryDate: asString(fields.expiryDate) || null,
      tags: asStringList(fields.tags),
    }, getUserId(req));
    if (files.length) {
      const updated = await withUploadedFiles(files, (fileId, ext) => getAssetFilePath(undefined, library, item.id, fileId, ext), (metas) => store.updateItem(library, item.id, { files: metas, version: item.version }, getUserId(req)));
      return { item: updated };
    }
    return { item };
  });

  // GET /asset-library/:library/:id → { item }
  app.get('/asset-library/:library/:id', async (req, reply) => {
    const library = parseLibrary((req as FastifyRequest & { params: { library: string } }).params.library);
    if (!library) return reply.code(400).send({ success: false, message: '无效的库类型' });
    const { id } = (req as FastifyRequest & { params: { id: string } }).params;
    const item = await store.getItem(library, id);
    if (!item) return reply.code(404).send({ success: false, message: '条目不存在' });
    return { item };
  });

  // PATCH /asset-library/:library/:id (multipart) → { item }
  // 字段 name/notes/expiryDate/tags/removeFileIds + 新文件 part。
  app.patch('/asset-library/:library/:id', async (req, reply) => {
    const library = parseLibrary((req as FastifyRequest & { params: { library: string } }).params.library);
    if (!library) return reply.code(400).send({ success: false, message: '无效的库类型' });
    const { id } = (req as FastifyRequest & { params: { id: string } }).params;
    const current = await store.getItem(library, id);
    if (!current) return reply.code(404).send({ success: false, message: '条目不存在' });

    const { fields, files } = await collectAssetParts(req);
    if (expectedVersion(asString(fields.version)) !== current.version) throw new ApiError(409, '资料已被更新，请刷新');
    const removeFileIds = asStringList(fields.removeFileIds);
    const item = await withUploadedFiles(files, (fileId, ext) => getAssetFilePath(undefined, library, id, fileId, ext), (newMetas) => store.updateItem(library, id, {
      ...ledgerFields(fields),
      version: expectedVersion(asString(fields.version)),
      name: asString(fields.name) || undefined,
      notes: fields.notes !== undefined ? asString(fields.notes) : undefined,
      expiryDate: fields.expiryDate !== undefined ? (asString(fields.expiryDate) || null) : undefined,
      tags: fields.tags !== undefined ? asStringList(fields.tags) : undefined,
      files: [...current.files.filter((f) => !removeFileIds.includes(f.fileId)), ...newMetas],
    }, getUserId(req)));
    // 删除被移除文件的字节
    for (const fid of removeFileIds) {
      const meta = current.files.find((f) => f.fileId === fid);
      if (meta) {
        const p = getAssetFilePath(undefined, library, id, meta.fileId, meta.ext);
        await fsp.rm(p, { force: true }).catch(() => undefined);
      }
    }

    return { item };
  });

  // DELETE /asset-library/:library/:id → { success }
  app.delete('/asset-library/:library/:id', async (req, reply) => {
    const library = parseLibrary((req as FastifyRequest & { params: { library: string } }).params.library);
    if (!library) return reply.code(400).send({ success: false, message: '无效的库类型' });
    const { id } = (req as FastifyRequest & { params: { id: string } }).params;
    await store.deleteItem(library, id, (req.query as any).version, getUserId(req), (req.query as any).permanent === 'true');
    return { success: true };
  });

  // GET /asset-library/:library/:id/files/:fileId?download=1 → 文件字节流（Bearer 鉴权）。
  app.get('/asset-library/:library/:id/files/:fileId', async (req, reply) => {
    const library = parseLibrary((req as FastifyRequest & { params: { library: string } }).params.library);
    if (!library) return reply.code(400).send({ success: false, message: '无效的库类型' });
    const { id, fileId } = (req as FastifyRequest & { params: { id: string; fileId: string } }).params;
    const item = await store.getItem(library, id);
    if (!item) return reply.code(404).send({ success: false, message: '条目不存在' });
    const meta = item.files.find((f) => f.fileId === fileId);
    if (!meta) return reply.code(404).send({ success: false, message: '文件不存在' });

    const abs = getAssetFilePath(undefined, library, id, meta.fileId, meta.ext);
    try {
      await fsp.access(abs);
    } catch {
      return reply.code(404).send({ success: false, message: '文件不存在' });
    }
    const isDownload = (req as FastifyRequest & { query: { download?: string } }).query.download === '1';
    reply.header('Content-Type', mimeFor(meta.originalName));
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    if (isDownload) {
      const safeName = encodeURIComponent(meta.originalName);
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
    }
    return reply.send(fs.createReadStream(abs));
  });

  // GET /asset-library/expiring?withinDays=30 → { items }（仪表盘聚合，跨库）
  app.get('/asset-library/expiring', async (req) => {
    const withinDaysRaw = Number((req as FastifyRequest & { query: { withinDays?: string } }).query.withinDays);
    const withinDays = Number.isFinite(withinDaysRaw) && withinDaysRaw > 0 ? withinDaysRaw : 30;
    const items = await store.listExpiring(withinDays);
    return { items };
  });
}
