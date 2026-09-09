import { http } from './http';
export interface JobDto<T = unknown> { jobId: string; kind: string; status: string; progress: number; result?: T; error?: string; attempts: number }
export async function awaitJobResult<T>(initial: T | JobDto<T>): Promise<T> {
  if (!initial || typeof initial !== 'object' || !('jobId' in initial)) return initial as T;
  let job = initial as JobDto<T>;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    if (job.status === 'success') return job.result as T;
    if (['error', 'cancelled'].includes(job.status)) throw new Error(job.error || '任务失败，原件已保留，可从原件列表重试');
    window.dispatchEvent(new CustomEvent('yibiao:job-progress', { detail: job }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    job = (await http.get<JobDto<T>>(`/jobs/${encodeURIComponent(job.jobId)}`)).data;
  }
  throw new Error('任务仍在后台处理，可在原件列表查看状态');
}
