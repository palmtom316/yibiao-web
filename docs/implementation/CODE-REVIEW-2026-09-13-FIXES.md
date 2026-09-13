# 2026-09-13 PVE 单人测试准备修订记录（R01–R12 / O01–O12）

对应主报告：`CODE-REVIEW-2026-09-13-PVE-SOLO.md`
执行任务书：`REMEDIATION-TASK-2026-09-13.md`
修订分支：`fix/pve-solo-review-20260913`
代码基线：`5a926ae`（审核）→ `c1bfe9f`（任务书）→ 本记录提交
证据目录：`evidence/remediation-2026-09-13/`（含 `manifest.sha256`）

> 本文件是**修订记录**，只写已经落地并有证据的内容。未实施、未验证、只做了部分的内容单独标为「延期」或「未验证」，不并入已完成。

---

## 一、结果摘要

| 项目 | 基线 | 本轮 |
| --- | --- | --- |
| server 单元测试 | 165 | **185** |
| PostgreSQL 16 集成测试 | 15 | **17** |
| client 单元测试 | 28 | **30** |
| 合计 | 208 | **232**（失败 0） |
| server `pnpm audit --prod` 告警 | 36 | **6**（high 5 / moderate 1，全部为无修复版本的残留项） |
| client `npm audit --omit=dev` | — | **0** |
| 入口 JS / gzip | 1,161 kB / 356 kB | 1,163.97 kB / 356.76 kB |
| CSS / gzip | 363 kB / 55 kB | 363.42 kB / 55.05 kB |

工具链：Node 22.23.2、npm 10.9.3、pnpm 10.17.1、PostgreSQL 16（独立测试实例，库名前缀 `yibiao_test_*`）。

提交切分：

| 提交 | 内容 |
| --- | --- |
| `d5320f5` | R01、R02 统一处理出口 |
| `76609c6` | R05、R06 来源一致性与导入发布 |
| `deaa2b5` | R07 错误落库与终端处理 |
| `b275ced` | R11 取消传递 |
| `75e21ba` | R08 查重有界解析 |
| `3f53236` | R12 依赖整改与解析隔离 |
| `641a01e` | R03、R04、R09、R10 |
| `89890bd` | O02/O07/O08/O09/O11 + 图片样本修复 + O10 字段权限 |

---

## 二、R01–R12 处置

### R01 Agent 自检绕过处理出口（P1）— 已修复

- **根因确认**：`piSelfCheck.ts` 的三个探针（文本、流式、工具）直接调用全局 `fetch`，绕过 `processingFetch`；`routes/agent.ts` 把自检包在 `administration` 作用域里，但没有项目校验，外部端点因此可在无项目授权时发出。
- **修复**：三个探针全部改走 `processingFetch`（受控出口：白名单 + 数据域 + 密钥脱敏）；`routes/agent.ts` 改为「有 `X-Project-Id` 先 `createRequireProject` 验证并传递项目作用域，否则回退 `administration`（仅内部端点可用）」；`preHandler` 在 `reply.sent` 后立即返回，避免继续执行路由体。
- **测试**：`server/src/security/processing-probe.test.ts`（真实路由 + 被拦截的网络发送）——空白名单发送为 0；批准的内部端点在管理权限下可调用；外部端点在无项目/未开外部处理时拒绝；权限拒绝不重试；拒绝响应体不含密钥。
- **证据**：`post-server-unit.tap`；提交 `d5320f5`。

### R02 模型列表与生图测试作用域错误（P2）— 已修复

