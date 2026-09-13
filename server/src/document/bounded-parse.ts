import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQueue } from '../resources/queue';
import { runBoundedProcess } from '../security/subprocess';
import { ApiError } from '../security/access';

const WORKER = fileURLToPath(new URL('./parse-worker.mjs', import.meta.url));

function workerEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'SystemRoot']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]!]),
  ) as NodeJS.ProcessEnv;
}

export async function parseFileInBoundedWorker(
  sourcePath: string,
  outputDir: string,
  signal?: AbortSignal,
): Promise<{ markdown: string; assets: Array<{ id: string; fileName: string; sha256: string; mimeType: string; size: number }>; warnings: string[] }> {
  return parseQueue.run(async () => {
    signal?.throwIfAborted();
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
    let stdout = '';
    try {
      ({ stdout } = await runBoundedProcess(
        process.execPath,
        ['--max-old-space-size=768', WORKER, sourcePath, outputDir],
        { env: workerEnv(), timeoutMs: 180_000, maxBuffer: 12 * 1024 * 1024, signal },
      ));
    } catch (error) {
      const e = error as { stdout?: string; killed?: boolean };
      let message = signal?.aborted ? '解析已取消，原件保留' : e.killed ? '解析超时，请拆分文件后重试' : '本地解析失败，原件已保留';
      try { message = JSON.parse((e.stdout || '{}').split('YIBIAO_RESULT=').at(-1)!).error || message; } catch { /* bounded error only */ }
      throw new ApiError(422, message);
    }
    const result = JSON.parse(stdout.split('YIBIAO_RESULT=').at(-1)!);
    if (result.error) throw new ApiError(422, result.error);
    let markdown = String(result.markdown || '');
    for (const asset of result.assets || []) {
      markdown = markdown.split(`yibiao-asset://${asset.id}`).join(asset.fileName);
    }
    await fs.writeFile(path.join(outputDir, 'content.md'), markdown.endsWith('\n') ? markdown : `${markdown}\n`, { mode: 0o600 });
    return { markdown, assets: result.assets || [], warnings: result.warnings || [] };
  }, undefined, signal);
}
