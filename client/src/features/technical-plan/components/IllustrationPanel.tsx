import { useEffect, useState } from 'react';
import { http } from '../../../shared/api/http';
import { awaitJobResult } from '../../../shared/api/jobs';
import type { OutlineData, OutlineItem } from '../../../shared/types';
export default function IllustrationPanel({ outlineData }: { outlineData: OutlineData }) {
  const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'html' | 'mermaid'>('mermaid'); const [code, setCode] = useState('flowchart LR\nA[准备] --> B[实施]\nB --> C[验收]'); const [target, setTarget] = useState('');
  const [html, setHtml] = useState(true); const [mermaid, setMermaid] = useState(true); const [ai, setAi] = useState(false);
  const leaves: OutlineItem[] = []; const collect = (items: OutlineItem[]) => { for (const item of items) item.children?.length ? collect(item.children) : leaves.push(item); }; collect(outlineData.outline || []);
  useEffect(() => { void http.get('/technical-plan/illustrations/status').then(({ data }) => setEnabled(data.localRender)).catch(() => undefined); }, []);
  async function run(url: string, data: object) {
    setBusy(true); setMessage('');
    try { const result: any = await awaitJobResult((await http.post(url, data)).data); setMessage(result?.warnings?.join('；') || '配图已保存，可刷新正文查看'); window.dispatchEvent(new CustomEvent('yibiao:content-updated')); }
    catch (error: any) { setMessage(error.response?.data?.message || error.message || '配图失败，正文保留'); } finally { setBusy(false); }
  }
  return <details className="document-sources-panel"><summary>正文配图与本地图表</summary>
    {!enabled && <p>本地图表暂不可用，正文编辑和生成可继续使用。</p>}
    <p>自动配图仅处理未人工锁定的正文；失败图片可以重试，原文保留。</p>
    <label><input type="checkbox" disabled={!enabled} checked={html} onChange={(event) => setHtml(event.target.checked)} />HTML 图</label>
    <label><input type="checkbox" disabled={!enabled} checked={mermaid} onChange={(event) => setMermaid(event.target.checked)} />Mermaid 图</label>
    <label><input type="checkbox" checked={ai} onChange={(event) => setAi(event.target.checked)} />已批准服务的 AI 示意图</label>
    <button disabled={busy || (!enabled && !ai)} onClick={() => void run('/technical-plan/illustrations', { useHtmlImages: enabled && html, useMermaidImages: enabled && mermaid, useAiImages: ai, maxHtmlImages: 3, maxMermaidImages: 3, maxAiImages: 2 })}>规划配图 / 重试失败图片</button>
    <details><summary>手工插入本地图表</summary><p>图表在本地生成，不需要模型服务。</p>
      <select aria-label="目标章节" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">选择章节</option>{leaves.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      <select aria-label="图表类型" value={kind} onChange={(event) => setKind(event.target.value as 'html' | 'mermaid')}><option value="mermaid">Mermaid</option><option value="html">HTML / CSS</option></select>
      <textarea aria-label="图表内容" rows={5} style={{ width: '100%' }} value={code} onChange={(event) => setCode(event.target.value)} />
      <button disabled={busy || !enabled || !target || !code.trim()} onClick={() => void run('/technical-plan/illustrations/render', { nodeId: target, kind, code })}>生成并插入图表</button>
    </details>{message && <p role="status">{message}</p>}
  </details>;
}
