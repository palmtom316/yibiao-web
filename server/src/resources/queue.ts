import { AsyncResource } from 'node:async_hooks';
import { ApiError } from '../security/access';

export class ResourceQueue {
  private active = 0;
  private closed = false;
  private jobs: Array<{ run: () => Promise<void>; reject: (error: Error) => void; signal?: AbortSignal; onAbort?: () => void }> = [];
  constructor(readonly name: string, readonly limit = 1, readonly maxQueued = 24) {}
  status() { return { name: this.name, active: this.active, queued: this.jobs.length, limit: this.limit }; }
  run<T>(worker: () => Promise<T>, onQueued?: (position: number) => void, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new ApiError(409, '任务已取消，原件和成功版本保留'));
    if (this.closed || this.jobs.length >= this.maxQueued) return Promise.reject(Object.assign(new Error('服务正在停止或队列已满，请稍后重试'), { statusCode: 503 }));
    const action = AsyncResource.bind(worker);
    return new Promise<T>((resolve, reject) => {
      const entry: { run: () => Promise<void>; reject: (error: Error) => void; signal?: AbortSignal; onAbort?: () => void } = {
        reject,
        run: async () => { try { resolve(await action()); } catch (error) { reject(error as Error); } },
        signal,
      };
      if (signal) {
        entry.onAbort = () => {
          const index = this.jobs.indexOf(entry);
          if (index >= 0) {
            this.jobs.splice(index, 1);
            reject(new ApiError(409, '任务已取消，原件和成功版本保留'));
          }
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.jobs.push(entry);
      if (this.active >= this.limit) onQueued?.(this.jobs.length);
      this.pump();
    });
  }
  private pump() {
    while (this.active < this.limit && this.jobs.length) {
      const job = this.jobs.shift()!;
      if (job.signal?.aborted) { job.reject(new ApiError(409, '任务已取消，原件和成功版本保留')); continue; }
      if (job.onAbort && job.signal) job.signal.removeEventListener('abort', job.onAbort);
      this.active += 1;
      void job.run().finally(() => { this.active -= 1; this.pump(); });
    }
  }
  stopAccepting() {
    this.closed = true;
    for (const job of this.jobs.splice(0)) job.reject(new Error('服务停止，排队任务可重试'));
  }
}
export const parseQueue = new ResourceQueue('parse');
export const exportQueue = new ResourceQueue('export');
