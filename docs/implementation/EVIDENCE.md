# 验收环境与证据

验收日期：2026-09-08～09。目标为审核计划 P0～P3。测试全在本机隔离 PostgreSQL、独立 /data 或独立 Compose 项目进行，未连接生产、未发布生产、未调用未批准外部模型。源码版本以本报告所在 Git 提交为准；生产发布门禁仍以 STATUS.md 为准。

## 工具链与检查

- Node 22.23.2、npm 10.9.3、pnpm 10.17.1；初始依赖安装、Prisma generate、两端类型检查及构建通过。
- 最后服务端单元测试 **162/162**；前端 **28/28**；真实 PostgreSQL **13/13**（包含嵌套迁移场景）。均无 skipped/cancelled。
- [服务端 TAP](evidence/yibiao-server-tests.tap)、[前端 TAP](evidence/yibiao-client-tests.tap)、[DB TAP](evidence/yibiao-integration-tests.tap)，文件校验和见 [SHA256](evidence/SHA256.json)。测试入口拒绝只收到文件级“成功”而没有单项结果的无效运行。
- 前端仍有既有 >500 kB chunk 提示；没有将它隐藏或把测试改为跳过。

复现命令（在对应 client/server 目录，PATH 使用固定 Node）：

```bash
# client
npm ci
npm run typecheck
npm run build
npm test
# server
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm run typecheck
pnpm run build
pnpm test
# 单独、隔离测试数据库
TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:55438/yibiao_test pnpm test:integration
```

数据库脚本只接受 localhost/127.0.0.1/postgres-test 的 yibiao_test* 库，逐测试建独立库并清理。不要替换为现网 URL。

## Docker 与原生组件

Compose 项目 `yibiao-transform`，HTTPS 127.0.0.1:54443；恢复项目 `yibiao-transform-restore-current`，127.0.0.1:54445。配置与证书均在 /tmp 的受保护测试路径。build/config/up/health 均执行成功，app UID=1000；主应用单进程。

| 镜像 | 验收索引 ID |
| --- | --- |
| app-enhanced | sha256:251ba05b6116b539db10be0501ce5a13098409500b4e010821af1bd57449de4c |
| app 基础目标 | sha256:f9169923045a56f1a4cd44c2fb525b386954ae480d3cb566bd95965cda178e5f |
| migrate | sha256:6544e00ddcd97496e28c50fa39cdb8ca7cd065d5626621b2fec43d4ec7901bdc |
| nginx 最终网页 | sha256:f19c19353ac7550e5abb0433cdbe5f62d28cb133c04c9ad24aad051d7235f41b |
| 重建的旧程序回退镜像 | sha256:b9b56503f917db70ed9caacd46688052d008580cad9368a0efd7fd45a0cb691e |

运行版本：LibreOffice 7.4.7.2、Chromium 152.0.7977.82、Noto Sans CJK SC，helper 为 .NET 10 / OpenXml 3.3.0 linux-x64 self-contained。基础目标无 Chromium/.NET 依赖。构建时实际下载并安装依赖，未复制宿主 node_modules、真实 .env 或客户文件。

`verification/enhancements.ts` 在真实 Linux 容器通过：DOCX 章节保留表格、页眉页脚，LibreOffice 可转 PDF；扫描/写入 2 个待填 Word 控件；缺 helper、1 ms 超时和越界路径拒绝；离线 HTML/Mermaid 图片可进入 Word；上游规划 fixture 2 图，HTML 布局修复 1 次、Mermaid 代码修复 1 次。模型输入/回答为合成 fixture，不能据此证明真实模型质量。

## 浏览器闭环

`verification/browser.ts` 最后通过的项目为 **11 / UI验收-32dd5233**。实际浏览器完成登录、资料分类上传并新建业绩、金额/知识条目/项目经理岗位编辑、人工候选核验、技术章节注入、正式 ZIP 下载。人员与两张证书由 Prisma 准备，不声称创建人员全部通过 UI。商务页面截图已人工检查。

额外的根目录选择及重连后自定义回答为明确的 UI fixture：核对 selectedIds 和 custom_answer 提交，不冒充真实 Agent 联调。服务端 V2 各阶段/断线恢复另有测试。

本机可审查产物：`/tmp/yibiao-verification/performance.png`、`business.png`、`browser-business.zip`、`html.png`、`mermaid.png`；正式清单/原件包以 DB 中对应引用版本为准。

## 故障、备份、恢复和回退

[故障报告](evidence/faults.json) 使用仅本机可达的合成 HTTP 模型，两个项目 **7/8** 并行分析。SSE 断开后完成；SIGTERM 550 ms；SIGKILL 337 ms；正文任务重启后 paused，另一项目不变；强制重建 10104 ms，仍能 Word 导出。常规浏览器关页不会发取消请求。

