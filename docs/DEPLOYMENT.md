# 部署、迁移与恢复

实际验收见 [STATUS](implementation/STATUS.md)。P0 全部验收后才是可部署基础版；开发环境 Docker 启动不等于生产发布。第一期单公司、多人各自管理项目，app 必须单实例、单 Node 进程。

## Docker Compose

建议 PVE 内 Ubuntu/Debian VM。5 人试配起点为 4 vCPU、8 GB、80 GB 数据盘；根据解析页数、等待、RSS 与磁盘增长实测容量。固定 Node 22.23.2、npm 10.9.3、pnpm 10.17.1、PostgreSQL 16。基础镜像摘要写在 Dockerfile/Compose，运行目标带 tsx、Prisma Client、原生模块、LibreOffice 和中文字体；nginx 目标单独包含构建后的前端。

1. 根 `.env.example` 复制为 `.env`，设置 URL-safe 随机 POSTGRES_PASSWORD、至少 32 位随机 JWT_SECRET。
2. TLS_CERT_DIR 指向证书目录，包含 fullchain.pem/privkey.pem。部署管理员负责可信证书及续期，续期后 `docker compose exec nginx nginx -s reload`。只有 443 对外，证书可采用 DNS 验证。
3. YIBIAO_PUBLIC_ORIGIN 为实际 HTTPS 站点。YIBIAO_INTERNAL_ENDPOINTS 填已批准的内部模型/企业网关 base URL，逗号分隔；空列表拒绝出网。YIBIAO_EXTERNAL_ENDPOINTS 还要求对应项目/共享域授权。公网图片与远程 Mermaid 不会作为自动回落路径。
4. VITE_SOURCE_REPOSITORY_URL 指向当前修改版的可访问源码，BUILD_COMMIT 记录实际构建版本。前端变量为构建参数，修改后重建 nginx，不能只改 app 环境。

```bash
docker compose config --quiet
docker compose build
docker compose up -d --wait
docker compose ps
```

启动顺序：PostgreSQL 健康 → migrate 成功退出 → app 健康 → nginx。DB/app 没有宿主端口；app 非 root、根目录只读，仅 /data 与临时目录可写，不挂 Docker socket。pgdata/appdata 数据卷必须一起备份。禁止 `--scale app=2`、PM2 cluster 或多进程启动。

/health/live 检查进程；/health/ready 检查数据库与数据目录，显示队列状态。nginx 不公开探针。模型未配置不阻碍管理员登录。首次 admin/admin 登录必须设置至少 12 位、含大小写/数字/特殊字符的新密码。初始化不覆盖已有密码、提示词或文档。

每文件 100 MiB、每批最多 10 文件且总计 200 MiB；客户端/Fastify 校验，nginx 为 multipart 预留 1 MiB 开销。解析/导出分别默认 1 活动任务、最多 24 等待任务。部署方按实测容量调整资源，不以模型并发限制代替本地队列。

## 迁移与文档初始化

空库使用以下命令；生产禁止 db push、migrate reset、自动接受数据丢失及回写已发布 migration。

```bash
cd server
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm run db:initialize
```

初始化先执行 `prisma migrate deploy`，成功才执行管理员、提示词、文档缺失项 seed；失败返回非零，Compose 不启动 app。

历史 db push 数据库先停止写入、备份同批 DB/文件，在副本验证恢复和 schema 一致后执行：

```bash
pnpm run db:baseline
pnpm run db:baseline --apply --backup-manifest /受保护目录/manifest.json
pnpm run db:initialize
```

首次命令只比较当前数据库与 prisma/baseline.prisma，有 drift 就拒绝。第二次要求备份 manifest 含 DB/文件 hash 以及实际完成副本核查后登记的 validatedOnCopy=true；只标记 202609080001_baseline 已应用，再由 deploy 应用兼容增量迁移。

文档 seed 只补缺失 ID，保留已有标题、正文、排序。内容升级先查看版本化差异报告，只有与已登记旧版本相同且无管理员修改的正文才可更新：

