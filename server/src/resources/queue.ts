import { AsyncResource } from 'node:async_hooks';

export class ResourceQueue {
  private active = 0;
  private closed = false;
  private jobs: Array<{ run: () => Promise<void>; reject: (error: Error) => void }> = [];
  constructor(readonly name: string, readonly limit = 1, readonly maxQueued = 24) {}
  status() { return { name: this.name, active: this.active, queued: this.jobs.length, limit: this.limit }; }
  run<T>(worker: () => Promise<T>, onQueued?: (position: number) => void): Promise<T> {
    if (this.closed || this.jobs.length >= this.maxQueued) return Promise.reject(Object.assign(new Error('服务正在停止或队列已满，请稍后重试'), { statusCode: 503 }));
    const action = AsyncResource.bind(worker);
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ reject, run: async () => { try { resolve(await action()); } catch (error) { reject(error); } } });
      if (this.active >= this.limit) onQueued?.(this.jobs.length);
      this.pump();
    });
  }
  private pump() {
    while (this.active < this.limit && this.jobs.length) {
      const job = this.jobs.shift()!;
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
