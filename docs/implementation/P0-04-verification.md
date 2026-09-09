# P0-04 Docker、入口与资源约束

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：Dockerfile、docker-compose.yml、deploy/nginx、health、resources、部署文档。

基础 app 和增强 app、migrate、nginx 均完成独立构建；运行用户 1000，Node 22.23.2、LibreOffice 7.4.7.2、Noto Sans CJK SC 可用。首次改密、DOCX 表格导入、Word、SSE、11 文件超限 413、两用户项目拒绝已实测。两个项目通过本地合成模型完成分析，断线仍继续。

验证：Docker 构建输出；scripts/smoke.ts、verification/faults.ts；EVIDENCE.md。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：没有获批准的真实模型端点/凭据，真实分析→生成→Word 全流程未验收；PVE/生产发布与对应源码发布未执行。

回退：使用已保存的安全版本镜像，先验证 schema/数据格式；基础 app 不依赖 Chromium/.NET。回退不能恢复任意 bash/文件或公网渲染。
