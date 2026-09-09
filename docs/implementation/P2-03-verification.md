# P2-03 遗留人员写门禁及可重复迁移

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：personnel/legacy-migration.ts；scripts/migrate-personnel.ts；asset-library 旧接口。

旧 personnel 新增/修改返回 410，保留只读定位。dry-run/人工映射、不能凭同名合并、重复运行无新增、源/目标 hash 及数量守恒已测。当前隔离运行库实际 dry-run total=0，五类计数全部 0。

验证：personnel/legacy-migration.integration.test.ts；EVIDENCE.md 的零条核查结果。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：零条报告仅代表本隔离库，生产数据数量未提供。

回退：按映射报告撤回新记录/关联，旧文件不自动删除；生产批量录入前独立 dry-run，扫描件另受 P1-02 门禁。

前置门禁：本项独立实现与本地验证已经完成，但审核计划指定的上游 P0/业务验收尚未全部放行。本项不绕过前置条件宣布正式完成；待对应真实服务/脱敏样本验收通过后复核放行。

最终门禁包括 DELETE：旧人员数据既不能普通归档也不能物理删除，必须走受控迁移；删除在数据库/文件操作前返回 410。
