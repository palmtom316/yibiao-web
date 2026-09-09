import { useEffect, useState } from 'react';
import { http } from '../../../shared/api/http';
const sourceLabels: Record<string, string> = { current: '来源未变更', changed: '来源已有新版本', archived: '来源已归档', missing: '来源已缺失，历史副本保留' };
export default function ReferenceHistory({ projectId, revision }: { projectId: number; revision: unknown }) {
  const [items, setItems] = useState<any[]>([]); const [error, setError] = useState('');
  const refresh = () => http.get('/business-bid/snapshots').then(({ data }) => setItems(data.items)).catch(() => setError('引用记录暂不可用'));
  useEffect(() => { setItems([]); void refresh(); }, [projectId, revision]);
  return <details onToggle={(event) => { if (event.currentTarget.open) void refresh(); }}><summary>已确认资料的引用历史</summary>
    <p>更新引用会建立新版本。这里保留原资料字段和文件；来源变更不会改写历史副本。</p>
    {error && <p role="status">{error}</p>}
    {items.map((item) => <div key={item.id} className="business-revision"><strong>{item.data?.title || '资料引用'} · 原资料版本 {item.sourceVersion}</strong>
      <span>{sourceLabels[item.sourceStatus]} · {new Date(item.confirmedAt).toLocaleString('zh-CN')}{item.refreshOfId ? ' · 由旧引用更新' : ''}</span>
      {item.status !== 'ready' && <span>复制未完成，可重新核验：{item.error}</span>}{item.revoked && <span>引用许可已撤销，禁止新的交付</span>}
      {item.files.map((file: any) => <button disabled={item.revoked || item.status !== 'ready'} key={file.id} onClick={() => void http.get(`/business-bid/snapshots/${item.id}/files/${file.id}`, { responseType: 'blob' }).then(({ data }) => {
        const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = file.originalName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }).catch(() => setError('文件缺失、许可已撤销或无权下载'))}>{file.originalName}</button>)}
    </div>)}
    {!items.length && <p>暂无已确认的引用版本。</p>}
  </details>;
}