```bash
pnpm run db:docs:update --version 2026-09-08
pnpm run db:docs:update --version 2026-09-08 --apply
```

## 任务与故障

关页不取消后台任务；SSE 重连主动取项目权威快照，不依赖事件历史重放。权限变更后旧令牌/连接不能持续读取资料。

重启将正文任务置暂停，可人工继续；其他分析/目录/事实/检查及知识抽取明确中断、可重试，不承诺所有任务自动续跑。SIGTERM 停止接新任务、关闭 SSE、请求正文暂停并停止 Agent，35 秒兜底退出；Compose 留 45 秒宽限。强制终止后在下次启动恢复状态。

## 同批备份与恢复

备份目标应为独立磁盘或远端挂载；同 VM 目录仅用于开发演练。生产建议每日备份，保留 7 日份与 4 周份，升级前另备份。目标 RPO ≤ 24 小时、RTO ≤ 2 小时，实际是否达到以演练为准。目录 0700、文件限权，配置含密钥，应由部署方加密保管。

仓库根目录运行：

```bash
python3 deploy/backup/backup.py --env-file .env --destination /独立磁盘/yibiao
```

脚本停止 nginx/app，确认进程与后台写任务结束，再生成同一 backupId 的 database.dump、data.tar.gz、受保护配置、镜像/迁移信息和 SHA-256 manifest，最后恢复原先运行服务。没有完成 manifest 的失败目录不可恢复。

保留当前环境，向另一个空环境恢复：

```bash
python3 deploy/backup/restore.py --env-file /受保护目录/restore.env --project-name yibiao-restore --backup /备份目录/backupId
```

恢复验证 hash，拒绝不安全 tar 路径、链接和非空目标库/目录。恢复后 app 保持停止，核对镜像兼容、用户/自定义文档/正文及所有原件 hash，再启动兼容镜像并重新导出 Word。数据库与文件必须来自同一 backupId。不兼容迁移须恢复整批数据；只回退应用前先证明旧镜像兼容新 schema。

## PM2 路径

Debian/Ubuntu 安装同版本 Node/包管理器、PostgreSQL、LibreOffice、中文字体，以 Nginx 提供 HTTPS。后端执行上述初始化，前端执行 npm ci/typecheck/build；按实际目录修改 deploy/pm2/ecosystem.config.example.cjs。示例固定 instances=1/fork/45 秒退出等待，使用项目内 tsx，后端仅绑定回环地址。Nginx 示例还需配置可信 TLS，SSE 保持无缓冲。

PM2 备份先 stop 并确认后台进程退出，然后备份数据库、YIBIAO_DATA_DIR 和配置；只冻结 HTTP 写请求不足以保证一致性。

## 验收与发布

开发隔离覆盖文件 deploy/test/compose.override.yml 仅绑定回环 54443，使用独立 Compose 项目名/卷和合成凭据：

```bash
docker compose -p yibiao-transform --env-file /tmp/yibiao-transform.env -f docker-compose.yml -f deploy/test/compose.override.yml config --quiet
```

真实数据库测试仅允许本机 yibiao_test* 数据库，以 TEST_DATABASE_URL 指定，运行 pnpm test:integration。完整命令见 CONTRIBUTING，未完成的真实模型/OCR/模板/恢复验收不能记作 DONE。

监测磁盘、队列、失败率、备份失败和证书到期。保留 LICENSE/NOTICE、上游归属和当前版本源码入口；不发布密钥、dump、证照、客户原文、日志或运行数据。后续新增数据布局与回退步骤记在各任务验证报告。


## 可选增强与文件格式

基础 `app` 目标仅需要 Node/LibreOffice/字体。需要 Word 模板字段和离线图表时在独立 override 中设置 app.build.target=app-enhanced 后重建 app；其 .NET 10 helper 自包含，Chromium 与字体版本随镜像固定。不要给 app 挂 Docker socket 或开启任意命令工具。`deploy/test/compose.enhanced.yml` 只示范目标覆盖。

