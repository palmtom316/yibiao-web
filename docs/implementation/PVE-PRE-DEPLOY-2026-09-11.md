# PVE 部署前：代码审核结论与部署设置

- **记录日期：** 2026-09-11
- **部署对象：** `main`（原 `implement/web-transformation-20260908` 已于 2026-09-11 fast-forward 合并进来并删除，`main` 即唯一线）；业务代码提交 `d17b76e`
- **审核记录：**
  - [CODE-REVIEW-2026-09-09.md](CODE-REVIEW-2026-09-09.md) —— 完整审查报告（对象 `be10550`）
  - [CODE-REVIEW-2026-09-09-FIXES.md](CODE-REVIEW-2026-09-09-FIXES.md) —— 逐条核实与修订记录（代码提交 `d17b76e`）
- **部署运维基线：** [../DEPLOYMENT.md](../DEPLOYMENT.md)
- **产品契约：** [../TRANSFORMATION-PLAN.md](../TRANSFORMATION-PLAN.md)
- **本文性质：** 部署向摘要 + 内部测试的完整配置参考。**不是**验收报告，**不**把任何 BLOCKED 项改成 DONE，**不**构成生产发布。

---

## 1. 部署前代码审核结论

**Merge verdict: OK with notes，并已按审查修订（`d17b76e`）。** 可上 PVE 做内部测试；**不得**宣称 P0 出口已过或可生产交付。

### 1.1 审查发现与修订结果

| 发现 | 级别 | 修订结果 |
| --- | --- | --- |
| **P1-01** `snapshotHistory` 空 `OR` 500 | ~~P1~~ | **审查误报，P1 撤回。** 锁定 `@prisma/client@6.19.3` 下空 `OR: []` 合法返回空集（`server/pnpm-lock.yaml` 解析为 6.19.3）。已在 `lifecycle.integration.test.ts` 新增「零快照 / 纯 asset 快照」回归测试，**未修改 `snapshotHistory` 行为代码**即可通过。审查方未独立复跑，以仓库内可执行测试为准 |
| **P2-01** 共享出网标记依赖可变 ALS 对象 | P2 | 已修：`tasks/service.ts` 启动时按章节引用或 `referenceKnowledgeDocumentIds` 一次性冻结 `includesSharedData` 并追加 `knowledge-base` 模块；runner 与 `ai/service.ts` 入队均 `structuredClone`；`knowledge-base/store.ts` 三处读取函数不再改写作用域。新增 `knowledge-base/processing-scope.integration.test.ts`（修订前红、修订后绿） |
| **P2-02** Fastify 拒绝 hook 缺 `return reply` | P2 | 已修 4 处 + inject 测试（`middleware.test.ts`、`routes/asset-library.personnel.test.ts`） |
| **P2-03** 快照锁表 `Prisma.raw` | P2 | 已收拢为 `as const satisfies` 闭集 `LOCK_TABLES`（`snapshots.ts:21`），并注明「行锁需 raw SQL、表名来自闭集、ID 参数绑定、未知类型先 400」 |
| **P2-04** 死代码与过时注释 | P2 | 已删除 `collectParsedImports` 及两处无用 import；更正 `parser.ts` / `mermaid.ts` / `images.ts` 注释；删除 `docxBuilder.ts` 未用 import 与死变量 |
| **P2-05** MinerU 预签名上传 host | P2 | 已写入 [EXTERNAL-ACCEPTANCE.md](EXTERNAL-ACCEPTANCE.md)：白名单必须覆盖创建/上传/轮询/下载四类地址，且禁止开启自动重定向。代码保持 fail-closed |
| **P2-06** 普通用户可选 MinerU 但无 token | P2 | 已修：`saveUserConfig` 在无 Token 时折回 `local` 并带警告；设置页在 Token 未配置时**禁用**「MinerU 精准解析 API」选项并标注「（需先配置 Token）」 |
| **P2-07** OpenCode 靠硬开关关闭 | P2 | 已写入 [DEPLOYMENT.md](../DEPLOYMENT.md)：`YIBIAO_AGENT_RUNTIME=opencode` / `YIBIAO_OPENCODE_BIN` 会被拒绝，生产镜像不预装二进制 |

