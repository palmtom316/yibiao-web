# 2026-09-13 全仓代码审核证据

对应 [审核报告](../../CODE-REVIEW-2026-09-13-PVE-SOLO.md) 和 [PVE 单人测试清单](../../PVE-SOLO-TEST-2026-09-13.md)。源码基线 `5a926ae64fc5983a3219bd3f9aa10cc113af144a`；本目录为本轮实际执行证据，没有引用旧日志充当新结果。

## 检查结果

| 检查 | 本轮结果 | 文件 |
| --- | --- | --- |
| Node/npm/pnpm | 22.23.2 / 10.9.3 / 10.17.1 | [checks.json](checks.json) |
| Prisma Client 生成 | 通过，6.19.3 | [prisma-generate.log.txt](prisma-generate.log.txt) |
| 服务端类型检查、构建 | 通过，退出 0；无诊断输出 | [checks.json](checks.json) |
| 前端类型检查、构建 | 通过；存在大 chunk 警告 | [client-build.log.txt](client-build.log.txt) |
| 服务端单元测试 | 165/165 通过，无跳过 | [server-unit.tap](server-unit.tap) |
| 前端单元测试 | 28/28 通过，无跳过 | [client-unit.tap](client-unit.tap) |
| PostgreSQL 集成测试 | 15/15 通过，无跳过 | [server-integration.tap](server-integration.tap) |
| 合成缺陷复现 | 9/9 观察成功，说明缺陷存在 | [probe-results.json](probe-results.json)、[probes.mts](probes.mts) |
| Compose 配置解析 | `config --quiet` 通过 | [checks.json](checks.json) |
| 受控 CJS/MJS/Python 语法 | 通过；Python 使用 AST 解析 | [additional-syntax.json](additional-syntax.json) |
| 服务端运行依赖审计 | 36 条告警记录：high 26 / moderate 10；涉及 11 个不同包 | [server-runtime-audit.json](server-runtime-audit.json) |
| 前端运行依赖审计 | 0 告警 | [client-runtime-audit.json](client-runtime-audit.json) |
| 前端完整依赖审计 | 7 个受影响包：high 4 / moderate 1 / low 2 | [client-full-audit.json](client-full-audit.json) |
| 全量文件清单 | 593 文件；418 代码文件，96,502 行；逐文件 hash | [inventory.json](inventory.json) |

共 208 项现有测试通过；9 项缺陷复现不计入“产品测试通过”数量。服务端运行依赖审计、前端完整审计退出 1 是因为返回了告警，查询本身成功。

## 执行边界与重试

- PostgreSQL 使用本轮建立的独立 `postgres:16-alpine` 临时容器、回环端口 55483、合成测试密码和 tmpfs 数据目录。没有访问已有业务数据库。集成测试各自创建/删除 `yibiao_test_*` 数据库。
- 集成测试第一次在沙箱内不能连接测试端口，全部在建库前失败；获准在沙箱外重跑后 15 项通过。失败属于执行环境限制，不能记成应用缺陷，也不能隐去重试事实。
- R02 复现第一次预期一次权限检查，实际代码对拒绝又重试两次。调整的是观察脚本的次数断言，记录全部 3 次 `administration`，业务代码没有变化。
- 安装过程中包仓库连接失败/下载缓慢，复用缓存重试。项目锁文件未修改；没有执行 audit fix。
- 本轮未构建/启动完整 app/nginx/migrate 镜像，未运行目标 PVE、真实模型/MinerU、完整浏览器、.NET helper 或目标环境备份恢复。只有独立 PostgreSQL 测试容器与本机代码检查。
- `inventory.json` 是审核开始时的 Git 文件清单，包含自动扫描入口；扫描命中不等于人工逐行审核，也不等于漏洞。C# helper 纳入清单和边界复核，但本轮未执行 .NET 编译。

## 复现方法

先按仓库锁文件安装两端依赖并生成 Prisma Client。在 `server/` 运行：

```bash
node --import tsx ../docs/implementation/evidence/review-2026-09-13/probes.mts
```

脚本使用真实函数/路由、内存数据库替身、合成文件及拦截的 fetch；不连接模型或真实数据库，结束后清理自己的临时目录。R03 使用锁定的 fetch-event-source 和替身流模拟正常 EOF。R07 临时捕获未处理拒绝，用于观察而不让整个复现脚本退出。

**脚本退出 0 表示这些旧行为已复现，不表示产品合格。** 修复后要把相应情景改写成新契约的回归测试。R10/R11 是调用链和 schema 静态核对；R12 是包级审计与可达性分析，不声称已经运行漏洞利用。

`SHA256.json` 校验本证据目录除其自身以外的文件；`inventory.json` 的 hash 则对应审核基线文件，两者含义不同。