- **根因确认**：`/ai/list-models`、`/ai/test-image-model` 只用 SSE 项目戳，没有真实处理作用域；`listModelsWithConfig` 在捕获异常时无条件 `retryable: true`，把权限拒绝也标成可重试。
- **修复**：两个路由要求管理员 + 已验证项目作用域；`ai/service.ts` 与 `ai/retry.ts` 增加 `markRetryableUnlessDenied` / `isRetryableAiRequestError`（`retryable === false` 直接判定不可重试），权限拒绝立即返回、不重试；设置页提示与部署文档同步说明「拉取/测试走当前项目处理出口」。
- **测试**：同 `processing-probe.test.ts`（无项目 400、无权限 403、未开外部处理 403、普通用户 403，发送均为 0；文本聊天/模型列表/生图测试回归）。
- **证据**：`post-server-unit.tap`；提交 `d5320f5`。

### R03 SSE 正常 EOF 后不重连（P2）— 已修复（浏览器级未验证）

- **根因确认**：`sse.ts` 只处理 `onerror`；服务端正常结束流（重启/代理）只触发 `onclose`，前端不再重连也不刷新快照；`ProjectContext` 把「偏好未加载完」当成「无项目」，会先落到列表首项。
- **修复**：抽出 `ssePolicy.ts`（致命状态判定、EOF 重连判定、退避时长）供单测；`sse.ts` 在正常 EOF 后按退避重连并刷新当前项目快照；400/401/403/404 视为致命不重试；无活跃项目不建连；用世代号保证旧连接回调不能改写新连接状态。
- **测试**：`client/src/shared/api/ssePolicy.test.ts`、`client/src/app/resolveActiveProject.test.ts`。
- **未验证**：未在真实浏览器 + 真实服务端完成「重启后自动恢复」的端到端验证（记为未验证项）。

### R04 唯一管理员可自降权（P2）— 已修复

- **根因确认**：`routes/users.ts` 的角色变更/停用/删除只校验「不能停用自己」，没有「至少保留一个可用管理员」的约束，也没有并发保护。
- **修复**：在事务内先 `SELECT id FROM users WHERE role='admin' AND status='active' FOR UPDATE`，再统计剩余可用管理员；会导致数量归零的改角色/停用/删除一律 409。首次改密流程保留，未用重复 seed 作为修复手段。
- **测试**：`server/src/routes/users.last-admin.test.ts`（含并发路径的假事务客户端）。
- **证据**：`post-server-unit.tap`；提交 `641a01e`。

### R05 过期偏离表仍能确认和导出（P1）— 已修复

- **根因确认**：确认与导出只信任前端先调用的 availability；`store.ts` 没有在写操作前重新核对当前招标来源 hash/标段/提取版本。
- **修复**：`response-deviation/store.ts` 增加 `markStaleIfSourceChanged` 与 `assertFreshSource`；确认与正式导出前强制复核，来源失效时保持过期状态并返回 409；显式 stale 不能被直接改回 confirmed；导出与确认共用同一校验。
- **测试**：`server/src/routes/response-deviation.stale.test.ts`（确认 A 后替换为 B，不调用 availability 直接确认/导出均拒绝）。
- **证据**：`post-server-unit.tap`；提交 `76609c6`。

### R06 导入时文件与数据库失配（P1）— 已修复（故障注入未全覆盖）

- **根因确认**：导入直接写最终路径并逐条落库，任一步失败会留下「文件已换、引用未换」或反之的失配状态。
- **修复**：改为 staging 发布——新解析结果先写入独立 staging 目录与版本，完整校验后再由数据库切换当前引用；切换前旧成功版本保持有效；提供孤立 staging 清理；导入/清空/切标段与后台任务保持互斥或版本检查。
- **测试**：`server/src/technical-plan/import-publish.test.ts`（含失败回滚与幂等重试、并发导入不混合发布）。
- **未验证**：未在「写文件前 / 写文件后 / 数据库提交前」三个阶段逐一注入崩溃并重启服务验证（记为未验证项）。

### R07 错误落库失败造成未处理拒绝（P1）— 已修复