### 1.2 仍关闭的出口

STATUS 的 P0-04 / P0-05 及 P1/P3 多数项保持 **BLOCKED**：没有获批的真实模型端点与凭据、没有脱敏招标样本、备份演练只在开发机完成。按计划 6.1，P0 出口未过意味着交付物只能定位为**开发预览**；按 10.2，发布门禁未满足。**本记录不改变这些判定。**

---

## 2. PVE 部署设置

拓扑（计划第 8 节）：**PVE → Ubuntu/Debian VM → Docker Compose**。不把 Electron 装进容器，不走 noVNC。

试配起点：约 5 人用 4 vCPU / 8 GB / 80 GB+ 数据盘。Compose 已限 `app` 为 3 cpus / 4g、`postgres` 2g、`nginx` 256m。

### 2.1 根目录 `.env`

由根 `.env.example` 复制。Compose 只读取其中下列键：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | ✅ | **URL-safe** 随机值；Compose 用 `${POSTGRES_PASSWORD:?...}` 强校验，缺失直接拒绝启动 |
| `JWT_SECRET` | ✅ | ≥32 位随机；同样强校验 |
| `TLS_CERT_DIR` | ✅ | 证书目录，须含 `fullchain.pem` / `privkey.pem`；只读挂到 nginx |
| `YIBIAO_PUBLIC_ORIGIN` | ✅ | 实际 HTTPS 站点地址 |
| `YIBIAO_INTERNAL_ENDPOINTS` | ✅（可为空） | 边界内端点白名单，逗号分隔。**空 = 拒绝全部内网端点调用** |
| `YIBIAO_EXTERNAL_ENDPOINTS` | ✅（可为空） | 出网端点白名单，逗号分隔。**空 = 拒绝全部出网调用** |
| `BUILD_COMMIT` | 建议 | 实际构建提交；注入前端 `VITE_BUILD_COMMIT` |
| `YIBIAO_OUTLINE_V2` | 可选 | 默认 `true`；设 `false` 并重建 app 回到普通目录流程 |
| `VITE_SOURCE_REPOSITORY_URL` | AGPL 要求 | 指向**正在运行的修改版**可访问源码，不能只链官方桌面仓 |

`.env.example` 里还有 `DATABASE_URL` / `HOST` / `PORT` / `YIBIAO_DATA_DIR` / `VITE_API_BASE_URL`，那是**裸机（PM2）路径**用的；Compose 里 `DATABASE_URL`、`YIBIAO_DATA_DIR=/data` 由 `docker-compose.yml` 的 `&app-environment` 锚点直接给定，不要在 `.env` 覆盖成宿主路径。

### 2.2 Compose 行为要点

```bash
docker compose config --quiet
docker compose build
docker compose up -d --wait
docker compose ps
```

- 端口：**只有 nginx 的 `443:443`**。postgres / app 无宿主端口。
- 启动顺序：`postgres` 健康 → `migrate` 成功退出 → `app` 健康 → `nginx`。
- `app`：`read_only` + `cap_drop: ALL` + `no-new-privileges` + `tini` 非 root；只写 `/data`（appdata 卷）与 `/tmp`（tmpfs 1g）；`stop_grace_period: 45s`。
- 网络：`backend` 为 `internal: true`（无外网出口），`app` 另挂 `egress`。即**出网能力只给 app 容器**。
- **必须单实例**：禁止 `--scale app=2`、PM2 cluster、多副本（任务锁/事件总线为单进程模型）。
- Agent 运行时固定 Pi：`YIBIAO_AGENT_RUNTIME=opencode` / `YIBIAO_OPENCODE_BIN` 会在启动时被拒绝，不要预装 opencode 二进制。
- 证书续期后：`docker compose exec nginx nginx -s reload`。
- 健康检查：`/health/live` 查进程，`/health/ready` 查数据库与数据目录并显示队列；nginx 不公开探针。**模型未配置不影响启动与管理员登录**。

