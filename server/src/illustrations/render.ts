import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { load } from 'cheerio';
import { ResourceQueue } from '../resources/queue';
import { ApiError } from '../security/access';

const renderQueue = new ResourceQueue('render', 1, 12);
const { buildHtmlLayoutProbeScript } = createRequire(import.meta.url)('./vendor/htmlLayoutProbe.cjs');
export function renderingEnabled() { return process.env.YIBIAO_ENABLE_LOCAL_RENDER === 'true'; }
export function sanitizeIllustrationHtml(html: string): string {
  if (html.length > 200_000) throw new ApiError(422, '图表 HTML 超过长度限制');
  const $ = load(html);
  if ($('*').length > 1500) throw new ApiError(422, '图表元素过多，请简化布局');
  $('script,iframe,object,embed,link,meta,base,form,input,button,audio,video,source').remove();
  $('*').each((_i, element) => {
    if (!('attribs' in element)) return;
    for (const attr of Object.keys(element.attribs || {})) {
      if (/^on/i.test(attr) || ['srcdoc', 'href', 'xlink:href'].includes(attr) || (attr === 'src' && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(element.attribs[attr]))) $(element).removeAttr(attr);
    }
  });
  return $.html();
}
export async function renderLocalDiagram(kind: 'html' | 'mermaid', code: string, width = 1200, height = 800): Promise<Buffer> {
  return (await renderLocalDiagramDetailed(kind, code, width, height)).buffer;
}
export async function renderLocalDiagramDetailed(kind: 'html' | 'mermaid', code: string, width = 1200, height = 800, scale = 1) {
  if (!renderingEnabled()) throw new ApiError(503, '本地图表渲染未启用，正文已保留');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || height < 100 || width > 1600 || height > 2200 || ![1, 2].includes(scale)) throw new ApiError(400, '图表尺寸超过限制');
  if (!code || code.length > (kind === 'html' ? 200000 : 20000)) throw new ApiError(400, '图表代码为空或过长');
  if (kind === 'mermaid' && (/%%\s*\{|\bclick\s|^\s*---/m.test(code))) throw new ApiError(422, 'Mermaid 配置指令和交互脚本不受支持');
  return renderQueue.run(async () => {
    const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'].filter((key) => process.env[key]).map((key) => [key, process.env[key]!])) as Record<string, string>;
    const browser = await chromium.launch({ executablePath: process.env.YIBIAO_CHROMIUM_PATH || '/usr/bin/chromium', headless: true, env, timeout: 15000, args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=128'] });
    const timer = setTimeout(() => { void browser.close(); }, 20_000);
    try {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, javaScriptEnabled: kind === 'mermaid', acceptDownloads: false, serviceWorkers: 'block' });
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(15_000);
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; connect-src 'none'">`;
      if (kind === 'html') {
        await page.setContent(`${csp}<style>body{margin:0;font-family:'Noto Sans CJK SC',sans-serif;background:white;color:#182a40}*{box-sizing:border-box}</style>${sanitizeIllustrationHtml(code)}`, { waitUntil: 'load' });
      } else {
        await page.setContent(`${csp}<style>body{margin:20px;background:white;font-family:'Noto Sans CJK SC',sans-serif}svg{max-width:100%;max-height:${height - 40}px}</style><div id="chart"></div>`);
        await page.addScriptTag({ content: await fs.readFile(createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js'), 'utf8') });
        await page.evaluate(async (source) => {
          const mermaid = (window as any).mermaid;
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', maxTextSize: 20000, theme: 'default', secure: ['securityLevel', 'maxTextSize', 'startOnLoad'] });
          const { svg } = await mermaid.render('yibiao-chart', source); document.getElementById('chart')!.innerHTML = svg;
        }, code);
      }
      const clip = await page.evaluate(({ kind, width, height }) => {
        const elements = kind === 'mermaid' ? [document.querySelector('#chart svg')!] : Array.from(document.body.children);
        const bounds = elements.filter(Boolean).map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
        if (!bounds.length) throw new Error('图表没有可显示内容');
        const left = Math.min(...bounds.map((rect) => rect.left)); const top = Math.min(...bounds.map((rect) => rect.top));
        const right = Math.max(...bounds.map((rect) => rect.right)); const bottom = Math.max(...bounds.map((rect) => rect.bottom));
        if (right > width + 1 || bottom > height + 1) throw new Error('图表超出画布，请调整布局');
        const x = Math.max(0, Math.floor(left) - 12); const y = Math.max(0, Math.floor(top) - 12);
        return { x, y, width: Math.min(width - x, Math.ceil(right) - x + 12), height: Math.min(height - y, Math.ceil(bottom) - y + 12) };
      }, { kind, width, height });
      const layout_issues = kind === 'html' ? await page.evaluate(buildHtmlLayoutProbeScript()) as string[] : [];
      return { buffer: Buffer.from(await page.screenshot({ type: 'png', clip, animations: 'disabled' })), width: clip.width, height: clip.height, layout_issues };
    } finally { clearTimeout(timer); await browser.close(); }
  });
}