- **根因确认**：`tasks/service.ts` 的 runner 失败路径里，「写错误状态」自身失败会再抛，形成未处理的 Promise 拒绝；`finally` 清理不完整。
- **修复**：区分 runner 失败与持久化失败；所有异步链有终端 `catch`；`finally` 清理活动任务、控制器与队列作用域；持久化失败不会被标成成功；记录脱敏诊断。
- **测试**：`server/src/tasks/error-persistence.test.ts`——在**子进程**中运行（不使用测试框架的全局 unhandledRejection 兜底），验证默认 Node 22 行为下无未处理拒绝、其他请求不受影响、活动任务与队列可释放。
- **证据**：`post-server-unit.tap`；提交 `deaa2b5`。

### R08 查重绕过有界解析（P1）— 已修复（RSS 未实测）

- **根因确认**：查重在任务进程内直接 `convertPathToMarkdown(mapWithImages=true)`，把图片编码进 base64 正文，既不受 `parseQueue` 并发预算约束，也不受 worker 内存与输出上限约束。
- **修复**：新增 `server/src/document/bounded-parse.ts`（`parseFileInBoundedWorker` / `…Unqueued`），查重正文与图片提取改走有界 worker 并与文档解析共享 `parseQueue` 槽位；图片以文件落盘、正文改引用相对路径，去掉 base64 放大；元数据提取同样入队；服务端校验整个分析文件集合（数量、体积、存在性）与单文件限制。
- **测试**：`server/src/document/bounded-parse.test.ts`（唯一解析槽位被占用时查重排队且不产出、释放后完成）。
- **未验证**：未实测 V8 堆外的原生库/子进程 RSS 峰值（只验证了并发预算与排队行为）。

### R09 活跃项目偏好未读回（P2）— 已修复

- **根因确认**：`UserConfig.data.activeProjectId` 只写不读；前端在项目列表返回后立刻选定首项，与偏好加载存在竞态。
- **修复**：`GET /config` 在安全 DTO 中返回 `activeProjectId`（仍校验访问权）；前端抽出 `resolveActiveProject.ts`，等「项目列表 + 偏好」两者都加载完再决定，配置请求失败时不当作「无项目」；项目删除/撤权/切账号同步回退。
- **测试**：`client/src/app/resolveActiveProject.test.ts`（两种加载完成顺序结果一致、网络失败不误判）、`server/src/routes/config.security.test.ts`（白名单与偏好读回）。
- **证据**：`post-client-unit.tap` / `post-server-unit.tap`；提交 `641a01e`。

### R10 诊断项目编号筛选字段错误（P2）— 已修复

- **根因确认**：筛选用的是 `Project.id` 而不是 `Project.projectCode`，且查询参数与 Fastify decoration 使用宽泛 any。
- **修复**：查询改为按 `projectCode`（大小写不敏感包含）解析为项目 id；分页/日期/过滤参数显式校验（`page ≥ 1`、`1 ≤ pageSize ≤ 100`、非法日期 400）；路由查询参数、Prisma 入参与 DTO 补准确类型；无匹配编号直接返回空集，不发起无效查询。
- **测试**：`server/src/ai-diagnostics/routes.test.ts`（单元）与 `server/src/ai-diagnostics/routes.integration.test.ts`（**真实 PostgreSQL 16**：命中、无匹配、普通用户 403）。
- **证据**：`post-server-unit.tap` / `post-server-integration.tap`；提交 `641a01e`。

### R11 取消没有传递到实际工作（P2）— 已修复（远端撤回不可能）