### 2.3 数据布局与迁移

- 首次：`migrate` 服务执行 `prisma migrate deploy`，成功才 seed 管理员/提示词/文档缺失项。生产禁止 `db push`、`migrate reset`。
- 数据格式版本 1：`/data/<projectId>/workspace/{documents,references,generated-images,illustrations,openxml,business-packages}`；共享原件在 `/data/shared/document-sources/`。新迁移截至 `202609080006_snapshot_images`。
- 备份：`python3 deploy/backup/backup.py --env-file .env --destination /独立磁盘/yibiao`；恢复用 `restore.py` 到**另一个空环境**。`pgdata` 与 `appdata` 必须同批备份、同 `backupId` 恢复，不得拼接。
- 目标 RPO ≤ 24h / RTO ≤ 2h，**须演练后据实记录是否达到**；同 VM 另一目录不算独立备份，vzdump 不替代逻辑恢复演练。

---

## 3. 模型与解析端点的设置位置

三处**全部在「设置」页**，且**平台级字段只有管理员能落库**。

### 3.1 文本模型（设置页 →「文本模型」）

前端位置：`client/src/features/settings/pages/SettingsPage.tsx:1531-1680`（「文本模型配置」小节；下一节「生图模型配置」从 1681 开始）。

| 字段 | 组件 | 关键行为 |
| --- | --- | --- |
| 服务提供商 | 下拉 | `金龙中转站【推荐】` / `火山方舟` / `DeepSeek` / `Agnes AI` / `自定义`（`龙猫（历史配置）` 仅在已选中时以 disabled 显示） |
| **Base URL** | 文本框 | `SettingsPage.tsx:1563` `disabled={state.textModel.provider !== 'custom'}` —— **只有「自定义」可编辑** |
| **API Key** | 密码框 + 「获取」 | 存服务端；留空保留原值，填新值即替换 |
| **模型名称** | 输入框 / 下拉 | 可手填；点「拉取」调 `POST /api/ai/list-models` 变成下拉 |
| **测试** | 按钮 | 先保存配置，再发一句 `hi` 走 `POST /api/ai/chat` |
| 上下文长度上限 / 并发上限 / 请求模式 | | `流式请求` / `普通请求` |

预置 provider 的固定 Base URL（`SettingsPage.tsx:73-78`，改不动）：

| provider | Base URL | 默认 model_name |
| --- | --- | --- |
| `jinlong` 金龙中转站 | `https://jlaudeapi.com/v1` | `gpt-3.5-turbo` |
| `volcengine` 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 空 |
| `deepseek` | `https://api.deepseek.com` | 空 |
| `agnes` Agnes AI | `https://apihub.agnes-ai.com/v1` | 空 |
| `custom` 自定义 | 空（手填） | 空（手填） |
| `longcat` 龙猫（legacy） | `https://api.longcat.chat/openai/v1` | 空 |

> **要点：** 非 `custom` 时 `base_url` 会被强制写回上表常量（`SettingsPage.tsx:165`）。用中转站或未列出的厂商，**必须选「自定义」**，否则手填地址被丢弃。这是有意的安全设计。

### 3.2 MinerU（设置页 →「文件解析」）

| 字段 | 关键行为 |
| --- | --- |
| 解析方式 | `本地` / `MinerU 精准解析 API` / `MinerU 轻量解析 API`；Token 未配置时精准解析选项被禁用并标注「（需先配置 Token）」（`SettingsPage.tsx:1856-1858`） |
| **MinerU 服务地址** | `SettingsPage.tsx:1863` `disabled={!isAdmin}`，默认 `https://mineru.net` |
| **MinerU Token** | **仅「精准解析 API」需要**；轻量与本地不用填 |

