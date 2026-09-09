// Trusted local converter in a bounded subprocess. Never inherits app credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';
import { convertPathToMarkdown } from './doc2markdown/convert.mjs';

const [source, output] = process.argv.slice(2);
const assets = []; const warnings = [];
let producedBytes = 0;
try {
  if (['.docx', '.xlsx'].includes(path.extname(source))) {
    const entries = new AdmZip(source).getEntries();
    if (entries.length > 5000 || entries.reduce((sum, e) => sum + e.header.size, 0) > 512 * 1024 * 1024) throw new Error('文档解压大小或文件数量超过限制');
  }
  if (path.extname(source) === '.pdf') {
    const pdf = new PDFParse({ data: await fs.readFile(source) });
    try { if ((await pdf.getInfo()).total > 500) throw new Error('PDF 超过 500 页，请拆分后上传'); } finally { await pdf.destroy(); }
  }
  await fs.mkdir(output, { recursive: true });
  const resolver = async ({ buffer, mime, sourceName }) => {
    try {
      if (assets.length >= 300 || buffer.length > 20 * 1024 * 1024) throw new Error('图片数量或大小超过限制');
      const png = await sharp(buffer, { limitInputPixels: 40_000_000 }).png().toBuffer();
      producedBytes += png.length;
      if (producedBytes > 200 * 1024 * 1024) throw new Error('图片总量超过限制');
      const id = randomUUID(); const fileName = `${id}.png`;
      await fs.writeFile(path.join(output, fileName), png, { flag: 'wx', mode: 0o600 });
      assets.push({ id, fileName, mimeType: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') });
      return `yibiao-asset://${id}`;
    } catch (error) {
      warnings.push(`图片无法解析：${String(error.message).slice(0, 160)}`);
      return 'yibiao-missing://image';
    }
  };
  const markdown = path.extname(source) === '.txt' ? await fs.readFile(source, 'utf8')
    : await convertPathToMarkdown(source, { includeImages: true, imageResolver: resolver });
  if (!markdown.trim()) throw new Error('原件没有可用文本，需 OCR 或人工处理');
  if (Buffer.byteLength(markdown) > 10 * 1024 * 1024) throw new Error('解析文本超过 10 MiB 限制');
  if (/!\[[^\]]*\]\((?:https?:|file:)|<img[^>]+src=["'](?:https?:|file:)/i.test(markdown)) warnings.push('原文包含未导入的外部图片，预览与导出将显示缺图提示');
  process.stdout.write('\nYIBIAO_RESULT=' + JSON.stringify({ markdown, assets, warnings }));
} catch (error) {
  process.stdout.write('\nYIBIAO_RESULT=' + JSON.stringify({ error: error.code === 'pdf_text_layer_missing' ? '扫描 PDF 无文字层，需 OCR 或人工处理' : error.message, code: error.code }));
  process.exitCode = 1;
}
