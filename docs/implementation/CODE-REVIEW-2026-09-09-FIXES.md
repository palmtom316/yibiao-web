# 代码审查逐条核实与修订记录（2026-09-10）

对照 [CODE-REVIEW-2026-09-09](CODE-REVIEW-2026-09-09.md) 的全部 P1/P2 发现，在 `implement/web-transformation-20260908` 上逐条核实并修订。修订不改变 STATUS 的 BLOCKED/DONE 判定，也不构成生产发布。

## 核实结论与处理

| 发现 | 核实结果 | 处理 |
| --- | --- | --- |
| P1-01 `snapshotHistory` 空 `OR` 500 | **未能复现。** 当前锁定 Prisma 6.19.3 下空 `OR: []` 合法返回空集；新集成测试（零快照、纯 asset 快照）在未修改代码时已通过 | 不改行为代码；新增集成测试锁定契约（`lifecycle.integration.test.ts` "snapshot history works for empty projects and asset-only snapshots"） |
| P2-01 共享标记依赖可变 ALS 对象 | 属实 | ① 任务启动时若 `referenceKnowledgeDocumentIds` 非空或存在章节快照，立即 `includesSharedData=true` 并追加 `knowledge-base` 模块（`tasks/service.ts`）；② runner 作用域 `structuredClone` 冻结；③ `ai/service.ts` 入队时克隆作用域；④ `knowledge-base/store.ts` 三处读取函数不再改写作用域对象。新增集成测试 `knowledge-base/processing-scope.integration.test.ts`（修订前红、修订后绿） |
| P2-02 Fastify 拒绝 hook 缺 `return reply` | 属实（4 处） | `createRequireAdmin`、`createRequireModule`、`asset-library` 410 hook、`routes/ai.ts` 403 均已改为 `return reply...`；新增 inject 测试：admin/module 钩子（`middleware.test.ts`）、personnel 410（`routes/asset-library.personnel.test.ts`） |
| P2-03 快照锁表 `Prisma.raw` | 属实（表名来自闭集，ID 参数绑定；FOR SHARE 必须 raw SQL） | 映射收拢为 `as const satisfies` 闭集 `LOCK_TABLES` 并注明约束；未知类型在 SQL 之前被 400 拒绝 |
| P2-04 死代码与过时注释 | 属实 | 删除 `collectParsedImports`（multipart.ts）及两处路由的无用 import；更正 `parser.ts`、`mermaid.ts`、`images.ts` 文件头注释；删除 `docxBuilder.ts` 未使用的 mermaid import 与 `cacheEntry` 死变量 |
| P2-05 MinerU 预签名上传 host | 属实（fail-closed 行为是刻意的） | 不改代码；EXTERNAL-ACCEPTANCE 明确允许列表必须覆盖创建/上传/轮询/下载四类地址且禁止开启自动重定向 |
| P2-06 普通用户可选 MinerU 但无 token | 属实 | `saveUserConfig`：选 `mineru-accurate-api` 且平台未配置 Token 时折回 `local` 并在响应 message 中提示；设置页在 Token 未配置时禁用该选项。`config.security.test.ts` 新增折回断言 |
| P2-07 OpenCode 运行时靠硬开关关闭 | 属实（按设计保留） | 不改代码；DEPLOYMENT 明确 `YIBIAO_AGENT_RUNTIME=opencode`/`YIBIAO_OPENCODE_BIN` 会被拒绝、生产镜像不得预装该二进制 |

## 验证（本次实跑）

- 服务端 typecheck：`server npx tsc --noEmit` 通过；客户端 `client npx tsc -b --noEmit` 通过。
- 单元测试：162/162 通过（新增 admin/module 钩子、personnel 410、MinerU 折回断言）。
- 集成测试：15/15 通过（临时 postgres:16 容器，TEST_DATABASE_URL=postgresql://postgres:***@127.0.0.1:5434/yibiao_test；含新增的空历史边界与作用域不变性两条）。
- 未重跑 Docker / 浏览器。真实模型/MinerU/脱敏样本仍按 STATUS 保持 BLOCKED。
