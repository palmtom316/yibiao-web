import { useState } from 'react';
import { http } from '../../shared/api/http';
import MarkdownRenderer from '../../shared/ui/MarkdownRenderer';
export default function KnowledgeSearchPanel() {
  const [keyword, setKeyword] = useState('');
  const [result, setResult] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function search(page = 1) {
    setBusy(true); setError('');
    try { setResult((await http.get('/knowledge-base/search', { params: { keyword, page } })).data); }
    catch { setError('搜索失败，请重试'); } finally { setBusy(false); }
  }
  return <details className="knowledge-search-panel"><summary>搜索已完成的知识条目</summary>
    <form onSubmit={(event) => { event.preventDefault(); void search(); }}><input aria-label="知识搜索关键词" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入文件名或知识内容" /><button disabled={busy} type="submit">搜索</button></form>
    {error && <p role="alert">{error}</p>}
    <p>{result.total} 条结果 · 第 {result.page} / {Math.max(1, Math.ceil(result.total / 100))} 页</p>
    {result.items.map((item) => <details key={item.id}><summary>{item.fileName} · {item.title}</summary><MarkdownRenderer>{item.content || item.resume}</MarkdownRenderer></details>)}
    <button type="button" disabled={busy || result.page <= 1} onClick={() => void search(result.page - 1)}>上一页</button>
    <button type="button" disabled={busy || result.page * 100 >= result.total} onClick={() => void search(result.page + 1)}>下一页</button>
  </details>;
}
