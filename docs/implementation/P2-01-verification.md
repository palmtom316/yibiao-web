# P2-01 台账字段、关系、版本与生命周期

状态：**DONE**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：Prisma 002–006 迁移；ledger、asset-library、personnel、performance。

证号/等级/签发方/生效时间、dated/permanent/unknown；存量空有效期保持 unknown，金额十进制字符串，上海截止日当日有效。关联表/FK、条目属于文档、团队存在、版本冲突、归档/物理删除保护和独立撤销均验证。归档资料仍可解除旧业绩关联。

验证：ledger、performance 及 business/lifecycle 真实 DB 回归；旧库迁移测试。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：归档不撤销已确认副本；使用许可撤销有独立记录。

回退：兼容新增字段/表；旧界面可读，不删除扁平人员表；不兼容恢复完整同批备份。
