// 合成 1×1 灰度+Alpha PNG（Word 文档里常见的占位/间隔图）。
//
// 用途：集成测试与镜像验证中作为嵌入图片的最小真实样本。
// 注意：base64 必须带**正确 CRC**。libvips 8.18（sharp 0.35）对 PNG chunk CRC 是硬校验，
// 早期手工拼接、CRC 错误的 1×1 PNG 会被直接拒绝（报 `vipspng: libpng read error`），
// 而旧版解码器会静默接受——测试因此曾依赖一个损坏的样本。改样本请先用
// `sharp(png).png().toBuffer()` 验证能读能写。
export const SYNTHETIC_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

export function syntheticPng(): Buffer {
  return Buffer.from(SYNTHETIC_PNG_BASE64, 'base64');
}
