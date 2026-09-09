// Synthetic transport fixture. Never a production model or OCR acceptance service.
import http from 'node:http';
if (process.env.YIBIAO_TEST_SCOPE !== 'yibiao-transform') throw Error('Synthetic scope required');
let hold = false; let delay = 100; let requests = 0; let completed = 0;
const waiting = new Set();
function resultFor(body) {
  const prompt = String(body.messages?.at(-1)?.content || '');
  if (prompt.includes('提取项目信息')) return JSON.stringify({ project_name: '合成工程', project_number: 'SYNTHETIC', project_type: '测试', project_budget: '未知', project_address: '合成地点' });
  if (prompt.includes('提取甲方信息')) return JSON.stringify({ company_name: '合成业主', address: '合成地点', contact_person: '合成联系人', contact_phone: '未提供' });
  if (prompt.includes('提取交货和服务要求')) return JSON.stringify({ implementation_period: '30 天', delivery_scope: '合成服务', delivery_location: '合成地点', acceptance_requirements: '人工验收', warranty_period: '一年', after_sales_service: '合成维护', response_time: '一天', training_requirements: '合成培训', documentation_requirements: '合成文档' });
  if (prompt.includes('技术评分')) return '## 技术评分项\n【评分项名称】：实施方案\n【评分标准】：完整阐述实施与验收。\n## 技术评分要求\n内容应符合招标原文。';
  return '合成工程位于合成地点，需要在 30 天内完成实施与验收。本响应仅供本机故障恢复验收。';
}
http.createServer(async (req, res) => {
  if (req.url === '/control') {
    if (req.headers['x-fixture-key'] !== 'synthetic-test-only') { res.writeHead(403).end(); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      hold = input.hold === true; delay = Math.min(60000, Math.max(0, Number(input.delay) || 0));
      if (!hold) for (const finish of [...waiting]) finish();
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ requests, completed, waiting: waiting.size, hold })); return;
  }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2 * 1024 * 1024) { res.writeHead(413).end(); return; } }
  const body = JSON.parse(raw); requests++;
  const timer = setTimeout(finish, hold ? 60000 : delay);
  waiting.add(finish); res.once('close', () => { clearTimeout(timer); waiting.delete(finish); });
  function finish() {
    if (!waiting.delete(finish) || res.destroyed) return;
    clearTimeout(timer); completed++;
    const content = resultFor(body);
    if (body.stream) {
      res.setHeader('content-type', 'text/event-stream');
      res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'fixture', model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    }
  }
}).listen(8800, '0.0.0.0');