| 备份 ID | 证据 |
| --- | --- |
| 20260908T115405.041599Z | 停止所有 app 写入，DB+/data+配置同批，71 文件；备份 5.109 s，恢复及逐文件验证 16.636 s |
| 20260908T153304.266958Z | 增加不可变本地镜像标签和 images.tar；71 文件，归档 1,345,852,416 字节，备份 26.786 s；4 个归档镜像已实际 docker load 成功 |

备份位于 `/tmp/yibiao-transform-backups/<backupId>/`，限权保存，未复制进仓库。第一次恢复到全新卷/空库后，71 文件 hash 全部匹配；恢复实例再次初始化仍保留管理员密码、自定义文章正文/排序、两份证书、知识文档和项目正文，重新登录、DOCX 导入和 Word 导出通过。知识原件与图片额外有 4 个指定 hash 样本；恢复后的知识图片已通过授权加载并重新导入 Word，输出 PNG hash 与恢复资产一致。

首次回退因旧 latest 标签覆盖且将配置 ID 误当可运行镜像引用而失败，未改变恢复实例数据。为完成旧程序兼容验证，从仍运行的旧测试容器只复制 `/app/server`（162 个源码文件及旧依赖，不复制 /data 或容器环境），在同一基础运行时重建回退镜像。旧源清单见 [manifest](evidence/rollback-source-manifest.json)。确认旧代码已有脱敏/安全文件工具后，在含 migration 006 的恢复库运行基础冒烟通过，再切回新镜像。

该回退证明指定合成数据的基础路径兼容，不承诺所有新功能可在旧程序使用。今后备份会在覆盖 latest 前保留 `yibiao-backup:<backupId>-<service>`；回退 override 禁止隐式 build/pull。跨主机需要同时转移 images.tar 或使用已发布不可变镜像。生产回退须验证对应版本与数据格式，不恢复泄密/越权行为。

观测：合成浏览器/导出样本后，主 Node VmHWM=464604 KiB（约 454 MiB），瞬时 RSS=386600 KiB；解析/导出队列各限制 1，空闲时各为 0/0。样本为小 DOCX/单页 PDF/小附件，数据备份压缩包约 54 kB。这里记录组件操作耗时和小样本恢复结果，不能推出 5/10 人或大扫描件生产容量。生产每日备份的 RPO 与真实 RTO 须在部署环境验证；/tmp 只是开发演练，不能替代独立备份磁盘。

## 验收组审计

| 组 | 当前证据与结论 |
| --- | --- |
| A01 构建/初始化 | frozen 安装、generate、类型/构建、空/旧库迁移、重复初始化保留通过 |
| A02 密钥/隔离 | 配置/文件/项目/API/SSE/Pi/处理域拒绝与撤销通过 |
| A03 主流程/恢复 | 本地合成模型分析、浏览器与恢复通过；真实获批模型全生成链仍 BLOCKED |
| A04 解析/出口 | 原件/图片/版本/拒绝外发通过；真实 MinerU OCR BLOCKED |
| A05 搜索/模板/配图 | PG 分页、Linux helper/控件、本地图表通过；真实模型目录/配图质量 BLOCKED |
| A06 台账/迁移 | Decimal/日期/关系/冲突/归档/删除、迁移守恒与零条核查通过 |
| A07 商务真实性 | 候选不自动满足、逐项证据、人工作业/重抽保护通过；真实脱敏招标抽取 BLOCKED |
| A08 快照/技术标 | 源变化/物理删除后原件及图片副本保持；撤销/权威字段/锁定保护通过 |
| A09 出包 | 合成样本 Word/ZIP/manifest、同名/缺件/权限/重试通过；规定的脱敏真实招标闭环 BLOCKED |
| A10 并发/容量 | 两项目、排队/限额、关页/信号/重建有证据；生产容量未作承诺 |

未完成条件明确见 [STATUS](STATUS.md) 与 [EXTERNAL-ACCEPTANCE](EXTERNAL-ACCEPTANCE.md)。不以这些通过项替代完整计划验收。

工具链/依赖复核补充：宿主早期 npm 10.9.8 结果不作为固定版本证据；最终对齐并重验 10.9.3。运行依赖定向修复及剩余构建依赖适用性见 [DEPENDENCY-AUDIT](DEPENDENCY-AUDIT.md)。

最终版本封存：`20260909T014150.180165Z`，含安全依赖/旧人员 DELETE 保护及镜像归档，详见 [最终备份摘要](evidence/final-backup-summary.json)。此前恢复和回退证据保留原执行版本，不冒充对每个后续镜像重新完成整轮恢复。
