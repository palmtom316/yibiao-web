# Web 改造全面代码审查报告

- **审查日期：** 2026-09-09
- **审查对象：** `implement/web-transformation-20260908` @ `be10550fe3175d8298deedcc804b8752f69941ef`
- **对照基线：** `main` @ `c9d45b2`（计划/文档修订）；实现集中在单提交 `be10550`
- **产品契约：** [TRANSFORMATION-PLAN.md](../TRANSFORMATION-PLAN.md)
- **实施自称：** [STATUS.md](STATUS.md)、[EVIDENCE.md](EVIDENCE.md)
- **审查结论：** **OK with notes。** 不得按本报告把分支标为可生产发布。

> **后续修订（2026-09-10 / 2026-09-11）：** 本报告的 **P1-01 经 `d17b76e` 核实为误报并撤回**（锁定 `@prisma/client@6.19.3` 下空 `OR: []` 合法，回归测试在未改行为代码时通过）；**P2-01～P2-07 已修复或写入文档**。逐条证据见 [CODE-REVIEW-2026-09-09-FIXES.md](CODE-REVIEW-2026-09-09-FIXES.md)，PVE 部署设置见 [PVE-PRE-DEPLOY-2026-09-11.md](PVE-PRE-DEPLOY-2026-09-11.md)。本报告保留审查当时的结论原文、不追改；如有冲突，以修订记录为准。

---

## 1. 审查范围与方法

审查覆盖本仓库当前 HEAD 的服务端、客户端、Prisma/迁移、Docker/Compose、部署脚本与改造文档，重点是相对 `main` 落地的 P0–P3 改造，而不是上游桌面仓的历史代码。

方法：

1. 对照计划第 2 节审核发现（R01–R12）、第 4–5 节通用契约、第 6 节任务验收和第 9 节 A01–A10。
2. 阅读关键实现与集成测试，而不是只读 STATUS/EVIDENCE。
3. 曾并行派出安全、商务闭环、解析导出、部署/证据四条只读审查车道；父流程在约 20 分钟后超时，子报告未落盘。本报告以父代理对当前 HEAD 的源码核验为准，不引用未完成的子报告。
4. 未在本审查回合重跑测试、Docker 或浏览器。测试结论引用仓库内 TAP/EVIDENCE，并标明哪些是源码事实、哪些是既有验收记录。

**不把下列事项当成代码缺陷：** STATUS 已标明的真实模型/MinerU/脱敏招标样本缺失（P0-04 及之后多数任务保持 BLOCKED）；P4 非目标；合成 fixture 不能证明真实模型质量。

---

## 2. 总评

这次改造把审核计划里的上线阻断项做成了可运行的 Web 契约，而不是只加菜单。

已经落地、且与计划一致的主轴：

| 计划项 | 源码结论 |
| --- | --- |
| R01 配置密钥回传 | 所有配置读写走 `redactSecrets`；空值保留、掩码拒绝、显式 `clear_secrets` |
| R02 导出 `base_dir` / 任意图片 | 路由忽略客户端路径，绑定项目 workspace；`loadImage` 拒绝 `file:`、绝对路径、远程 URL |
| R03 Pi 任意工具 | 实际工具为 `read/write/edit/ls/json-validation/ask-user/report-failure`；无 bash；工作区 `resolveInside` + `O_NOFOLLOW` |
| R04 Node 22 | `.node-version` / Dockerfile / `engines` 固定 22.23.2 |
| R05/R06 迁移与 seed | 已提交 migrations；常规 seed 只补缺失文档；旧库 baseline 有集成测试 |
| R07 任务恢复 | 正文 paused，其余 error；BackgroundJob 重启标可重试中断 |
| R08/R09 原件与图片 | 先 `persistSource` 再解析；`parse-worker` `includeImages:true`；授权预览按文件 ID |
| R10–R12 台账/快照/出网 | 结构化字段、确认时复制、默认拒绝出网、公网 mermaid.ink 禁用 |

商务闭环（人工确认、未知≠满足、不可变快照、撤销检查、正式 ZIP 拒缺件、跨用户拒下载）在 `business.integration.test.ts` 与 `lifecycle.integration.test.ts` 里有真实 PostgreSQL 证据。Docker 单进程、非 root、只暴露 443、migrate 成功后才起 app，与第 4.1/8 节一致。