服务端链路：`server/src/document/sources.ts:84` 取 `config.file_parser.mineru_base_url` → `server/src/document/mineru.ts:33` `const base = (options.baseUrl || 'https://mineru.net').replace(/\/+$/, '')`。

### 3.3 处理开关（两处，缺一不可）

| 开关 | 位置 | 接口 |
| --- | --- | --- |
| 项目级「允许外部处理」 | 项目设置 | `PUT /api/projects/:id/processing-policy`（非管理员 403） |
| 共享域「允许外部处理」 | 平台设置 | `PUT /api/config/processing-policy`（非管理员 403），字段 `allow_external_processing_shared` |

### 3.4 写入权限：为什么必须用管理员账号配

`client/src/features/settings/pages/SettingsPage.tsx:713`：

```ts
const saveFn = isAdmin ? bridge?.savePlatform : bridge?.save;
```

- **管理员** → `PUT /api/config` → 落 `text_model_profiles.<provider>.{api_key, base_url, ...}`、`file_parser.*`
- **普通用户** → `PUT /api/config/user` → 白名单（`server/src/config/store.ts:186` `USER_FIELD_WHITELIST`）只有 `text_model_provider` / `image_model` / `export_format` / `agent_mode_scenarios` / `developer_mode` / `developer_token_stats_auto_open` / `file_parser`，且 `file_parser` 只接受 `provider`

---

## 4. 端点白名单的匹配规则

`server/src/security/processing.ts` `assertProcessingUrl()`：

```ts
if (matchesEndpoint(url, process.env.YIBIAO_INTERNAL_ENDPOINTS)) return url;              // 边界内：无条件放行
if (policy.allowExternal && matchesEndpoint(url, process.env.YIBIAO_EXTERNAL_ENDPOINTS)) return url;
throw new ProcessingDeniedError('此数据域未获准使用该处理端点，请联系管理员');
```

| 名单 | 语义 | 额外授权 |
| --- | --- | --- |
| `YIBIAO_INTERNAL_ENDPOINTS` | 边界之内 | **无**：不看项目开关、不看共享域策略 |
| `YIBIAO_EXTERNAL_ENDPOINTS` | 出网 | 项目 `allowExternalProcessing === true`；含共享资料时还需 `allow_external_processing_shared === true` |

匹配细节（`matchesEndpoint`）：

- 同 **origin**（scheme + host + port）+ **路径前缀**。写 `https://api.deepseek.com`（无路径）→ 前缀为空 → 该 host 全部路径放行；写 `https://api.deepseek.com/v1` → 只放行 `/v1/*`。
- **允许 `http:`**，内网明文 HTTP 可用。
- URL 不能带用户名/密码/`#`。
- 多个端点逗号分隔。
- `processingFetch` 强制 `redirect: 'manual'`，**3xx 一律拒绝**（`处理端点重定向已拒绝，请配置最终端点`）；错误响应体里的 `authorization` / `x-api-key` / `x-goog-api-key` 会被替换成 `[REDACTED]`。

**排障注意：** 拒绝消息是固定文案，**不含被拒绝的 URL**，第一次配白名单需要对照日志推断命中点。

### 4.1 「测试 / 拉取」按钮的前置条件（容易踩）

`server/src/routes/ai.ts` 的 `preHandler`：`/ai/chat`、`/ai/request-json` 要求项目作用域；`/ai/list-models`、`/ai/test-image-model` 要求管理员。

而 `/ai/*` 的项目作用域来自 **`X-Project-Id` 请求头**（`stampProjectId` → `getProjectIdHeader`）。客户端由 `client/src/shared/api/http.ts:44` 从「当前活跃项目」注入。**没有活跃项目时**，服务端回落为 `{kind:'administration'}`，`processing-authorizer.ts` 对该域的 `allowExternal` 恒为 `false`。

> 因此设置页的「测试」和「拉取」要成功，四个条件同时成立：
> 1. 用**管理员**账号；
> 2. 页面已**选中一个项目**（有 `X-Project-Id`）；
> 3. 该项目 `allowExternalProcessing = true`；
> 4. 目标 host 在 `YIBIAO_EXTERNAL_ENDPOINTS`（或为 internal 名单）。

