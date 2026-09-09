import { AsyncLocalStorage } from 'node:async_hooks';

export type ProcessingScope = { kind: 'project'; projectId: number; userId: number; requiredModules?: string[]; includesSharedData?: boolean }
  | { kind: 'shared' | 'administration'; userId: number };
type Authorizer = (scope: ProcessingScope) => Promise<{ allowExternal: boolean }>;
const scopes = new AsyncLocalStorage<ProcessingScope>();
const configScopes = new WeakMap<object, ProcessingScope>();
let authorize: Authorizer = async () => { throw new ProcessingDeniedError('尚未建立处理权限校验'); };

export class ProcessingDeniedError extends Error {
  readonly statusCode = 403;
  readonly retryable = false;
  constructor(message: string) { super(message); }
}
export function setProcessingAuthorizer(authorizer: Authorizer): void { authorize = authorizer; }
export function currentProcessingScope(): ProcessingScope | undefined { return scopes.getStore(); }
export function bindConfigScope<T extends object>(config: T, scope: ProcessingScope): T {
  configScopes.set(config, scope);
  return config;
}
export function withProcessingScope<T>(scope: ProcessingScope, action: () => T): T {
  return scopes.run(scope, action);
}
export function withConfigScope<T>(config: object, action: () => T): T {
  const scope = configScopes.get(config) || scopes.getStore();
  // Local parsing and deterministic tests need no processing authorization until an actual send.
  return scope ? scopes.run(scope, action) : action();
}
function matchesEndpoint(url: URL, raw: string | undefined): boolean {
  return (raw || '').split(',').filter(Boolean).some((entry) => {
    try {
      const allowed = new URL(entry.trim());
      const prefix = allowed.pathname.replace(/\/$/, '');
      return !allowed.username && !allowed.password && url.origin === allowed.origin
        && (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    } catch { return false; }
  });
}
export async function assertProcessingUrl(input: string | URL, scope = scopes.getStore()): Promise<URL> {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new ProcessingDeniedError('处理端点格式不受支持');
  }
  if (!scope) throw new ProcessingDeniedError('缺少已授权的数据域，禁止发送资料');
  const policy = await authorize(scope); // Recheck current permissions for every attempt.
  if (matchesEndpoint(url, process.env.YIBIAO_INTERNAL_ENDPOINTS)) return url;
  if (policy.allowExternal && matchesEndpoint(url, process.env.YIBIAO_EXTERNAL_ENDPOINTS)) return url;
  throw new ProcessingDeniedError('此数据域未获准使用该处理端点，请联系管理员');
}
export async function processingFetch(input: string | URL, init: RequestInit = {}, scope = scopes.getStore()): Promise<Response> {
  const url = await assertProcessingUrl(input, scope);
  const response = await fetch(url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ProcessingDeniedError('处理端点重定向已拒绝，请配置最终端点');
  }
  if (!response.ok) {
    const credentials = new Headers(init.headers);
    const secrets = ['authorization', 'x-api-key', 'x-goog-api-key'].map((key) => credentials.get(key) || '').flatMap((value) => [value, value.replace(/^Bearer\s+/i, '')]).filter((value) => value.length > 0);
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    if (reader) try { while (bytes < 65536) { const { value, done } = await reader.read(); if (done) break; const part = value.subarray(0, 65536 - bytes); chunks.push(part); bytes += part.length; } } finally { await reader.cancel().catch(() => undefined); }
    let body = Buffer.concat(chunks).toString('utf8');
    for (const secret of secrets) body = body.split(secret).join('[REDACTED]');
    const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding'); headers.delete('set-cookie');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
}
