import { spawn } from 'node:child_process';

export function runBoundedProcess(command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer: number; signal?: AbortSignal }): Promise<{ stdout: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const chunks: Buffer[] = []; let bytes = 0; let killed = false; let settled = false;
    const stop = () => {
      killed = true;
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ }
    };
    const timer = setTimeout(stop, options.timeoutMs);
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', stop); };
    options.signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > options.maxBuffer) stop(); else chunks.push(chunk); });
    child.stderr.on('data', () => { /* parser errors use a bounded structured result, never raw process diagnostics */ });
    child.on('error', () => { if (settled) return; settled = true; cleanup(); reject(Object.assign(new Error('解析进程无法启动'), { killed, stdout: '' })); });
    child.on('close', (code) => {
      if (settled) return; settled = true; cleanup(); const stdout = Buffer.concat(chunks).toString('utf8');
      if (code === 0 && !killed) resolve({ stdout });
      else reject(Object.assign(new Error(options.signal?.aborted ? '解析已取消' : killed ? '解析超时或输出超过限制' : '解析失败'), { killed, stdout }));
    });
  });
}
