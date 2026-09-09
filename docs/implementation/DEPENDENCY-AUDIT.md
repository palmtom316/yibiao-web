# 本轮依赖复核

2026-09-09，在固定 Node 22.23.2 / npm 10.9.3 下执行 npm ci 时报告 12 项依赖告警（7 high），随后读取 npm audit 明细；[原始结果](evidence/client-audit-before.json) 保留作为核对依据。

定向更新前端 Axios、Mermaid 及其 DOMPurify/linkify-it/form-data 依赖，未执行全量 npm audit fix；服务端原先固定 Mermaid 11.14.0，明确更新为 11.17.2，与前端一致。锁文件记录实际版本：Axios 1.20.0、Mermaid 11.17.2、DOMPurify 3.4.15、linkify-it 5.0.2。

更新后 `npm audit --omit=dev --json` 成功，运行依赖报告为 0。剩余 7 项位于 dev-only 的 Babel、baseline-browser-mapping、Browserslist、esbuild、nanoid、PostCSS、Vite，包归属已从锁文件核对，见 [复核记录](evidence/client-audit-runtime-after.json)。它们涉及构建输入/源映射、Windows 开发服务器或构建工具的异常参数；本方案在 Linux 构建可信仓库源码，生产 nginx 不运行这些开发服务，也不将用户文档送入 Babel/PostCSS。没有把这些剩余项隐藏或声称全依赖零告警。

修复后的类型、测试、镜像和浏览器/本地图表结果记在 EVIDENCE.md。软件包审计只代表该时间点与本轮检查范围，不替代业务权限/处理出口验证。

工具链纠正：早期宿主 Node 自带 npm 10.9.8，不能据此声称宿主固定版本验收；最终已在 /tmp 工具链安装并实查 npm 10.9.3，重跑安装/测试/构建。Docker 的 npm 10.9.3 从首轮构建起已显式固定。pnpm 已实查为 10.17.1。
