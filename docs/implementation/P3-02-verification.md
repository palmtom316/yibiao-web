# P3-02 候选、人工核验与不可变引用

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：business-bid/evidence.ts、sources.ts、snapshots.ts、store.ts；ledger/lifecycle。

候选不会自动确认；未知金额/等级、有效期、不可公开、源版本变化及日期边界有拒绝/待核验。确认时复制字段、叙述和原件/图片，校验版本/hash，未 ready 不能交付；复制缺件标 error 可重新确认。源替换/删除不改副本，撤销阻止新的导出。

验证：business.integration.test.ts、lifecycle.integration.test.ts 与 ledger 规则；真实浏览器人工确认。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：来源历史页面明确显示变更/归档/缺失；不可绕过模块与项目权限。

回退：停用新确认，保留已有快照/撤销记录；不可回退为仅存源 ID。

前置门禁：本项独立实现与本地验证已经完成，但审核计划指定的上游 P0/业务验收尚未全部放行。本项不绕过前置条件宣布正式完成；待对应真实服务/脱敏样本验收通过后复核放行。
