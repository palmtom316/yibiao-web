import type { PrismaClient, Prisma } from '@prisma/client';
import { parseModules } from '../auth/permissions';
export type Database = PrismaClient | Prisma.TransactionClient;
export class ApiError extends Error {
  constructor(readonly statusCode: number, message: string, readonly details?: unknown) { super(message); }
}
export async function requireActor(db: Database, userId: number) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'active' || user.mustChangePassword) throw new ApiError(401, '账号不可用，请重新登录');
  return user;
}
export async function requireKnowledgeAccess(db: Database, userId: number) {
  const user = await requireActor(db, userId);
  if (user.role !== 'admin' && !parseModules(user.modules).includes('knowledge-base')) throw new ApiError(403, '无资料库权限');
  return user;
}
export async function requireProjectAccess(db: Database, userId: number, projectId: number) {
  const user = await requireActor(db, userId);
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(404, '项目不存在');
  if (project.ownerId !== user.id && user.role !== 'admin') throw new ApiError(403, '无项目访问权限');
  return project;
}