**发布判断：** 代码实现明显超过“开发预览”，但仍不能宣称 P0 出口或生产交付。STATUS 把 P0-04/P0-05 及 P1/P3 标 BLOCKED 是诚实的：缺获批模型/MinerU/脱敏样本，计划第 10.2 节的发布门禁未满足。本审查另发现 1 个应修的 P1 功能缺陷和若干 P2 契约脆弱点。

**Merge verdict: OK with notes。** 可继续留在改造分支做外部验收与 P1 修复；不要把本提交描述为已通过全部计划验收。

---

## 3. 发现

严重度：

- **P0：** 可导致泄密、越权写、数据损坏，或直接违背已关闭的上线阻断项。
- **P1：** 当前 HEAD 可复现的正确性/可用性缺陷，会打断改造主路径或默认页面。
- **P2：** 真实但可延后：契约脆弱、死代码、Fastify 写法、测试缺口。

### P1-01 商务引用历史在空 `OR` 时会 500

- **位置：** `server/src/business-bid/snapshots.ts` `snapshotHistory()`（约 104–117 行）
- **调用链：** `GET /api/business-bid/snapshots` ← `client/.../ReferenceHistory.tsx` 挂载时无条件请求
- **证据：**

```ts
prisma.knowledgeItem.findMany({
  where: { OR: ids('knowledge-item').map(...) }
})
prisma.referenceRevocation.findMany({
  where: { OR: origins.map((o) => ({ sourceType: o.type, sourceId: o.id })) }
})
```

Prisma 6 不允许空 `OR`（`PrismaClientValidationError`）。以下都会走进空数组：

1. 项目还没有任何快照（`origins = []`）。商务响应页每次打开都会打这个接口。
2. 已有快照但 provenance 不含 `knowledge-item`（纯公司资质/证书确认）。

现有 `lifecycle.integration.test.ts` 的样本带知识条目，所以测不到。`id: { in: [] }` 一般会返回空集，问题集中在两处 `OR`。

- **影响：** 商务响应页引用历史失败；前端显示“引用记录暂不可用”。不破坏确认/出包主路径，但默认工作台会报错。
- **建议：** `OR` 为空时跳过查询或改成恒假条件（例如 `id: { in: [] }`）。补测试：零快照、仅 asset 快照、含 knowledge-item 快照。

### P2-01 共享出网标记依赖可变 ALS 对象，而不是任务输入

- **位置：**
  - `server/src/tasks/service.ts` 约 507–512 行：启动时只看 `chapterReference`，不看 `referenceKnowledgeDocumentIds`
  - `server/src/knowledge-base/store.ts` `readItems` / `readReferences` / `getOutlineReferences`：把 `scope.includesSharedData = true`
  - `server/src/ai/service.ts` 约 1064–1066 行：入队时捕获 **同一对象引用**
- **契约：** 计划 4.3：含共享资料的外发必须同时满足项目开关和共享策略；缺少数据域上下文则拒绝。
- **现状：** 真正读知识时会打标，默认偏拒绝，未见“把共享正文送给未授权端点”的实锤路径。目录 V2 先 `readReferences` 再请求模型，顺序是对的。
- **风险：**
  1. 普通目录/正文若在读知识前就发模型请求，第一跳可能只按项目开关放行（该跳通常还不含知识正文）。
  2. 入队捕获引用，后续突变会影响已排队任务，策略变得不可预测。
  3. 配图路径（`illustrations/service.ts`）自己计算 `includesSharedData`，任务引擎启动时不算知识文档 ID，两套规则会分叉。
- **建议：** 启动任务时若 `referenceKnowledgeDocumentIds.length > 0` 或存在章节引用，立即 `includesSharedData=true`；入队前 `structuredClone` 作用域；禁止知识读取函数改 ALS。

### P2-02 Fastify 拒绝 hook 没有 `return reply`

- **位置：**
  - `server/src/auth/middleware.ts` `createRequireAdmin`
  - `server/src/auth/permissions.ts` `createRequireModule`
  - `server/src/routes/asset-library.ts` 旧人员库 410 hook
  - `server/src/routes/ai.ts` 非管理员测模型 403
