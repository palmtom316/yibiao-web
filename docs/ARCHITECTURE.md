# Web 架构

本文描述当前改造分支的实现；验收状态见 [STATUS](implementation/STATUS.md)，产品约束见 [审核计划](TRANSFORMATION-PLAN.md)。尚未生产发布。

## 1. 组件

- `client/`：React 19 + Vite 7，只负责 UI、请求编排和 SSE 展示。
- `server/`：Fastify 5 权威后端，负责鉴权、权限、文档解析、AI 请求、后台任务、导出和存储。
- `server/prisma/schema.prisma`：PostgreSQL schema 单一真相。
- Nginx：托管前端静态文件并反向代理 `/api` 和 SSE。
- Docker Compose：单实例 app、一次性 migrate、nginx、PostgreSQL 16；非 root app 使用本地 tsx 运行源码。
- PM2 保留为备选，必须单实例 fork，不能 cluster。

## 2. 请求与数据边界

```text
Browser
  ├─ /             → Nginx → client/dist
  └─ /api + SSE    → Nginx → Fastify → Prisma → PostgreSQL
```

客户端不保存 API Key，不解析或导出权威文档。所有跨网络参数均由服务端重新校验。

## 3. 鉴权与权限

- JWT 分为两种用途：`purpose=access` 的正式会话令牌有效期为 7 天，用于常规受保护接口；`purpose=initial-password-change` 的受限令牌有效期为 10 分钟，只能用于首次改密接口，不能访问业务接口。为兼容升级，旧正式令牌未携带 `purpose` 时仍按正式会话处理。
- `mustChangePassword` 是用户的首次改密状态：全新安装时创建的默认管理员为 `true`，首次改密成功后原子更新为 `false`；已有用户和普通注册用户默认为 `false`。状态为 `true` 时不会签发正式会话令牌。
- 用户角色为 `admin` 或 `user`。
- 普通用户通过模块列表获得功能权限。服务端可授予模块白名单为 `template-settings`、`knowledge-base`、`bid-check`、`docs`、`faq`。
- 默认开放模块为仪表盘、标书生成和设置；用户管理与提示词管理仅管理员可用。
- 用户管理与提示词写操作仅管理员可用。
- 项目作用域 API 使用 `X-Project-Id`，服务端校验项目归属。
- 权限在服务端每次请求时生效，前端通过 `/api/me` 定时刷新菜单。

## 4. 模块边界

- 标书生成：技术方案、已有方案扩写、商务响应清单、响应与偏离表工作台。
- 格式管理：我的模板、新建模板、导出格式和共享模板。
- 知识库：方案模板库、工具模板库、公司资质库、人员资质库及业绩档案。
- 标书检查：标书查重和废标项检查。
- 使用文档与 FAQ：数据库文章、Markdown 渲染、管理员编辑和用户反馈。
- 管理模块：用户管理、提示词管理、基本设置。

商务响应使用独立要求/候选/人工结论/引用版本，技术目录只处理技术项。清单 Word 与原件 ZIP 不承担最终评分计算。

## 5. 数据范围

- 用户域：用户、个人设置、平台配置、提示词、FAQ、导出模板、使用文档文章。
- 项目域：技术方案、已有方案扩写、响应与偏离表、标书查重、废标检查及后台任务。
- 公司共享域：知识库、工具资产、公司资质和人员资质。
- 大文件落在服务端运行数据目录，数据库只保存路径和结构化元数据。

## 6. 主题、品牌与开源归属

- 初始系统名称来自服务端默认配置：`易标投标工具箱web版`。
- 登录页、顶栏和导出元数据使用系统设置中的名称和 Logo；管理员可在“设置 - 基本设置”中修改。
- 客户端通过 `ThemeProvider` 管理主题，主题值为 `light` 或 `soc-dark`，存储键为 `yibiao_ui_theme`。
- `soc-dark` 主题通过 `html[data-theme='soc-dark']` 作用域覆盖历史浅色样式，尽量不改动各业务组件的结构。
- Markdown 文档和 Mermaid 预览会读取当前主题，保证使用文档在深色模式下可读。
- 开源说明组件在登录页和应用界面展示当前修改版源码、原始项目、AGPL、NOTICE 和作者归属。部署方可通过 `VITE_SOURCE_REPOSITORY_URL` 指向正在运行版本对应源码。

## 7. 使用文档种子

