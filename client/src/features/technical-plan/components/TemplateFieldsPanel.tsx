import { useState } from 'react';
import { http } from '../../../shared/api/http';
import { awaitJobResult } from '../../../shared/api/jobs';

interface Candidate { candidate_id: string; text: string; context: string; suggested_name: string }
interface Field { candidate_id: string; name: string; fill_by: 'manual' | 'ai'; instruction?: string }
interface State { version: number; candidates: Candidate[]; selection: { fields: Field[]; ignored_candidate_ids: string[] } }
export default function TemplateFieldsPanel({ artifactId, onApplied }: { artifactId: string; onApplied: (value: unknown) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const prefix = `/technical-plan/templates/${artifactId}/fields`;
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(''); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : '字段处理失败'); } finally { setBusy(false); } };
  const edit = (candidate: Candidate, mode: string, name?: string, instruction?: string) => setState((previous) => {
    if (!previous) return previous;
    const existing = previous.selection.fields.find((field) => field.candidate_id === candidate.candidate_id);
    return { ...previous, selection: { fields: [...previous.selection.fields.filter((field) => field.candidate_id !== candidate.candidate_id), ...(mode === 'ignore' ? [] : [{ candidate_id: candidate.candidate_id, name: name ?? existing?.name ?? candidate.suggested_name, fill_by: mode as 'ai' | 'manual', instruction: instruction ?? existing?.instruction }])],
      ignored_candidate_ids: [...previous.selection.ignored_candidate_ids.filter((id) => id !== candidate.candidate_id), ...(mode === 'ignore' ? [candidate.candidate_id] : [])] } };
  });
  return <details onToggle={(event) => { if (event.currentTarget.open && !state) void run(async () => setState((await http.get<State>(prefix)).data)); }}>
    <summary>确认模板待填位置</summary>
    <p>逐项选择填写方式；签字、盖章和人工证明材料须手工填写。确认后生成带待填控件的 Word，不自动填入内容。</p>
    {message && <p role="status">{message}</p>}
    <button className="secondary-action" disabled={busy || !state} onClick={() => void run(async () => { const result = await awaitJobResult<State>((await http.post(`${prefix}/suggest`)).data); setState(result); setMessage('字段建议已生成，请检查后确认。'); })}>生成字段建议</button>
    {state?.candidates.map((candidate) => {
      const field = state.selection.fields.find((item) => item.candidate_id === candidate.candidate_id);
      const mode = field?.fill_by || 'ignore';
      return <fieldset key={candidate.candidate_id} className="template-field-row" disabled={busy}>
        <legend>{candidate.suggested_name || '待填位置'}</legend>
        <p>{candidate.context || candidate.text}</p>
        <label>处理方式 <select value={mode} onChange={(event) => edit(candidate, event.target.value)}><option value="manual">人工填写</option><option value="ai">可辅助填写</option><option value="ignore">不是待填位置</option></select></label>
        {field && <><label>字段名称 <input value={field.name} maxLength={120} onChange={(event) => edit(candidate, mode, event.target.value)} /></label>
          <label>填写说明 <input value={field.instruction || ''} maxLength={2000} onChange={(event) => edit(candidate, mode, undefined, event.target.value)} /></label></>}
      </fieldset>;
    })}
    {state && !state.candidates.length && <p>未检测到待填位置，可以确认并保存无字段模板。</p>}
    {state && <button className="primary-action" disabled={busy} onClick={() => void run(async () => { const result = await awaitJobResult<any>((await http.post(`${prefix}/apply`, { version: state.version, selection: state.selection })).data); onApplied(result); setState((await http.get<State>(prefix)).data); setMessage(result.message); })}>{busy ? '正在处理…' : '确认并生成待填模板'}</button>}
  </details>;
}
