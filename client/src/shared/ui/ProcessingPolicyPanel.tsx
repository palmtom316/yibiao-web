import { useEffect, useState } from 'react';
import { http } from '../api/http';
export default function ProcessingPolicyPanel({ projectId }: { projectId?: number }) {
  const [policy, setPolicy] = useState<{ allowExternalProcessing: boolean; canManage: boolean }>();
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const url = projectId ? `/projects/${projectId}/processing-policy` : '/config/processing-policy';
  useEffect(() => { void http.get(url).then(({ data }) => setPolicy(data)).catch(() => setMessage('处理策略暂不可用')); }, [url]);
  return <div className="processing-policy-panel">
    <label><input type="checkbox" checked={policy?.allowExternalProcessing || false} disabled={!policy?.canManage || busy} onChange={(event) => {
      setBusy(true); void http.put(url, { allowExternalProcessing: event.target.checked }).then(({ data }) => { setPolicy(data); setMessage('处理策略已保存'); }).catch(() => setMessage('保存失败')).finally(() => setBusy(false));
    }} />允许{projectId ? '本项目' : '共享资料库'}使用已批准的外部处理服务</label>
    <p>默认仅使用部署方批准的内部服务。此开关由管理员维护，项目与共享资料库分别授权。</p>
    {message && <p role="status">{message}</p>}
  </div>;
}
