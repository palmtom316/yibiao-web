# 修订证据（2026-09-13）

本目录保存 PVE 单人测试准备修订的原始证据。所有文件均为命令输出或合成测试产物，
不含真实项目资料、凭据或密钥。

## 文件

| 文件 | 内容 |
| --- | --- |
| `baseline-*.tap` / `baseline-*.log.txt` | 修订开始时的基线检查（165 单元 + 15 集成 + 28 前端） |
| `post-server-unit.tap` | 修订后 server 单元测试 TAP（185 通过） |
| `post-server-integration.tap` | 修订后 PostgreSQL 16 集成测试 TAP（17 通过） |
| `post-client-unit.tap` | 修订后 client 单元测试 TAP（30 通过） |
| `post-server-typecheck.log.txt` / `post-client-typecheck.log.txt` | `tsc --noEmit` 输出 |
| `post-server-build.log.txt` / `post-client-build.log.txt` | 两端生产构建输出（含分块体积） |
| `post-server-audit.json` / `post-client-audit.json` | 两端依赖审计原始 JSON |
| `post-client-npm-ci.log.txt` | client 锁文件安装（`npm ci`，即 CI 路径） |
| `post-compose-config.json` | `docker compose config` 解析结果（校验日志轮转等 compose 变更） |
| `post-meta.txt` | 提交、工具链、结果汇总、未验证项 |
| `manifest.sha256` | 本目录全部文件的 SHA-256 |

## 复现

```bash
# server（Node 22.23.2 / pnpm 10.17.1）
cd server
pnpm install --frozen-lockfile && pnpm exec prisma generate
pnpm run typecheck && pnpm run build && pnpm test
TEST_DATABASE_URL=postgresql://<user>:<pass>@127.0.0.1:<port>/yibiao_test pnpm run test:integration
pnpm audit --prod --json

# client（npm 10.9.3）
cd client
npm ci && npm run typecheck && npm run build && npm test
npm audit --omit=dev --json
```

集成测试要求 `TEST_DATABASE_URL` 指向本地（`127.0.0.1` / `localhost` / `postgres-test`）
且库名匹配 `yibiao_test` 或 `yibiao_test_<suffix>`；runner 会拒绝其他目标，避免误碰真实库。

```bash
# 生成校验清单
find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > manifest.sha256
sha256sum -c manifest.sha256
```