- **根因确认**：`jobs/service.ts` 的 `cancel` 立即把状态写成 `cancelled` 并只 abort 控制器；runner 收到的 signal 未传到解析子进程、资源队列、知识抽取与模板任务；取消后仍会启动抽取。
- **修复**：引入 `cancelling` 中间态——仍在停止的工作显示取消中，runner 真正退出后才落终态；终态写入使用带状态条件的 `updateMany`，取消与成功/失败竞态不互相覆盖；`AbortSignal` 贯穿 `parseQueue`、bounded worker（含子进程 kill）、知识准备/抽取、模板抽取与字段应用；取消后不再启动知识模型抽取；旧成功版本保留。
- **测试**：`server/src/jobs/cancel.test.ts`（执行中取消 → 取消中 → 已取消；成功后取消不回退；排队中取消不启动 runner）。
- **限制说明**：**已发送到外部服务的请求无法远端撤回**，只保证本地不再继续排队、解析或启动后续请求，不承诺撤回已发送数据。

### R12 服务端运行依赖告警（P1）— 部分关闭，残留已登记

见 `DEPENDENCY-AUDIT-2026-09-13.md`（含逐包锁定版本、公告、可达路径、处置方式与 Node 22 兼容性）。要点：

- 已定向升级：`pdfjs-dist` 6.2.108、`sharp` 0.35.4、`adm-zip` 0.6.0、`fastify` 5.12.4、`ajv` 8.18.0；`pnpm.overrides`：`@xmldom/xmldom` 0.8.15、`fast-uri`（3.1.6 / 4.1.4 两条线）、`undici@^8` → 8.9.0。
- PDF 解析关闭脚本求值（`enableScripting: false`、`isEvalSupported: false`）。
- `image-size` 仅对 PNG/JPEG/GIF/WebP 魔数放行，ICNS/JXL/HEIF 直接拒绝（该库无修复版本）。
- `xlsx`、`pdfjs-dist`、`adm-zip`、`sharp` 只在**有界子进程 worker** 中处理外部文档，主进程不再导入；`xlsx` 无 npm 修复版本，靠进程隔离 + 输出/解压上限限制影响面。
- **行为变化（需知悉）**：libvips 8.18（sharp 0.35.4）对 PNG chunk CRC 是硬校验。此前被旧解码器静默接受的**损坏 PNG** 现在会被拒绝并产生显式告警（文档仍可解析，仅该图片不产出资源）。已修正仓库内三个使用损坏样本的测试夹具（`server/src/test/png.ts`），真实 Office 文件的 PNG 带正确 CRC，不受影响。
- **未验证**：未构建 Linux 目标镜像复核原生模块与 Node 22 兼容性；未运行两端之外的 OS/Chromium/.NET 检查。

---

## 三、O01–O12 对照表

