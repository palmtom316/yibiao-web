# P3-01 商务要求与独立抽取

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：business-bid/store.ts；business-extract job；BusinessBidPage。

人工要求、原文来源/位置、核验日期/标段、抽取版本和人工修订完整；重抽保留人工改文，同一作业重试不重复产出；原件/标段/日期变化需复核。技术目录与商务抽取提示词及结果分域。

验证：business-bid/lifecycle.integration.test.ts 的实际 PG + 模型 fixture；浏览器人工要求维护。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：仍缺批准的真实模型及脱敏招标，实际要求抽取质量未验收。

回退：关闭自动抽取，保留人工清单和历史版本。
