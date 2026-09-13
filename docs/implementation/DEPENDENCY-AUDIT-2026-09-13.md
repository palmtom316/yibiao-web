# 2026-09-13 服务端运行依赖复核（R12）

工具链：Node 22.23.2 / pnpm 10.17.1。范围是报告列出的 11 个包，以及它们在本仓库的直接或传递运行路径。公告条数不等于可利用问题数。没有为了零告警而删除格式支持或改审计数据。

升级前 `pnpm audit --prod`：36 条（high 26 / moderate 10）。升级后：6 条（high 5 / moderate 1）。前端 `npm audit --omit=dev`：0。

## 逐包

| 包 | 锁定 | 类型 | 公告 | 可达路径 | 处置 | 残留 |
| --- | --- | --- | --- | --- | --- | --- |
| `pdfjs-dist` | 6.2.108 | 直接 | CVE-2026-16633 / GHSA-hq66-cqwq-w95j（5.7.284 任意 JS） | `doc2markdown/convert.mjs` 只在 bounded `parse-worker` 中 `getDocument` | 升到 6.2.108；`enableScripting:false` `isEvalSupported:false`；主进程不再 import convert | 关闭。Node 引擎 `>=22.13` |
| `xlsx` | 0.18.5 | 直接 | CVE-2023-30533、CVE-2024-22363。npm 无修复版 | 仅 worker 内 `XLSX.readFile` 读用户表格 | 无 npm 修复。隔离：解析只在 768MB/180s 子进程，进程结束即丢弃污染。主进程 parser 改为 worker | **残留 P1 隔离**。替换 exceljs/SheetJS 0.20.2 需另测 `.xls` 兼容 |
| `adm-zip` | 0.6.0 | 直接 | CVE-2026-39244 已修；CVE-2026-76845 符号链接解压至 0.6.0 仍在 | parse-worker `getEntries()` 计大小；查重只 `readFile` 指定 `docProps/*.xml` | 升 0.6.0。不调用 `extractAllTo*` | **残留 moderate**：不跟随解压。后续等上游或换 jszip |
| `sharp` | 0.35.4 | 直接 | libvips/libheif 一组，修复于 0.35.4 | worker / illustrations `limitInputPixels: 40_000_000` | 升 0.35.4 | 关闭 |
| `image-size` | 2.0.2 | 直接 | CVE-2025-71330/71329，无修复版 | `export/images.measureImage` | 仅 PNG/JPEG/GIF/WebP 魔数才调用；拒绝 ICNS/JXL/HEIF | **残留 high，已限制解析器入口** |
| `@xmldom/xmldom` | 0.8.15 | mammoth 传递 | 10 条 0.8.13 公告，0.8.15 修复 | mammoth DOCX | override `0.8.15`，mammoth 1.12.3 | 关闭 |
| `fastify` | 5.12.4 | 直接 | CVE-2026-18504、CVE-2026-16732，修于 5.12.1 | HTTP 入口。`trustProxy` 未开 | 升 5.12.4 | 关闭 |
| `fast-uri` | 3.1.6 / 4.1.4 | ajv / fast-json-stringify 传递 | 多条 host confusion，3.1.6 与 4.1.4 修复 | schema/URL 校验，不用于处理出口 | override 两条线 | 关闭 |
| `undici` | 直接 6.28.1；pi-agent 8.9.0 | 直接 + 传递 | 审计中的 8.x 修于 8.9.0。6.x 无本轮所列 CVE | Agent HTTP；业务处理出口走 `processingFetch`/全局 fetch | 直接 6.28.1；override `undici@^8` → 8.9.0 | 关闭所列 8.x。cheerio 的 undici 7.29.0 不在本轮 11 包清单 |
| `ajv` | 8.18.0 | 直接 | CVE-2025-69873 `$data` ReDoS，8.18.0 修 | Fastify schema | 升 8.18.0。本项目 schema 不用 `$data` | 关闭 |
| `deepmerge-ts` | 7.1.5 | Prisma 传递 | CVE-2026-40345 递归栈，8.0.0 修 | `@prisma/config` 读配置，不合并用户文档 | 不强制升 8（Prisma 6.19.3 未声明兼容） | **残留 high，不可达用户文档** |

## 验证

- `pnpm run typecheck` 通过。
- `pnpm test` 185 通过、17 项 PostgreSQL 16 集成测试通过（`evidence/remediation-2026-09-13/post-server-*.tap`）。
- `pnpm audit --prod --json` = 6 条（`post-server-audit.json`）；`npm audit --omit=dev` = 0（`post-client-audit.json`）。
- 未在本轮构建 Linux 镜像；原生 `sharp` 0.35.4 / `pdfjs-dist` 6.2.108 需在最终镜像构建中复核。

xlsx / image-size / adm-zip symlink / Prisma deepmerge-ts 不能标已关闭。

## 行为变化：PNG chunk CRC 改为硬校验（需知悉）

`sharp` 0.34.5 → 0.35.4 带来 libvips 8.18，PNG 读取对 chunk CRC 由「宽松接受」变为**硬校验**。

- 触发路径：文档解析 worker 内 `sharp(...).png()` 对嵌入图片重编码。
- 影响：CRC 损坏的 PNG 会被拒绝，产生显式告警（`flagshipng: libpng read error`），该图片不产出资源；
  文档正文与其余资源照常解析，不会静默丢内容、也不会失败整个文档。
- 证据：仓库原先有三个测试夹具使用**IDAT CRC 错误**的 1×1 PNG，旧解码器静默接受、新解码器拒绝。
  已统一替换为校验通过的夹具 `server/src/test/png.ts`，并由 `document/sources.integration.test.ts`、
  `business-bid/lifecycle.integration.test.ts` 真实跑通「DOCX 嵌入图片 → 解析出资源 → 授权导出 → 校验 SHA-256」。
- 结论：对**合法**Office 文件无退化（真实文件 PNG 带正确 CRC）；对**损坏**图片由静默接受变为显式告警，
  属于更严格也更安全的行为，不视为功能退化。
