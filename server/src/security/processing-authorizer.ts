import type { PrismaClient } from '@prisma/client';
import { parseModules } from '../auth/permissions';
import { ProcessingDeniedError, type ProcessingScope } from './processing';

export function createProcessingAuthorizer(prisma: PrismaClient) {
return async (scope: ProcessingScope) => {
  const user = await prisma.user.findUnique({ where: { id: scope.userId } });
  if (!user || user.status !== 'active' || user.mustChangePassword) throw new ProcessingDeniedError('账号处理权限已失效');
  if (scope.kind === 'project') {
    if (user.role !== 'admin' && ((scope.includesSharedData && !parseModules(user.modules).includes('knowledge-base')) || scope.requiredModules?.some((module) => !parseModules(user.modules).includes(module)))) throw new ProcessingDeniedError('任务所需模块授权已失效');
    const project = await prisma.project.findUnique({ where: { id: scope.projectId } });
    if (!project || (project.ownerId !== user.id && user.role !== 'admin')) throw new ProcessingDeniedError('无项目处理权限');
    const sharedPolicy = scope.includesSharedData ? await prisma.appConfig.findUnique({ where: { id: 1 } }) : null;
    const sharedAllowed = !scope.includesSharedData || (sharedPolicy?.data as Record<string, unknown> | null)?.allow_external_processing_shared === true;
    return { allowExternal: project.allowExternalProcessing === true && sharedAllowed };
  }
  if (scope.kind === 'shared' && user.role !== 'admin' && !parseModules(user.modules).includes('knowledge-base')) {
    throw new ProcessingDeniedError('无资料处理权限');
  }
  if (scope.kind === 'administration' && user.role !== 'admin') throw new ProcessingDeniedError('需要管理员权限');
  const config = await prisma.appConfig.findUnique({ where: { id: 1 } });
  return { allowExternal: scope.kind === 'shared' && (config?.data as Record<string, unknown> | null)?.allow_external_processing_shared === true };
};
}
