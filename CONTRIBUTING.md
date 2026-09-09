# 贡献指南

感谢参与 OpenBidKit 易标 Web 版。

1. 从 `main` 创建独立分支；
2. 不提交无关改动、凭据、客户数据或生成文件；
3. 使用 `.node-version` 固定的 Node 22.23.2、客户端 npm 10.9.3、服务端 pnpm 10.17.1；
4. 前端执行 `npm ci`、`npm run typecheck`、`npm run build`、`npm test`；后端执行 `pnpm install --frozen-lockfile`、`pnpm exec prisma generate`、`pnpm run typecheck`、`pnpm run build`、`pnpm test`；
5. 涉及权限、项目作用域或鉴权时补充管理员与普通用户双向验证；
6. Pull Request 说明修改内容、测试命令和 AGPL/NOTICE 影响。

所有贡献均按 GNU AGPL-3.0-only 提供。

测试入口自动发现全部 `src/**/*.test.ts` / `*.test.mjs` / `*.test.cjs`。
真实数据库测试使用 `.integration.test.ts`，单独运行 `pnpm test:integration`，
必须提供指向本机隔离数据库 `yibiao_test*` 的 `TEST_DATABASE_URL`。
普通测试使用不可连接的数据库 URL 和临时数据目录，不读取开发或现网数据。
改造任务与验收证据记在 `docs/implementation/STATUS.md`。