- 静态 Markdown 原稿位于 `server/prisma/seed-docs/`。
- 前端 `client/public/docs/` 保留同名静态文档和图片资源，便于 Markdown 图片路径稳定访问。
- 数据库文章由 `server/prisma/seed-docs.ts` 写入 `docs_articles`。
- seed 按固定 ID 只创建缺失文章，保留管理员正文、标题与排序。内容升级使用单独版本化命令，先报告后按旧版本 hash 更新。

## 8. AI 与通用模型互通

AI 配置与真实密钥只存在服务端，浏览器端不保存 API Key。文本模型、生图模型和 Agent 运行时通过服务端配置读取服务商、模型名称、Base URL 和密钥，再由后端或本地 AI Proxy 发起调用。

部署方可以按安全策略选择三种互通方式：

1. 批准的外部服务：必须同时列入部署端点白名单、获得项目/共享域许可；默认拒绝，缺少数据域上下文也拒绝。
2. 连接企业统一模型网关：通过内网或受控出口访问 OpenAI-compatible 网关，便于做审计、限流、密钥轮换和模型统一管理。
3. 连接本地或私有化模型服务：将 Base URL 指向内网推理服务，数据流转范围更可控，但需要自行保障模型能力、上下文长度和并发性能。

服务端的 AI Proxy 会把平台配置转换为运行时可用的模型请求，避免各业务模块直接持有密钥。日志和诊断输出只应包含服务商、模型名、Base URL 连通性和错误摘要，不应输出完整 API Key。

## 9. Web 运行边界

Web 版以浏览器、HTTP API、SSE 进度推送、PostgreSQL 和服务端运行数据目录为边界。前端所有业务能力都应通过 `/api` 调用服务端，不直接读写数据库、文件系统或模型密钥。

运行时数据边界：

- 数据库保存结构化业务数据、权限、配置、文档文章和任务元数据；
- 上传文件、导出结果、文档解析中间文件保存到服务端运行数据目录；
- `.env`、数据库备份、上传目录、日志和客户文件由部署环境管理，不进入源码仓库；
- Nginx 只暴露前端静态资源、`/api` 和必要的 SSE 路由，数据库与后端内部端口不应直接暴露到公网。


## 10. 原件、引用和资源边界

DocumentSource 保存原件身份与 hash；DocumentParseVersion 保存独立解析清单；DocumentAsset 绑定项目、知识文档或项目引用。文件只存相对路径，浏览器读取授权 ID；不接受客户端 base_dir、绝对路径、file URI、越界符号链接或任意远程图片。

PerformanceRecord 与公司原件、知识文档/条目、人员岗位使用真实关联表和外键。金额 API 使用十进制字符串。证照时间按 Asia/Shanghai 业务日，截止日期当日仍有效。

确认引用先建立 staging ProjectReferenceSnapshot，复制并核对原件/叙述图片，再锁定来源版本、校验权限并置 ready；失败标 error 且不发布半成品。快照来源 ID 是溯源值，不随源删除级联消失；复制出的图片绑定快照自己的资产 ID。ReferenceRevocation 独立保留撤销记录，新的导出读取历史快照时仍检查撤销。

BusinessResponseRevision 固定要求和人工结论；BusinessPackage 在服务器流式打 ZIP，包含 Word、原件及 hash 清单。正文引用块采用确定性渲染，manualLocked 阻止重新生成覆盖人工章节。

## 11. 后台工作与可选组件

任务与事件依赖单进程。长解析/出包使用持久 BackgroundJob；解析、导出、Chromium 渲染各有有界队列。进程重启恢复任务状态，不声称所有模型调用都能续跑。

目录 V2 重用固定上游纯算法/提示词，在 Web 端逐阶段 await PostgreSQL 检查点。Pi 持久工作区标识包含项目 ID 和运行 UUID，用户回答经项目权限校验。允许普通生成回退，`YIBIAO_OUTLINE_V2=false` 关闭 V2。模板扫描/字段确认使用独立作业，不把商务模板章节注入技术目录。

增强镜像 self-contained .NET 10 helper 按 workspace + JSON 协议运行。Chromium 禁下载、外部网络和服务工作线程，模型 HTML 脚本禁用；仅运行受控 Mermaid 与 DOM 布局检查脚本。配图保存 HTML 图源、尝试次数和质检结果，随后发布项目图片资产；失败可以重试。

ProcessingScope 通过 AsyncLocalStorage 及任务绑定配置传递，重试/排队保持各自作用域。读取共享知识会给当前项目任务标记 includesSharedData；外发必须同时满足项目和共享策略，撤销模块权限在下次请求即生效。
