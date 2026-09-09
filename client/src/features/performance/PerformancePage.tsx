import { useEffect, useState } from 'react';
import { http } from '../../shared/api/http';

const empty = () => ({ title: '', ownerName: '', location: '', contractAmount: '', currency: 'CNY', contractSignedAt: '', startedAt: '', completedAt: '', durationText: '', roleText: '', projectType: '', summary: '', notes: '', tagsText: '', isPubliclyCitable: false, assetIds: [] as string[], documentIds: [] as string[], knowledgeItems: [] as { documentId: string; itemId: string }[], team: [] as { profileId: string; role: string }[], id: '', archivedAt: null as string | null, version: undefined as number | undefined });
type Draft = ReturnType<typeof empty>;
function edit(record: any): Draft {
  return { ...empty(), ...record, contractAmount: record.contractAmount || '', tagsText: (record.tags || []).join(', '),
    ...Object.fromEntries(['contractSignedAt', 'startedAt', 'completedAt'].map((key) => [key, record[key]?.slice(0, 10) || ''])),
    assetIds: record.assets.map((link: any) => link.assetItemId), documentIds: record.documents.map((link: any) => link.documentId),
    knowledgeItems: record.items.map((link: any) => ({ documentId: link.documentId, itemId: link.itemId })), team: record.team.map((member: any) => ({ profileId: member.profileId, role: member.role })) };
}
export default function PerformancePage() {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [archived, setArchived] = useState(false);
  const [result, setResult] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 50 });
  const [draft, setDraft] = useState<Draft | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [assets, setAssets] = useState<any[]>([]); const [documents, setDocuments] = useState<any[]>([]); const [people, setPeople] = useState<any[]>([]); const [knowledge, setKnowledge] = useState<any[]>([]);
  async function refresh() { const { data } = await http.get('/performance-records', { params: { q: query, page, archived } }); setResult(data); }
  useEffect(() => { void refresh().catch(() => setMessage('业绩列表加载失败')); }, [query, page, archived]);
  useEffect(() => { void Promise.all([http.get('/asset-library/company'), http.get('/knowledge-base'), http.get('/personnel')]).then(([a, d, p]) => { setAssets(a.data.items); setDocuments(d.data.documents); setPeople(p.data.profiles); }).catch(() => setMessage('关联资料加载失败，请检查资料库权限')); }, []);
  useEffect(() => {
    let active = true;
    void Promise.all((draft?.documentIds || []).map(async (documentId) => ({ documentId, items: (await http.get(`/knowledge-base/documents/${documentId}/items`)).data })))
      .then((rows) => { if (active) setKnowledge(rows.flatMap((row) => row.items.map((item: any) => ({ ...item, documentId: row.documentId })))); }).catch(() => setMessage('知识条目加载失败'));
    return () => { active = false; };
  }, [draft?.documentIds.join(',')]);
  function patch(values: Partial<Draft>) { setDraft((before) => before ? { ...before, ...values } : before); }
  async function save() {
    if (!draft) return; setBusy(true); setMessage('');
    try {
      const payload = { ...draft, contractAmount: draft.contractAmount || null, tags: draft.tagsText.split(',').map((t) => t.trim()).filter(Boolean) };
      if (draft.id) await http.put(`/performance-records/${draft.id}${draft.archivedAt ? '/links' : ''}`, payload); else await http.post('/performance-records', payload);
      setDraft(null); setMessage('业绩已保存'); await refresh();
    } catch (error: any) { setMessage(error.response?.data?.message || '保存失败，请检查关联和资料版本'); } finally { setBusy(false); }
  }
  return <div className="page-stack performance-page">
    <header><h2>业绩档案</h2><p>将项目叙述、公司原件和人员岗位整理为一份可核对的业绩。金额单位为元，未知请留空。</p></header>
    <div className="performance-toolbar"><input aria-label="搜索业绩" placeholder="搜索名称、业主或项目类型" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><button onClick={() => setDraft(empty())}>新建业绩</button><label><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1); }} />查看已归档</label></div>
    {message && <p role="status">{message}</p>}
    {draft && <form className="performance-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>{draft.id ? '编辑业绩' : '新建业绩'}</h3>
      <fieldset disabled={Boolean(draft.archivedAt)}><div className="performance-fields">{[['title', '业绩名称'], ['ownerName', '业主'], ['location', '地点'], ['projectType', '项目类型'], ['contractAmount', '合同金额（元）'], ['currency', '币种'], ['contractSignedAt', '合同签订日期'], ['startedAt', '开始日期'], ['completedAt', '完成日期'], ['durationText', '工期说明'], ['roleText', '承担角色'], ['tagsText', '标签（逗号分隔）']].map(([key, label]) => <label key={key}><span>{label}</span><input required={key === 'title'} type={key.endsWith('At') ? 'date' : 'text'} value={String(draft[key as keyof Draft] || '')} onChange={(event) => patch({ [key]: event.target.value })} /></label>)}</div>
      <label>可复述的项目叙述<textarea value={draft.summary} onChange={(event) => patch({ summary: event.target.value })} rows={4} /></label>
      <label>内部备注<textarea value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} rows={2} /></label>
      <label><input type="checkbox" checked={draft.isPubliclyCitable} onChange={(event) => patch({ isPubliclyCitable: event.target.checked })} />允许本业绩用于对外投标引用</label>
      <p>撤销许可会阻止历史引用版本的新交付；已有产物保留用于核对。</p></fieldset>{draft.archivedAt && <p>此业绩已归档，仅可维护或解除资料关联。</p>}
      <label>关联公司原件<select aria-label="关联公司原件" multiple value={draft.assetIds} onChange={(event) => patch({ assetIds: Array.from(event.target.selectedOptions, (option) => option.value) })}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.files.length} 个附件</option>)}</select></label>
      <label>关联知识文档<select aria-label="关联知识文档" multiple value={draft.documentIds} onChange={(event) => { const ids = Array.from(event.target.selectedOptions, (option) => option.value); patch({ documentIds: ids, knowledgeItems: draft.knowledgeItems.filter((item) => ids.includes(item.documentId)) }); }}>{documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.file_name}</option>)}</select></label>
      <fieldset><legend>选用知识条目</legend>{knowledge.map((item) => <label key={`${item.documentId}:${item.id}`}><input type="checkbox" checked={draft.knowledgeItems.some((x) => x.documentId === item.documentId && x.itemId === item.id)} onChange={(event) => patch({ knowledgeItems: event.target.checked ? [...draft.knowledgeItems, { documentId: item.documentId, itemId: item.id }] : draft.knowledgeItems.filter((x) => !(x.documentId === item.documentId && x.itemId === item.id)) })} />{item.title}</label>)}</fieldset>
      <fieldset><legend>团队及项目岗位</legend>{people.map((person) => { const member = draft.team.find((x) => x.profileId === person.id); return <div key={person.id}><label><input type="checkbox" checked={Boolean(member)} onChange={(event) => patch({ team: event.target.checked ? [...draft.team, { profileId: person.id, role: '' }] : draft.team.filter((x) => x.profileId !== person.id) })} />{person.name}</label>{member && <input required aria-label={`${person.name}的项目岗位`} placeholder="例如项目经理" value={member.role} onChange={(event) => patch({ team: draft.team.map((x) => x.profileId === person.id ? { ...x, role: event.target.value } : x) })} />}</div>; })}</fieldset>
      <button type="submit" disabled={busy}>保存业绩</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button>
    </form>}
    <table><thead><tr><th>业绩</th><th>业主 / 类型</th><th>合同金额（元）</th><th>引用许可</th><th>关联资料</th><th>操作</th></tr></thead><tbody>{result.items.map((record) => <tr key={record.id}><td>{record.title}</td><td>{record.ownerName}<br />{record.projectType}</td><td>{record.contractAmount ?? '未知'} {record.currency}</td><td>{record.isPubliclyCitable ? '允许引用' : '尚未许可'}</td><td>{record.assets.length} 份原件 · {record.team.length} 个岗位</td><td><button onClick={() => { setDraft(edit(record)); setAssets((items) => [...items, ...record.assets.map((link: any) => link.asset).filter((asset: any) => !items.some((x) => x.id === asset.id))]); setDocuments((items) => [...items, ...record.documents.map((link: any) => ({ id: link.documentId, file_name: link.document.fileName })).filter((doc: any) => !items.some((x) => x.id === doc.id))]); setPeople((items) => [...items, ...record.team.map((link: any) => link.profile).filter((person: any) => !items.some((x) => x.id === person.id))]); }}>{record.archivedAt ? '维护关联' : '编辑'}</button><button disabled={Boolean(record.archivedAt) || busy} onClick={() => { setBusy(true); void http.post(`/performance-records/${record.id}/archive`, { version: record.version }).then(refresh).catch((error) => setMessage(error.response?.data?.message || '归档失败')).finally(() => setBusy(false)); }}>归档</button></td></tr>)}</tbody></table>
    {!result.total && <p>暂无业绩，先新建档案并关联已有资料。</p>}
    <div><button disabled={result.page <= 1} onClick={() => setPage(result.page - 1)}>上一页</button><span> {result.page} / {Math.max(1, Math.ceil(result.total / 50))} · {result.total} 条 </span><button disabled={result.page * 50 >= result.total} onClick={() => setPage(result.page + 1)}>下一页</button></div>
  </div>;
}
