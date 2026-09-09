import { useState } from 'react';
import { http } from '../../shared/api/http';
export default function ArchivedKnowledgePanel() {
  const [items, setItems] = useState<any[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const refresh = () => http.get('/knowledge-base', { params: { archived: true } }).then(({ data }) => setItems(data.documents));
  return <details className="knowledge-search-panel" onToggle={(event) => { if (event.currentTarget.open) void refresh().catch(() => setMessage('归档列表暂不可用')); }}>
    <summary>已归档知识文档</summary><p>归档保留原件与条目。永久删除前须解除所有业绩关联，已确认的项目引用副本仍保留。</p>
    {message && <p role="status">{message}</p>}
    {items.map((item) => <p key={item.id}>{item.file_name} · 版本 {item.version}
      <button disabled={busy} onClick={() => {
        if (!window.confirm(`永久删除“${item.file_name}”及其原件？此操作无法撤回。项目引用副本将保留。`)) return;
        setBusy(true); void http.delete(`/knowledge-base/documents/${item.id}`, { params: { permanent: true, version: item.version } }).then(({ data }) => { setMessage(data.message); return refresh(); }).catch((error) => setMessage(error.response?.data?.message || '删除失败，请先解除业绩关联')).finally(() => setBusy(false));
      }}>永久删除</button>
    </p>)}
    {!items.length && <p>没有已归档的文档。</p>}
  </details>;
}