| 编号 | 本轮处置 | 依据 / 证据 | 备注 |
| --- | --- | --- | --- |
| O01 优先修复缺陷 | **完成** | 本文件第二节 | R01–R12 逐项核实，未以优化替代修复 |
| O02 集成测试进 CI | **完成** | `.github/workflows/verify.yml`：postgres:16 service + `prisma migrate deploy` + `pnpm run test:integration`；`post-compose-config.json` | CI 尚未在 GitHub 上真实跑过一次（未推送）；测试库名限制由 `scripts/test.mjs` 强制 |
| O03 API schema 与核心类型 | **部分** | R10 诊断路由/Prisma 入参/DTO 已补准确类型；Fastify decoration 收窄 | 其余入口的 schema 化列为后续清单，本轮不做无边界全仓类型重写 |
| O04 长请求与取消统一 | **部分** | 取消按 R11 落地（jobs/队列/worker/抽取） | AI/Word 全面作业化：兼容成本高、本轮无证据表明必需，延期；重启条件＝出现「长请求超时且无法取消」的真实故障 |
| O05 分页、聚合与返回体 | **部分** | 诊断列表分页/上限校验（R10）；`post-server-integration.tap` 覆盖知识检索 0/100/101/235 规模 | 未系统记录全部关键请求的响应体积与数据规模；后续触发条件＝单人测试中出现可复现的响应过大或查询放大 |
| O06 前端按页面加载 | **部分（延期实施）** | 构建体积前后对比：JS 1,161→1,163.97 kB、CSS 363→363.42 kB；Mermaid 已按图表分块（61 个 JS 分块） | 编辑器/检查/管理页面的 `React.lazy` 延期；重启条件＝首屏交互明显受入口包影响，或页面数量继续增加。未提高任何告警阈值 |
| O07 日期与更新契约 | **完成** | 业绩日期跨字段校验改为「提交补丁 + 库中现值」合并（`server/src/performance/store.ts`）；`performance.integration.test.ts` | 多标签页版本控制随 R05/R06/R09 的版本校验保持一致 |
| O08 诊断、日志、存储生命周期 | **完成** | 诊断保留 7 天，服务内 1 小时节流 + `index.ts` 每小时定时清理（unref，shutdown 清除）；compose 全部服务加 `json-file` 轮转（10MB × 5） | 清理失败被 `safe()` 包裹、不删除有效原件；保留期与失败行为见本表与部署文档 |
| O09 账号与浏览器会话加固 | **部分** | QueryClient 单例 + 登出清缓存（跨账号隔离）；启动拒绝示例/占位 `JWT_SECRET`（`jwtSecret.test.ts`） | **未实现**：登录限流、密码重置后撤销旧 access token。门槛：对外开放或多账号试用前必须完成；单人内网阶段以网络来源限制替代 |
| O10 错误和配置反馈 | **完成** | 模型拉取/测试提示与真实契约对齐；无权限的模型字段与探测按钮对非管理员禁用并标注「仅管理员可修改」；错误响应保留服务端 message；拒绝路径不输出密钥（处理出口只在请求体内做 `[REDACTED]` 替换，不记录带签名 query） | 未新增 origin 日志：当前拒绝不产生包含 origin 的日志，属「未记录」而非「已脱敏记录」 |
| O11 删除生命周期与备份运维 | **完成（部署部分责任到人）** | 项目删除前检查排队/运行/取消中的后台作业并 409；备份预检 Python ≥3.11、目标盘空间（数据×2.2，`--save-images` 另加 2 GiB）、失败阶段报告，预检结果写入 manifest | 备份调度、保留策略与异地存储属部署责任，见 `docs/DEPLOYMENT.md` |
| O12 大文件拆分与旧注释 | **部分** | 本轮触及处的过时注释已更正（如 `parser.ts` 的解析路径说明） | 全面拆分与兼容运行时裁剪延期；重启条件＝出现明确的可维护性问题，不为拆分而拆分 |

---

## 四、约束遵守说明

- 未通过吞异常、伪造 success、无限重试、放宽白名单、关闭权限校验或单纯提高超时/资源上限来掩盖缺陷。
- 服务端鉴权、当前账号状态、项目归属、模块权限、首次改密规则保持有效；API Key 不进入浏览器响应、日志或提交。
- 原件、成功解析版本、引用快照、撤销记录与人工锁定正文保持可追溯；失败与取消不删除或覆盖旧成功结果。
- 单 Node 进程、单实例约束、Pi 受控工具边界与 OpenCode 禁用状态均未改动。
- 数据库未做不可回退的 schema 变更；本轮无新增 migration（`migrate deploy` 在 CI 与集成测试中重复验证）。
- 旧脚本证据（`evidence/review-2026-09-13/`）未被修改；新用例写在常规测试目录，旧脚本不再复现属预期。

---

## 五、遗留与后续

**未验证项**（不视为已通过）：Linux 目标镜像构建与原生模块/Node 22 兼容性；真实 AI/OCR 服务调用；`deploy/backup/backup.py` 的完整 docker 备份执行；浏览器级 SSE 重连；R06 三阶段崩溃注入；R08 原生库 RSS 峰值。

**必须在对外开放或多账号试用前完成**：O09 的登录限流与密码重置撤销旧令牌。

**部署责任**（见 `docs/DEPLOYMENT.md`）：备份调度与保留、异地存储、TLS 证书、`.env` 凭据强度、日志轮转参数调整。
