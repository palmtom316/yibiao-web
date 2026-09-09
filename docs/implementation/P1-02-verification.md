# P1-02 MinerU、数据域授权与解析分级

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：document/mineru.ts；config；processing-authorizer；ProcessingPolicyPanel。

按固定上游 v4/agent 协议实现上传、轮询、下载、超时、有限重试、取消、安全解压及本地回落警告；401/429/超时/损坏 ZIP/越界与禁止外发有测试，扫描件本地无文本不能算成功。

验证：document/mineru.test.ts、security/boundaries.test.ts、processing-authorizer.integration.test.ts、sources.integration.test.ts。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：计划明确要求脱敏样本真实 OCR 联调。没有获批 MinerU 端点、凭据及样本，mock 不替代真实验收；批量扫描件录入交付未放行。

回退：关闭 MinerU，保留原件；显示本地能力范围、失败原因及需 OCR/人工处理。
