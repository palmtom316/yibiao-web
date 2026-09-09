# P1-06 按需上游修复与登记

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：UPSTREAM-PORTS.md；outlineV2 vendor；duplicateAnalysisHelpers.ts、duplicate-analysis.ts；Pi report-failure。

按固定 SHA 登记具体适用提交、桌面不适用项与 Web 差异；目录严格字数回归采用最终修正版。查重长句由前缀重复扫描改为递增计数，近似匹配复用计数且每 500 句让出事件循环；元数据状态独立结束。保留 CJS 测试。

验证：duplicateUpstream.test.ts：26 万字匹配内容保持、显示单独截断；交错匹配计数不串；outlineV2.test.cjs 原上游样例。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：report-failure 的真实模型调用表现随 P1-04 联调；没有整仓 rebase 或复制 Electron 运行时。

回退：可分别撤回对应算法适配；不得覆盖 Web 权限、异步 PG、数据域及不可变文件约束。

前置门禁：本项独立实现与本地验证已经完成，但审核计划指定的上游 P0/业务验收尚未全部放行。本项不绕过前置条件宣布正式完成；待对应真实服务/脱敏样本验收通过后复核放行。
