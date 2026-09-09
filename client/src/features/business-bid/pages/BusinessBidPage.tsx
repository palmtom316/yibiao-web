import { useEffect, useState, useRef } from 'react';
import { useProject } from '../../../app/ProjectContext';
import { http } from '../../../shared/api/http';
import { awaitJobResult } from '../../../shared/api/jobs';
import ReferenceHistory from './ReferenceHistory';

const labels: Record<string, string> = { candidate: '候选', pending: '待核验', confirmed: '已确认满足', partial: '部分满足', missing: '缺失', not_applicable: '不适用' };
const categories: Record<string, string> = { asset: '公司资质', performance: '类似业绩', certificate: '人员证书', other: '其他商务要求' };
const thresholdLabels: Record<string, string> = { category: '证照类别', certificateNo: '指定证号', minimumLevel: '最低资格等级', minimumAmount: '最低合同金额（元）', currency: '币种', completedAfter: '业绩完成日期不早于', completedBefore: '业绩完成日期不晚于', requiredRole: '项目岗位', projectType: '项目类型' };
const blank = () => ({ id: '', version: undefined as number | undefined, category: 'asset', rawText: '', sourceLocator: '人工录入', sourceId: '', thresholds: {} as Record<string, string> });
export default function BusinessBidPage() {
  const { activeProjectId } = useProject();
  const [state, setState] = useState<any>({ requirements: [], revisions: [] }); const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const deadlineDirty = useRef(false); const currentProject = useRef(activeProjectId); currentProject.current = activeProjectId;
  const [loading, setLoading] = useState(true);
  const [deadline, setDeadline] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [selectedId, setSelectedId] = useState(''); const [query, setQuery] = useState(''); const [candidates, setCandidates] = useState<any[]>([]); const [candidateVersion, setCandidateVersion] = useState<number>(); const [candidate, setCandidate] = useState<any>(null);
  const [reason, setReason] = useState(''); const [sources, setSources] = useState<any[]>([]); const [chapters, setChapters] = useState<any[]>([]); const [chapter, setChapter] = useState(''); const [snapshots, setSnapshots] = useState<string[]>([]);
  const selected = state.requirements.find((item: any) => item.id === selectedId);
  async function refresh() {
    if (!activeProjectId) return;
    const [workspace, files, targets] = await Promise.all([http.get('/business-bid'), http.get('/document-sources'), http.get('/business-bid/chapters')]);
    if (currentProject.current !== activeProjectId) return;
    setState(workspace.data); if (!deadlineDirty.current) setDeadline(workspace.data.bidDeadline || ''); setSources(files.data.items); setChapters(targets.data.items);
  }
  useEffect(() => { setLoading(true); deadlineDirty.current = false; setSelectedId(''); setCandidates([]); setCandidate(null); setSnapshots([]); void refresh().catch((error) => setMessage(error.response?.data?.message || '商务清单暂不可用')).finally(() => setLoading(false)); }, [activeProjectId]);
  async function action(worker: () => Promise<unknown>, success = '操作已完成') {
    setBusy(true); setMessage('');
    try { await worker(); await refresh(); setMessage(success); }
    catch (error: any) { setMessage(error.response?.data?.message || error.message || '操作失败，请重试'); }
    finally { setBusy(false); }
  }
  async function confirm(conclusion: string) {
    if (!selected) return;
    await action(async () => {
      const payload = { type: candidate?.type, id: candidate?.id, version: candidate?.version, fingerprint: candidate?.fingerprint, requirementVersion: candidate && ['confirmed', 'partial'].includes(conclusion) ? candidateVersion : selected.version,
        conclusion, reason, refreshOfId: selected.match?.snapshotId || undefined, requestKey: crypto.randomUUID() };
      await awaitJobResult((await http.post(`/business-bid/requirements/${selected.id}/confirm`, payload)).data);
      setCandidate(null); setCandidates([]); setReason('');
    }, '人工结论与引用版本已保存');
  }
  async function download(revision: any, format: 'zip' | 'word', draftPackage: boolean) {
    await action(async () => {
      const result: any = await awaitJobResult((await http.post(`/business-bid/revisions/${revision.id}/export`, { draft: draftPackage, requestKey: crypto.randomUUID() })).data);
      const { data } = await http.get(`/business-bid/packages/${result.packageId}/download`, { params: { format }, responseType: 'blob' });
      const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = `${draftPackage ? '缺项草稿-' : ''}商务响应${format === 'zip' ? '原件包.zip' : '清单.docx'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, '文件已生成并下载');
  }
  if (!activeProjectId) return <div className="page-stack"><h2>商务响应</h2><p>请先创建或选择项目。</p></div>;
  return <div className="page-stack business-workbench performance-page">
    <header><h2>商务响应</h2><p>按要求逐项核验公司资质、业绩和人员原件。检索命中只产生候选，满足与否由人工确认。</p></header>
    <div className="performance-toolbar"><label>投标截止核验日期 <input type="date" disabled={busy || loading} value={deadline} onChange={(event) => { deadlineDirty.current = true; setDeadline(event.target.value); }} /></label><button disabled={busy || loading} onClick={() => void action(async () => { await http.put('/business-bid/deadline', { bidDeadline: deadline || null }); deadlineDirty.current = false; }, '核验日期已更新，旧结论需复核')}>保存日期</button><button disabled={busy} onClick={() => setDraft(blank())}>人工添加要求</button><button disabled={busy} onClick={() => void action(async () => awaitJobResult((await http.post('/business-bid/extract', { requestKey: crypto.randomUUID() })).data), '商务要求已抽取，请核对原文与条件')}>从招标原文抽取</button></div>
    {busy && <p role="status">正在处理，长任务会在服务器继续执行…</p>}{message && <p role="status" className="business-message">{message}</p>}
    {draft && <form className="performance-editor" onSubmit={(event) => { event.preventDefault(); void action(async () => { const payload = { ...draft, sourceId: draft.sourceId || undefined }; if (draft.id) await http.put(`/business-bid/requirements/${draft.id}`, payload); else await http.post('/business-bid/requirements', payload); setDraft(null); }, '要求已保存，需重新核验'); }}>
      <h3>{draft.id ? '核对 / 编辑要求' : '添加商务要求'}</h3>
      <label>类别<select aria-label="类别" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>要求原文<textarea required rows={4} value={draft.rawText} onChange={(event) => setDraft({ ...draft, rawText: event.target.value })} /></label>
      <label>来源原件<select aria-label="来源原件" value={draft.sourceId} onChange={(event) => setDraft({ ...draft, sourceId: event.target.value })}><option value="">人工录入 / 粘贴</option>{sources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.fileName}</option>)}</select></label>
      <label>页码或原文位置<input value={draft.sourceLocator} onChange={(event) => setDraft({ ...draft, sourceLocator: event.target.value })} /></label>
      <fieldset><legend>逐项核验条件（按原文填写，不适用的条件留空）</legend><div className="performance-fields">{Object.entries(thresholdLabels).map(([key, label]) => <label key={key}><span>{label}</span><input type={key === 'completedAfter' || key === 'completedBefore' ? 'date' : 'text'} value={draft.thresholds[key] || ''} onChange={(event) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [key]: event.target.value } })} /></label>)}</div></fieldset>
      <button disabled={busy} type="submit">保存已核对要求</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button>
    </form>}
    <table><thead><tr><th>要求 / 原文证据</th><th>类别</th><th>人工结论</th><th>操作</th></tr></thead><tbody>{state.requirements.map((row: any) => <tr key={row.id}><td>{row.rawText}<small className="business-evidence-location">{row.sourceLocator}</small></td><td>{categories[row.category] || row.category}</td><td>{row.needsReview ? '需复核' : labels[row.match?.conclusion || 'pending']}<small>{row.reviewReason || row.match?.reason}</small></td><td><button disabled={busy} onClick={() => { setSelectedId(row.id); setCandidates([]); setCandidate(null); setReason(''); }}>检索 / 核验</button><button disabled={busy} onClick={() => setDraft({ ...blank(), ...row, thresholds: row.thresholds || {}, sourceId: row.sourceId || '' })}>编辑</button><button disabled={busy} onClick={() => void action(() => http.delete(`/business-bid/requirements/${row.id}`, { params: { version: row.version } }), '要求已归档')}>归档</button></td></tr>)}</tbody></table>
    {!state.requirements.length && <p>暂无商务要求。可先人工录入，无需等待模型服务。</p>}
    {selected && <section className="performance-editor"><h3>逐项核验：{selected.rawText}</h3>
      <form onSubmit={(event) => { event.preventDefault(); void action(async () => { const { data } = await http.get(`/business-bid/requirements/${selected.id}/candidates`, { params: { q: query } }); setCandidates(data.items); setCandidateVersion(data.requirementVersion); setCandidate(null); }, '候选已列出，请人工核对原件和条件'); }}><input aria-label="候选资料关键词" placeholder="名称、标签或证号；留空按类别列出" value={query} onChange={(event) => setQuery(event.target.value)} /><button disabled={busy}>查询候选</button></form>
      <div className="business-candidates">{candidates.map((item) => <button key={`${item.type}:${item.id}`} className={candidate?.id === item.id ? 'selected' : ''} onClick={() => setCandidate(item)}>{item.title} · {item.files.length} 份原件{!item.allowed && ' · 不可引用'}</button>)}</div>
      {candidate && <><h4>{candidate.title}</h4><table><thead><tr><th>核验项</th><th>要求</th><th>资料值</th><th>结果</th></tr></thead><tbody>{candidate.evidence.map((e: any) => <tr key={e.field}><td>{e.label}</td><td>{e.expected}</td><td>{e.actual}</td><td>{e.state === 'met' ? '已知满足' : e.state === 'failed' ? '不满足' : '未知 / 待核验'}{e.reason && ` · ${e.reason}`}</td></tr>)}</tbody></table><p>原件：{candidate.files.map((file: any) => file.originalName).join('、') || '缺失'}</p></>}
      <label>人工核验说明<textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="记录核对依据；不适用也必须说明原因" /></label>
      <div><button disabled={busy || !reason.trim() || !candidate?.allowed || candidate?.evidence.some((e: any) => e.state !== 'met')} onClick={() => void confirm('confirmed')}>人工确认满足</button><button disabled={busy || !reason.trim() || !candidate?.allowed} onClick={() => void confirm('partial')}>记录部分满足</button><button disabled={busy || !reason.trim()} onClick={() => void confirm('missing')}>记录缺失</button><button disabled={busy || !reason.trim()} onClick={() => void confirm('not_applicable')}>记录不适用</button></div>
    </section>}
    <section className="performance-editor"><h3>将已确认资料加入技术标</h3><p>原有人工正文保留，权威字段从已确认版本直接填写，加入后保护该章节。</p>
      {state.requirements.filter((row: any) => row.match?.conclusion === 'confirmed' && row.match.snapshotId && !row.needsReview).map((row: any) => <label key={row.id}><input type="checkbox" checked={snapshots.includes(row.match.snapshotId)} onChange={(event) => setSnapshots(event.target.checked ? [...snapshots, row.match.snapshotId] : snapshots.filter((id) => id !== row.match.snapshotId))} />{row.rawText}</label>)}
      <label>目标章节<select aria-label="目标章节" value={chapter} onChange={(event) => setChapter(event.target.value)}><option value="">请选择技术标末级章节</option>{chapters.map((node) => <option value={node.nodeId} key={node.nodeId}>{node.title}{node.manualLocked ? '（保留人工正文）' : ''}</option>)}</select></label>
      <button disabled={busy || !chapter || !snapshots.length} onClick={() => void action(() => http.post(`/business-bid/chapters/${encodeURIComponent(chapter)}/references`, { snapshotIds: snapshots }), '已加入章节，原文保留')}>加入技术标章节</button>
    </section>
    <ReferenceHistory projectId={activeProjectId!} revision={state} />
    <section><h3>响应版本与交付文件</h3><p>Word 为封面与响应清单，ZIP 另含排序后的原件和校验清单。原件保持原格式。</p><button disabled={busy || !state.requirements.length} onClick={() => void action(async () => awaitJobResult((await http.post('/business-bid/revisions', { requestKey: crypto.randomUUID() })).data), '已保存不可变响应版本')}>生成响应版本</button>
      {state.revisions.map((revision: any) => <div className="business-revision" key={revision.id}><strong>版本 {revision.revision} · {revision.status === 'ready' ? '已确认' : '缺项草稿'}</strong><button disabled={busy || revision.status !== 'ready'} onClick={() => void download(revision, 'word', false)}>正式 Word</button><button disabled={busy || revision.status !== 'ready'} onClick={() => void download(revision, 'zip', false)}>正式 ZIP</button><button disabled={busy} onClick={() => void download(revision, 'zip', true)}>缺项草稿 ZIP</button></div>)}
    </section>
  </div>;
}
