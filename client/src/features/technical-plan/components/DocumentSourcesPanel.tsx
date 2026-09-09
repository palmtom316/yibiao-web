import ProcessingPolicyPanel from '../../../shared/ui/ProcessingPolicyPanel';
import TemplateFieldsPanel from './TemplateFieldsPanel';
import { useEffect, useState } from 'react';
import { http, getActiveProjectId } from '../../../shared/api/http';
import { awaitJobResult, type JobDto } from '../../../shared/api/jobs';

interface Source { sourceId: string; fileName: string; size: number; sourceHash: string; parseVersion: number | null; status: string }
export default function DocumentSourcesPanel() {
  const [items, setItems] = useState<Source[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [job, setJob] = useState<JobDto | null>(null);
  const [template, setTemplate] = useState<any>(null);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const projectId = getActiveProjectId();
  const refresh = async () => { if (projectId) { const [sources, tasks, state] = await Promise.all([http.get('/document-sources'), http.get('/jobs'), http.get('/technical-plan/state')]); setTemplate(state.data.templateExtraction); setItems(sources.data.items); setJobs(tasks.data.items.filter((job: JobDto) => !job.kind.startsWith('business-'))); } };
  useEffect(() => {
    void refresh().catch(() => setMessage('原件列表暂不可用'));
    const onProgress = (event: Event) => setJob((event as CustomEvent<JobDto>).detail);
    const onReconnect = () => { void refresh().catch(() => undefined); };
    window.addEventListener('yibiao:job-progress', onProgress);
    window.addEventListener('yibiao:sse-reconnected', onReconnect);
    return () => { window.removeEventListener('yibiao:job-progress', onProgress); window.removeEventListener('yibiao:sse-reconnected', onReconnect); };
  }, [projectId]);
  async function download(source: Source) {
    try {
      const { data } = await http.get(`/document-sources/${source.sourceId}/original`, { responseType: 'blob' });
      const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = source.fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setMessage('原件不存在或无权下载'); }
  }
  async function reparse(source: Source) {
    setBusy(source.sourceId); setMessage('');
    try {
      await awaitJobResult((await http.post(`/document-sources/${source.sourceId}/reparse`)).data);
      setMessage('新解析版本已保存，历史成功版本保留。'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '解析失败，原件保留'); }
    finally { setBusy(''); setJob(null); }
  }
  return <details className="document-sources-panel" onToggle={(event) => { if (event.currentTarget.open) void refresh().catch(() => undefined); }}>
    <summary>原件与解析记录</summary>
    {projectId && <ProcessingPolicyPanel projectId={projectId} />}
    <p>原件和每次成功解析均独立保留。重新解析生成新版本，当前标书继续使用已引用的版本。</p>
    {message && <p role="status">{message}</p>}
    {template?.status === 'unavailable' && <p role="status">未抽取模板：{template.message}</p>}
    {template?.status === 'success' && <button type="button" onClick={() => void http.get(`/technical-plan/templates/${template.artifactId}/download`, { responseType: 'blob' }).then(({ data }) => { const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = '提取的Word模板.docx'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }).catch(() => setMessage('模板暂不可下载'))}>下载已提取的 Word 模板</button>}
    {template?.status === 'success' && <TemplateFieldsPanel key={template.artifactId} artifactId={template.artifactId} onApplied={setTemplate} />}
    {job && <p role="status">{job.status === 'queued' ? '解析排队中' : '后台解析中'} · {job.progress}%</p>}
    {!items.length && <p>暂无原件记录。旧版 Markdown 可继续查看；需要原件时请重新上传。</p>}
    <ul>{items.map((source) => <li key={source.sourceId}>
      <strong>{source.fileName}</strong> · {(source.size / 1024).toFixed(1)} KiB · {source.parseVersion ? `解析版本 ${source.parseVersion}` : '尚未解析'}
      <button type="button" onClick={() => void download(source)}>下载原件</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void reparse(source)}>{busy === source.sourceId ? '解析中…' : '重新解析'}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => { setBusy(source.sourceId); void http.post('/technical-plan/extract-template', { sourceId: source.sourceId }).then(({ data }) => awaitJobResult<any>(data)).then((result) => { setTemplate(result); setMessage(result.message || '模板处理完成'); }).catch((error) => setMessage(error.message)).finally(() => setBusy('')); }}>抽取 Word 模板</button>
      <button type="button" onClick={() => void http.get(`/document-sources/${source.sourceId}`).then(({ data }) => setVersions(data.versions))}>查看版本与警告</button>
    </li>)}</ul>
    {jobs.filter((task) => ['error', 'cancelled', 'running', 'queued'].includes(task.status)).map((task) => <p key={task.jobId}>{task.status === 'running' ? '处理中' : task.status === 'queued' ? '排队中' : '任务可重试'} · {task.progress}% · {task.error}{['error', 'cancelled'].includes(task.status) && <button disabled={Boolean(busy)} onClick={() => { setBusy(task.jobId); void http.post(`/jobs/${task.jobId}/retry`).then(({ data }) => awaitJobResult(data)).then(refresh).catch((error) => setMessage(error.message)).finally(() => setBusy('')); }}>重试任务</button>}</p>)}
    {versions.map((version) => <p key={version.id}>版本 {version.version} · {version.status === 'success' ? '成功' : version.status === 'error' ? '失败' : '处理中'} · {(version.warnings || []).join('；') || '无警告'}</p>)}
  </details>;
}
