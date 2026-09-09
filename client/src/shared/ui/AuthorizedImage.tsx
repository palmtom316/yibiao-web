import { useEffect, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { http } from '../api/http';

export default function AuthorizedImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [resolved, setResolved] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let objectUrl = '';
    setError(''); setResolved('');
    const id = /^yibiao-asset:\/\/([a-z0-9-]+)$/i.exec(String(src || ''))?.[1];
    if (id) {
      void http.get(`/files/assets/${encodeURIComponent(id)}`, { responseType: 'blob' })
        .then(({ data }) => { if (active) { objectUrl = URL.createObjectURL(data); setResolved(objectUrl); } })
        .catch(() => { if (active) setError('图片缺失或无权访问'); });
    } else if (String(src || '').startsWith('/docs/images/') && !String(src).includes('..') && !String(src).includes('\\')) setResolved(String(src));
    else if (/^(?:data:image\/(?:png|jpeg|gif|webp|bmp);base64,|blob:)/i.test(String(src || ''))) setResolved(String(src));
    else setError('图片尚未导入，请重新上传原件');
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (error) return <span role="status" className="markdown-image-warning">[{alt || '图片'}：{error}]</span>;
  if (!resolved) return <span role="status">图片加载中…</span>;
  return <img {...props} src={resolved} alt={alt} />;
}
