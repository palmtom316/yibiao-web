# P1-04 Linux OpenXmlHelper、模板字段与目录 V2

状态：**BLOCKED**。验收日期：2026-09-08～09。负责人：Codex。代码版本以本报告所在 Git 提交为准；尚未生产发布。

实现：vendor/openxmlhelper；openxml/service.ts、fields.ts；tasks/vendor/outlineV2.cjs、runners/outline-v2.ts；目录确认/模板 UI。

Linux amd64 真正执行 helper JSON 协议、带表格/页眉页脚章节抽取、LibreOffice 打开；扫描并写入 2 个 Word 字段控件；缺工具/超时/越界路径拒绝。V2 根选择、评分分支、字数分配、数量确认和最终审核均有持久阶段适配，重试不重复已完成阶段。技术分册禁止商务/资信，原方案扩写保留旧路径。

验证：verification/enhancements.ts；outline-v2.test.ts、outlineV2.test.cjs、fields.test.ts；浏览器结构化选择/自定义回答 fixture。 统一命令、环境、报告/hash 与运行记录见 [EVIDENCE](EVIDENCE.md)。

边界/未完成项：Linux/确定性流程通过；V2 在获批准真实模型上的全阶段联调尚缺端点/凭据，不能称完整增强验收通过。模板字段可人工分类，不自动填写签字盖章。

回退：YIBIAO_OUTLINE_V2=false 回到旧目录；缺 helper/Word 原件显示未抽取模板；保留原件与产物。
