# P1-01 原件、图片、解析版本与溯源

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：document/sources.ts、imports.ts、parse-worker.mjs；document-sources API；DocumentSourcesPanel、AuthorizedImage；export/images.ts。

带图片/表格 DOCX、文本 PDF、重复文件名、损坏 DOCX、扫描 PDF 分类均经真实 DB 验证；重解析保留旧成功版本，未授权用户不能读图。源知识文档物理删除后已确认项目图片仍保留，可进入 Word；恢复的原件/图片逐文件 hash 一致。

验证：document/sources.integration.test.ts；business-bid/lifecycle.integration.test.ts；native/restore 验收。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：扫描件没有 OCR 时明确失败，质量增强真实服务见 P1-02。

回退：可关闭新增预览或解析增强，保留原件/成功版本。旧 Markdown 显示原件不可用，不能伪造原件或删除已发布图像。

前置门禁：本项独立实现与本地验证已经完成，但审核计划指定的上游 P0/业务验收尚未全部放行。本项不绕过前置条件宣布正式完成；待对应真实服务/脱敏样本验收通过后复核放行。