- **证据：** Fastify 5.2 `lib/hooks.js` 的 `hookIterator` 在 `reply.sent === true` 时跳过后续 hook；`handleRequest` / `preHandlerCallback` 同样检查 `reply.sent`。当前 **不会** 因漏 `return` 就执行写路由。人员写仍被 store 层 410 兜底（`ledger.integration.test.ts` 已覆盖）。
- **建议：** 所有拒绝路径写成 `return reply.code(...).send(...)`，并给 admin/module/personnel 各加一条 inject 测试，避免升级 Fastify 或补代码后回归。

### P2-03 快照锁表使用 `Prisma.raw`

- **位置：** `server/src/business-bid/snapshots.ts` `lockSourceVersions()`
- **证据：** 表名/列名来自闭集 map（`asset_items` 等），ID 走参数绑定。`businessSource()` 拒绝未知 type，确认路径不会让客户端直接指定表名。
- **建议：** 改成 Prisma `findUnique` + 事务隔离，或对 type 做 `satisfies` 穷尽检查，去掉 raw SQL。

### P2-04 死代码与过时注释会造成“旧漏洞还在”的误判

| 文件 | 问题 |
| --- | --- |
| `server/src/document/multipart.ts` `collectParsedImports` | 招标/废标导入已改 `startImport`→`persistSource`；该函数仍 `parseDocument` + 解析后删临时文件，且被 routes 无用 import |
| `server/src/document/parser.ts` | 注释仍写 “preserveImages 恒 false”；`includeImages:false` 后再 `stripMarkdownImages`。现行闭环走 `parse-worker.mjs` |
| `server/src/export/mermaid.ts` | 注释仍写走 mermaid.ink；`mermaidInkUrl()` 已抛错。`docxBuilder.ts` 仍 import 未使用的 `mermaidInkUrl` / cache helpers |
| `server/src/export/images.ts` 文件头 | 仍写 “data:/http(s):/file:/绝对路径全部保留”，实现已拒绝 |

- **影响：** 下次审核/交接容易把注释当成 R02/R08/R12 回归。`collectParsedImports` 若被重新接线，会再次丢掉原件。
- **建议：** 删除死路径，或加 `@deprecated` 并让 `collectParsedImports` 直接 `throw`。

### P2-05 MinerU 预签名上传 URL 可能被白名单误杀

- **位置：** `server/src/document/mineru.ts`：创建任务后对 `uploadUrl` / `resultUrl` 再走 `processingFetch` → `assertProcessingUrl`
- **契约：** 重定向后的目标也必须再校验。实现拒绝 3xx，并对 PUT 目标做端点匹配。
- **影响：** 真实 MinerU 若把文件传到 `*.aliyuncs.com` 等未列入 `YIBIAO_EXTERNAL_ENDPOINTS` 的地址，会失败并回落本地。这是 fail-closed，符合“未批准端点次数为 0”，但也会让 P1-02 真实验收卡在配置而不是解析质量。
- **建议：** 外部验收清单写明：允许列表必须覆盖创建、上传、轮询、下载四个 host；不要为了过验收改成 follow redirect。

### P2-06 普通用户可把解析器改成 MinerU，但没有 token

- **位置：** `saveUserConfig` 白名单含 `file_parser.provider`；token 仅管理员可写
- **影响：** 用户选 `mineru-*` 后，解析会尝试外发，缺 token/策略则失败或回落本地。不是泄密，但错误信息会吵。
- **建议：** 未配置 token 或项目未授权时，UI 禁用 MinerU 选项，服务端把无效 provider 折回 `local` 并警告。

### P2-07 OpenCode 运行时仍在树内，靠硬开关关闭

- **位置：** `server/src/agent/runtimeService.ts`：`isOpenCodeToolsAdapted() { return false }`，`ensureStarted()` 直接抛错
- **评价：** 符合“未适配则明确降级”。默认 `YIBIAO_AGENT_RUNTIME=pi`。
- **建议：** 生产镜像不要安装 `YIBIAO_OPENCODE_BIN`；文档写明该环境变量会被拒绝，而不是“以后再开”。

---

## 4. 计划阻断项核对（R01–R12）

