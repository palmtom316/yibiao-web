# P3-04 商务 Word、附件 ZIP 和清单

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：business-bid/export.ts、导出/下载 API、商务页。

合成样本真实浏览器要求→候选→人工确认→快照→正式 ZIP 完成。PG 验证 Word/附件/manifest 一致、中文同名不覆盖、缺件阻止正式包/草稿标记、两用户权限、撤销阻止下载、版本重试幂等；流式归档及持久 job。

验证：browser-business.zip；business.integration.test.ts、lifecycle.integration.test.ts；恢复环境重新导出 Word。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：计划指定一份脱敏招标闭环；当前仅合成样本，尚缺真实脱敏原件及获批服务，不能据此宣布整期业务交付完成。

回退：停止新出包，保留响应版本、快照与既有产物，不回写源资料。
