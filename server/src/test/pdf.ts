import { deflateSync } from 'node:zlib';

/** Small valid synthetic PDFs, never copied from customer documents. */
export function syntheticPdf(scanned: boolean): Buffer {
  const text = Buffer.from(scanned ? 'q 100 0 0 100 20 20 cm /Im1 Do Q' : 'BT /F1 12 Tf 20 100 Td (Synthetic procurement requirements and maintenance service.) Tj ET');
  const pixel = deflateSync(Buffer.from([0, 70, 150]));
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << ${scanned ? '/XObject << /Im1 5 0 R >>' : '/Font << /F1 5 0 R >>'} >> /Contents 4 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Length ${text.length} >>\nstream\n`), text, Buffer.from('\nendstream')]),
    scanned ? Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixel.length} >>\nstream\n`), pixel, Buffer.from('\nendstream')]) : Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')]; const offsets = [0]; let length = parts[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length); const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); parts.push(part); length += part.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}