- `YIBIAO_OUTLINE_V2=true` 默认启用可用 Pi 的 V2；设 false 并重新创建 app 回到普通目录流程。无模型配置仍能登录和维护资料。
- Agent 运行时固定 Pi（`YIBIAO_AGENT_RUNTIME` 默认 `pi`）。opencode 侧车尚未适配文件/处理边界，`YIBIAO_AGENT_RUNTIME=opencode` / `YIBIAO_OPENCODE_BIN` 会在启动时被拒绝（P2-07）；生产镜像不要预装 opencode 二进制，这不是“以后再开”的开关。
- `YIBIAO_ENABLE_LOCAL_RENDER=true`、`YIBIAO_CHROMIUM_PATH`、`YIBIAO_OPENXML_HELPER` 在增强目标内置。禁用渲染后正文/原图保留，不自动走公网服务。
- 模型、MinerU 和生图端点/密钥由管理员设置；只有已批准端点会通过请求校验。项目处理开关与共享知识策略分别维护；含共享资料的项目需要同时批准两域。
- 模板任务先抽取章节和扫描待填位置；字段建议需要模型且遵循项目出口，字段最终由人工确认。没有 Word 原件/工具时显示降级原因，不阻断普通目录。
- 配图计划每次最多 60 张，串行生成；渲染队列最多 12 等待，20 秒截图期限，最多 1600×2200 设计像素、2 倍截图。失败保留 HTML 图源与正文。

数据格式版本 1 的新增目录为 `/data/<projectId>/workspace/documents/<sourceId>/`、`references/<snapshotId>/`、`generated-images/`、`illustrations/`、`openxml/<artifactId>/`、`business-packages/`。共享原件在 `/data/shared/document-sources/<documentId>/<sourceId>/`。数据库持有相对路径/文件 ID。新迁移截至 `202609080006_snapshot_images`，仍保留旧表与旧 Markdown 可读性；更新 schema 后须重新生成 Prisma Client。

项目引用在确认时复制，后续修改/删除资料库不修改副本。归档不等于撤销引用许可；撤销通过独立记录阻止新导出。不要人工清理 references、source/parse 或已发布的图片目录。未 ready 的失败产物可以按任务重试；只清理未提交 staging，不删已确认版本。

## 可复现开发演练

所有 `deploy/test/*` 只用于独立回环测试实例。`compose.faults.yml` 的 fixture-model 是合成 HTTP 响应与故障控制器，不是真实模型，不得生产启用；端口只绑定 127.0.0.1。脚本 `server/src/verification/faults.ts` 会切换该测试实例的模型配置、启动两个合成项目、断开 SSE、SIGTERM/SIGKILL 并重建 app。必须显式 `YIBIAO_TEST_SCOPE=yibiao-transform`。

备份脚本的 manifest 包含逐文件 hash 与实际耗时；恢复脚本验证整个备份和恢复后的每个 /data 文件，输出耗时后保持 app 停止。演练结果、镜像 ID、备份 ID 和回退证据见 P0-05 验证报告。真实客户样本、企业网关/MinerU 的批准与凭据不能用合成 fixture 代替。


### 镜像保留与离线恢复补充

备份会为实际 app/migrate/nginx/postgres 镜像创建独立 `yibiao-backup:<backupId小写>-<service>` 标签，避免覆盖 latest 后失去旧版本。标签与准确 ID 写入受保护 images.json。需要离线迁移时，给 backup.py 加 `--save-images`，同时生成并校验 images.tar；本机合成归档已执行 docker load 验证。

restore.py 发现已校验 images.tar 时先加载镜像，但仍保持恢复后的 app 停止。跨主机离线恢复须先准备 override，让 postgres/migrate/app/nginx 分别使用 images.json 中的 backupTag（build 设 `!reset null`，pull_policy 设 never），避免启动时寻找另一版本的 latest 或未缓存公共标签。应用回退时同样禁止隐式重新 build/pull 替代缺失旧镜像。丢失镜像时应恢复对应源码/依赖后明确重新验收，不能把新构建冒充旧镜像。
