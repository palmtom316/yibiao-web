export function isFatalSseStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

export function shouldOpenSseConnection(input: { token: string | null; projectId: number | null; stopped: boolean }): boolean {
  return Boolean(input.token) && input.projectId != null && !input.stopped;
}

export function shouldReconnectAfterClose(input: { stopped: boolean; projectId: number | null; connectionGeneration: number; currentGeneration: number }): boolean {
  return !input.stopped && input.projectId != null && input.connectionGeneration === input.currentGeneration;
}

export function sseRetryDelayMs(attempt: number): number {
  const n = Math.max(0, Math.min(6, Math.floor(attempt)));
  return Math.min(15_000, 1000 * 2 ** n);
}
