固定来源：palmtom316/yibiao b079bc0d923c4a533b9c2de3a9f573f4c75d8137，AGPL-3.0-only。

- contentIllustrationPlanning.cjs：services 同名纯规划算法。
- contentIllustrationGeneration.cjs：services 同名生成/修复/插入算法；仅替换 require 的本地适配路径，并让已保存图片优先于 Mermaid 临时代码。
- mermaidPolicy.cjs、remoteImageRetry.cjs：utils 同名规则；后者只提供有限重试，不自行访问远程网络。
- htmlLayoutProbe.cjs：localImageRenderService.cjs 的纯 DOM 质检脚本；未复制 Electron 窗口/文件网络设置。
- webImageRenderAdapter.cjs：本仓 Web 适配，离线 Playwright/Chromium + 有界截图。

权限、服务端凭据、异步 PostgreSQL、任务/文件隔离由上层 service.ts 与 render.ts 负责。回归证据见 docs/implementation/UPSTREAM-PORTS.md。