---

## 5. 可抄的配置

### 5.1 商业文本模型（DeepSeek 官方）

```bash
YIBIAO_EXTERNAL_ENDPOINTS=https://api.deepseek.com
```

设置页 → 文本模型 → 服务商 `DeepSeek` → 填 API Key → 模型名称点「拉取」选 `deepseek-chat` → 点「测试」→ 保存。项目设置 → 允许外部处理 = 开。

### 5.2 商业文本模型（中转站 / 其他厂商）

```bash
YIBIAO_EXTERNAL_ENDPOINTS=https://<中转站域名>
```

设置页 → 文本模型 → 服务商 **`自定义`** → Base URL = `https://<中转站域名>/v1` → API Key → 模型名称（手填，custom 无默认值）→ 测试 → 保存。

### 5.3 MinerU 官方 API（mineru.net）

```bash
YIBIAO_EXTERNAL_ENDPOINTS=https://mineru.net,<上传host>,<轮询host>,<下载host>
```

设置页 → 文件解析 → `MinerU 精准解析 API` → 服务地址 `https://mineru.net` → 填 Token。

**四个 host 都要覆盖**：`parseWithMineru` 先调创建接口拿到 `file_urls` / `full_zip_url` / `markdown_url`，这些预签名地址常落在 OSS / CDN 域名上，漏一个即 fail-closed 失败（见 [EXTERNAL-ACCEPTANCE.md](EXTERNAL-ACCEPTANCE.md) 的 P2-05 条目）。**不要**为绕过去改成跟随重定向。

### 5.4 完全隔离（默认，不出网）

```bash
YIBIAO_INTERNAL_ENDPOINTS=
YIBIAO_EXTERNAL_ENDPOINTS=
```

此时本地解析、登录、资料维护、导出仍可用；模型/MinerU 相关功能显式降级报错。

---

## 6. 部署前检查清单

### 6.1 环境与证书

- [ ] PVE VM 规格与磁盘按计划第 8 节实测调整；数据盘独立
- [ ] 独立磁盘/远端挂载的**备份目标**（不是同 VM 另一目录）
- [ ] 证书 `fullchain.pem` / `privkey.pem` 就位，续期归属已记录
- [ ] DNS 指向该 VM；只开放 443

### 6.2 构建与启动

- [ ] 部署对象从 `main` 构建（2026-09-11 起 `main` 已含 `d17b76e` 的 P2-01～P2-07 修订；不再需要分支）
- [ ] `POSTGRES_PASSWORD` URL-safe 随机；`JWT_SECRET` ≥32 位随机；二者不写入仓库
- [ ] `docker compose config --quiet` 通过
- [ ] `docker compose up -d --wait` 后 `docker compose ps` 全 healthy
- [ ] 确认启动顺序：postgres 健康 → migrate 成功退出 → app 健康 → nginx
- [ ] 确认无宿主端口暴露（除 443）、app 非 root 且根只读
- [ ] 首登 `admin/admin` 强制改 ≥12 位含大小写/数字/特殊字符的密码

### 6.3 功能与端点

- [ ] 按第 5 节写入 `YIBIAO_EXTERNAL_ENDPOINTS`（或 internal）并重建 app 使环境变量生效
- [ ] 项目设置打开「允许外部处理」；含共享资料的项目另行确认共享域开关
- [ ] 用**管理员 + 已选中项目**跑「拉取」与「测试」
- [ ] MinerU：先给管理员配好 Token，再选 `精准解析 API`、填服务地址，用一份合成 PDF 走通上传→解析
- [ ] 记录限额现状：100 MiB/文件、≤10 文件、≤200 MiB/批；解析/导出并发各 1、等待上限 24

### 6.4 证据与合规

