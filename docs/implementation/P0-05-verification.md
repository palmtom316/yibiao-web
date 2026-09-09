# P0-05 故障、同批备份与恢复

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：tasks/service.ts、jobs/service.ts、events；deploy/backup；verification/faults.ts、restore-check.ts。

断开 SSE 后两个项目分析完成；SIGTERM 550 ms；SIGKILL 337 ms，正文重启后 paused，另一项目不变；强制重建 10104 ms，仍可导出 Word。71 文件同批恢复逐一核对 hash；密码、自定义文章/排序、两证书、知识原件、项目正文均保留。旧程序/依赖回退镜像基础冒烟通过后已切回新版本。

验证：faults.json；备份 20260908T115405.041599Z：5.109 秒，恢复校验 16.636 秒；含镜像备份 20260908T153304.266958Z：26.786 秒；具体边界见 EVIDENCE.md。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：旧镜像标签覆盖导致首次回退失败；从保留容器的 162 个旧程序文件及原依赖重建，源清单文件 SHA-256 为 9b63edbd5259c42e33e84bf4778d68954ebff1f21093f025180b332cf98f864c。回退只证明该合成数据的基础路径，生产容量/RPO 不由此推断。

回退：保留当前副本，在另一个空环境恢复整批。备份为 app/migrate/nginx/postgres 固定独立标签，可用 --save-images 归档；回退禁止隐式 build/pull 替代镜像。

前置门禁：本项独立实现与本地验证已经完成，但审核计划指定的上游 P0/业务验收尚未全部放行。本项不绕过前置条件宣布正式完成；待对应真实服务/脱敏样本验收通过后复核放行。
