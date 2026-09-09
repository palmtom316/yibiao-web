# P0-02 配置响应、资源访问和处理出口

状态：**DONE**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：server/src/config、security、auth、agent；配置 UI；文件/导出/SSE 路由。

虚构密钥的用户 GET/PUT、管理员 GET/PUT 脱敏，空值保留、显式清除、掩码拒绝；降权和停用立即生效。两个项目的路径穿越、符号链接、外部图片、重定向及 Pi 文件根均有拒绝测试。新增 Pi 环境测试确认不继承 DATABASE_URL/JWT/模型密钥；真实 PostgreSQL 验证项目+共享策略及模块撤销。

验证：boundaries.test.ts、config.security.test.ts、processing-authorizer.integration.test.ts；smoke.ts 与 faults.ts 的 API/SSE 隔离。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：真实模型连通/质量由 P0-04 单独验收。

回退：可关闭 Agent/图片/外部处理入口；保留安全校验、原件及服务端真实配置，不恢复泄密路径。

最终 Pi SDK 接线验证：实际 createPiSession 不发起网络调用，启用工具名与受控定义一致；直接调用 SDK 注册的 read/write 拒绝越界与符号链接。见 piSessionBoundary.test.ts。