- [ ] 记录源 commit、镜像 digest、migration 版本、数据目录格式版本、启用/禁用功能
- [ ] `VITE_SOURCE_REPOSITORY_URL` 指向**正在运行的修改版**源码入口；`BUILD_COMMIT` 与实际构建一致
- [ ] 备份演练：同批 DB + `/data`，恢复到另一空环境核对 hash 并重新导出一份 Word，记实际耗时
- [ ] 明确内部测试期内哪些功能处于降级（模型未批 / 扫描件 OCR 不可用 / 目录 V2 人工阶段）

### 6.5 本地验证命令（计划第 11.2 节）

```bash
# server/
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm run typecheck
pnpm run build
pnpm test

# client/
npm ci
npm run typecheck
npm run build
npm test

# 真实数据库集成测试（仅本机 yibiao_test* 库）
TEST_DATABASE_URL=postgresql://... pnpm test:integration
```

`d17b76e` 的作者报告本轮实跑结果为：服务端 162/162 单元测试通过、15/15 集成测试通过（临时 `postgres:16`）、服务端与客户端 typecheck 通过；未重跑 Docker 与浏览器。以 [CODE-REVIEW-2026-09-09-FIXES.md](CODE-REVIEW-2026-09-09-FIXES.md) 为准。

---

## 7. 待办与残留项

审查的 P1/P2 已按 `d17b76e` 处置完毕。**以下为仍未处理的项**，均不阻断内部测试：

| ID | 类型 | 说明 | 建议 |
| --- | --- | --- | --- |
| UX-01 | 权限/UX | 文本模型的 **Base URL / API Key / 模型名对非管理员没有 `disabled`**（MinerU 服务地址有）。非管理员可填、可保存、看到「配置已保存」，但 `USER_FIELD_WHITELIST` 会把 profiles 静默丢弃（`SettingsPage.tsx:1568-1605` 的 API Key / 模型名控件无 disabled；`server/src/config/store.ts:186`） | 与 MinerU 一致地 `disabled={!isAdmin}`，或明确提示「仅管理员可配置」 |
| OBS-01 | 可诊断性 | `ProcessingDeniedError` 文案固定，**不含被拒 URL**，首次配白名单只能靠猜 | 把被拒 origin 记入日志或错误详情 |
| OBS-02 | 可诊断性 | P2-06 的折回提示走 `result.message`，但 `saveClientConfig`（`SettingsPage.tsx:726-740`）在成功分支固定显示「配置已保存」并丢弃 `message`；影响有限（UI 已禁用该选项），API 直连场景看不到提示 | 成功分支在有 `message` 时优先显示 `result.message` |
| P2-03 | 设计取舍 | 行锁仍用 `Prisma.raw`（`FOR SHARE` 无法用 Prisma 查询 API 表达），已收拢为闭集映射并加注释 | 保持现状；若要彻底去掉 raw SQL 需改锁策略 |
| INFRA | 运维 | 备份演练只在开发机完成，未在 PVE 目标环境演练 | 内部测试期内补一次 N4 演练并记录实际 RPO/RTO |

**不要做：** 不要为让 STATUS 变绿接入未批准公网端点；不要打开 OpenCode；不要 `--scale app=2` / PM2 cluster；不要人工清理 `references/`、`source/parse`、已发布图片目录。

---

## 8. 本记录的边界与声明

- 本记录的部署设置部分（第 2–6 节）来自对 `d17b76e` 的源码与配置读取；**本次未执行** `docker compose build/up`、未跑 `pnpm test` / `npm test`、未做浏览器验证。
- 第 6.5 节的实跑结果与第 1.1 节的修订结论引自 [CODE-REVIEW-2026-09-09-FIXES.md](CODE-REVIEW-2026-09-09-FIXES.md) 与提交 `d17b76e`，**非本记录作者执行**。
- 文件行号对应 `d17b76e`，后续改动需重新核对。
- 未复验项：镜像 digest、备份路径、证书。
- 本记录不改变 STATUS.md 的 DONE/BLOCKED，不构成生产发布依据。
