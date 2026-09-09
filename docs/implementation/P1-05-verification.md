# P1-05 配图规划、修复与离线渲染

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：illustrations/vendor、service.ts、render.ts；content-generation runner；IllustrationPanel。

移植上游规划、HTML 质检/布局修复、Mermaid 修复和结果结构。真实 Chromium 离线绘制并导出 2 图；规划 fixture 2 图，HTML 实际修复 1 次、Mermaid 实际修复 1 次。多图同章及重试幂等回归通过。图片先保存项目资产，正文并发改动/锁定保护，失败保留图源。

验证：generation.test.cjs；verification/enhancements.ts；上游登记。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：本地图表及失败修复已实测，真实模型规划/公网生图未联调；需要获批端点/配置。图中业务事实仍由使用者核对。

回退：禁用渲染/规划，保留正文/已有图源与图片；不改走公网 mermaid.ink。