| ID | 计划问题 | HEAD 结论 |
| --- | --- | --- |
| R01 | GET/PUT 配置回传真实密钥 | **已关。** `config.security.test.ts` 覆盖 admin/user GET、PUT user、空值保留、掩码 400、显式清除、停用后 401 |
| R02 | 导出接受 `base_dir`；图片可读绝对路径/`file:`/任意 HTTP | **已关。** 路由覆盖 `base_dir`；`boundaries.test.ts` 拒绝穿越、符号链接、远程与 `file:` |
| R03 | Pi 启用 bash/edit/write 且无 OS 隔离 | **部分改写后可接受。** 无 bash；文件工具限制在任务目录；`piSessionBoundary.test.ts` 打到真实 SDK。cwd 仍非容器级隔离，符合计划“第一期不提供任意 bash” |
| R04 | Node 20 / 锁文件不匹配 | **已关。** 22.23.2 + pnpm 10.17.1 + npm 10.9.3 |
| R05 | 无 migrations、生产 `db push` | **已关。** 001–006 已提交；`migrations.integration.test.ts` 覆盖空库、旧库 baseline、drift 拒绝、失败回滚 |
| R06 | seed-docs upsert 覆盖正文 | **已关。** `update: {}`；重复初始化保留自定义文档 |
| R07 | 重启任务语义不清 | **已实现。** 正文 paused；BackgroundJob/解析 running→error 可重试 |
| R08 | 上传后删原件 | **主路径已关。** `startImport` 持久化后再解析。死代码 `collectParsedImports` 仍是旧行为，见 P2-04 |
| R09 | `includeImages:false` 又 strip | **主路径已关。** worker 保留图片为 `yibiao-asset://`。旧 `parser.ts` 仍 strip，已无调用方 |
| R10 | 台账缺证号/类别/有效期类型 | **已实现。** `validityKind`；空到期=unknown；金额十进制字符串 |
| R11 | 只存源 ID、删除源即丢引用 | **已实现。** 确认时复制；源删除不级联快照；业绩仍引用则 409 |
| R12 | mermaid.ink / 默认出网 | **已关。** `mermaidInkUrl` 抛错；本地 Chromium；`processingFetch` 默认拒绝、不跟随重定向 |

---

## 5. 分域结论

### 5.1 安全、密钥、隔离

做得对：

- 浏览器只看到 `configured` + 空密钥；内部 `buildMerged` 仍持有真值供 AI/Pi 使用。
- `YIBIAO_INTERNAL_ENDPOINTS` / `YIBIAO_EXTERNAL_ENDPOINTS` 空则拒绝全部模型/OCR 出网。
- 项目 `allowExternalProcessing` 默认 false，仅管理员可改；共享策略独立，不能借用请求头。
- Pi 环境不继承 `DATABASE_URL` / `JWT_SECRET` / `OPENAI_API_KEY`。
- 资源解析拒绝 `..`、绝对路径、scheme、符号链接；读文件用 `O_NOFOLLOW`。
- SSE 按项目校验归属，心跳时复查账号/模块；知识/商务 job 对无 `knowledge-base` 的用户隐藏。
- Fastify logger `redact` 含 `authorization`、`api_key`、`mineru_token`。
- 分析上报 `trackAiRequest` 在 Web 为空操作。

剩余：P2-01 共享标记；P2-02 hook 写法；OpenCode 必须保持关闭。

### 5.2 台账、业绩、商务闭环

做得对：

- 公司/人员最小台账字段、一人多证、业绩真实关联表与 FK。
- `evaluateCandidate` 对金额/日期/等级/岗位逐项给出 met/failed/unknown；`confirm` 在 `confirmed` 时要求全部 met，且要求须 `humanEdited`。
- 关键词检索只写 `candidate/pending`，工作台断言“检索不会确认满足”。
- 快照 staging→rename→事务置 ready；失败标 error 并清理；未 ready 不能正式导出。
- 叙述图复制为快照自己的 `documentAsset` id，源知识物理删除后 Word 仍能导出该图。
- 撤销记录独立于源实体；新导出/下载走 `assertNotRevoked`。
- 技术章节权威块按快照确定性渲染；改金额会 409；`manualLocked` 阻止目录/正文覆盖。
- 正式 ZIP 缺附件 409；草稿带明显警告；他用户 `packageFile` 403。
- 旧 `library='personnel'` 写路径 store 层 410；迁移 dry-run、人工映射、可重复、不删旧文件。

剩余：P1-01 历史接口；金额比较用 `Prisma.Decimal`（正确）。

### 5.3 解析、导出、任务

做得对：

