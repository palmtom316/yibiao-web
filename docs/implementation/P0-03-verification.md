# P0-03 迁移、旧库 baseline 与幂等初始化

状态：**DONE**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：server/prisma/migrations、baseline.prisma、seed-docs.ts；server/scripts/initialize.mjs、baseline.mjs、update-builtin-docs.ts。

真实 PostgreSQL 覆盖空库、旧 db-push 风格库、重复初始化、drift/失败迁移；用户、配置和自定义文章保留。Compose 依赖 migrate 成功退出后才启动 app；恢复实例再次初始化后密码/自定义文章/排序未改变。

验证：db/migrations.integration.test.ts；恢复后的 restore-check.ts。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：迁移链截至 202609080006_snapshot_images。

回退：迁移为兼容增量，不修改已发布历史；不兼容时恢复同一 backupId 的 DB+文件+配置。禁止生产 db push/reset。