- 原件先落 `/data/.../original*`，hash 校验后再解析；失败不覆盖旧成功版本（新 version 行标 error，成功则 `rename` 到 `versions/N`）。
- 扫描 PDF 无文字层明确失败（worker 映射 `pdf_text_layer_missing`）。
- 知识搜索：pageSize=100，空词空结果，非法页→1，超尾回落，未完成文档不进结果。
- 本地图表：禁下载、abort 全部网络、HTML 去 script；Mermaid `securityLevel:'strict'`。
- OpenXml helper：workspace 内路径、超时、缺工具降级普通目录。
- 解析/导出队列默认并发 1；关停拒绝新任务。

剩余：P2-04 死路径；P2-05 MinerU 上传 host；LibreOffice 配置文件写在 `os.tmpdir()`（Compose 给了 `/tmp` tmpfs，方向正确）。

### 5.4 部署、迁移、证据诚实度

做得对：

- Compose：postgres 不映射宿主端口；nginx 只 443；`migrate` `service_completed_successfully` 后才起 app；app `read_only` + `cap_drop: ALL` + `tini` + 非 root。
- 上传上限：nginx `client_max_body_size 201m`，应用 100 MiB/文件、10 个文件、合计 200 MiB。
- seed 不覆盖管理员正文/密码；失败迁移不启动 app。
- 备份脚本先 `stop` app/nginx 再 dump，检查 app 未残留；恢复拒绝拼接不同批次。
- STATUS/EVIDENCE 未把 mock 改成 DONE；EXTERNAL-ACCEPTANCE 列出真实样本门槛。
- CI：`verify.yml` 跑两端 typecheck/build/test；集成测试不在 GitHub 默认作业（需显式 `TEST_DATABASE_URL`），与“无 DB 的测试和真实库测试分开”一致。

注意：

- EVIDENCE 中的镜像 digest、`/tmp` 备份路径是验收当时环境，不在 git 里，本审查未复验。
- 前端 >500 kB chunk 警告按计划保留，不是藏测试。
- `better-sqlite3` 仍在依赖中，仅 OpenCode 兼容路径使用，符合计划第 1.4 条例外。

---

## 6. 测试与证据缺口

已有且对改造有价值：

- 配置脱敏、文件边界、Pi SDK 工具集、处理域授权
- 迁移四种场景
- 知识搜索分页边界
- 台账金额/日期/冲突/引用保护
- 商务确认/快照不变性/技术权威字段/ZIP 权限
- 人员迁移守恒
- MinerU 未授权 sends=0、401/429/超时/坏 ZIP

本审查认为仍缺（不必等真实模型）：

1. **`snapshotHistory` 空 provenance / 零快照**（P1-01）
2. **Fastify inject：非管理员打 `/users`、无 knowledge-base 打商务写接口、对 `personnel` 库 POST**（锁住 P2-02）
3. **任务启动时仅选参考知识文档、无章节快照时 `includesSharedData` 的外发断言**
4. **`collectParsedImports` 无调用方** 的静态断言或直接删除

真实模型/OCR/脱敏招标仍按 STATUS BLOCKED，不在本报告重复开缺陷。

---

## 7. 建议修复顺序

1. **立刻（合并前建议）：** 修 P1-01，补零快照/无 knowledge-item 的集成测试。
2. **外部验收前：** P2-01 作用域在启动时冻结并 clone；验收清单写全 MinerU host。
3. **清理：** 删或封印 `collectParsedImports`；改 Fastify `return reply`；去掉误导注释和未使用 mermaid import。
4. **不要做：** 不要为了把 STATUS 变绿去接未批准公网；不要打开 OpenCode；不要宣称 P0 出口已过。

---

## 8. 残留风险（非缺陷）

1. 单进程任务锁/事件总线：不能 PM2 cluster 或多副本，计划已冻结。
2. 真实模型质量、目录 V2 人工阶段、配图事实性：合成 fixture 不能代替。
3. 扫描件为主输入时，P1-02 必须在批量录入前通过。
4. 备份目前在开发机 `/tmp` 演练，不能当生产 RPO/RTO。
5. AGPL：页面源码入口必须指向**正在运行的修改版**，不能只链官方桌面仓。

---

## 9. 审查声明

- 未改业务代码；本文件是审查产物。
- 未复跑 `pnpm test` / Docker / 浏览器。命令与 TAP 以 [EVIDENCE.md](EVIDENCE.md) 为准。
- 并行子审查超时，不作为本报告证据。
- 发现均对照当前 HEAD；STATUS 的 BLOCKED 不升级为代码 P0。
