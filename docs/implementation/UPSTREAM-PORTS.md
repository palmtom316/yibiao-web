# 上游移植登记

唯一算法对照：`palmtom316/yibiao` 的 `b079bc0d923c4a533b9c2de3a9f573f4c75d8137`。没有 rebase 官方仓库，也没有引入 Electron。当前实现随本报告所在改造分支提交，尚未生产发布；本文件记录实际采用的算法，不按提交数量计算完成度。

| 来源 SHA | 问题/能力 | Web 处理 | 回归证据 |
| --- | --- | --- | --- |
| `a527bf784f753f48766b85f6a8ac36fb337955cb` | OpenXmlHelper / DOCX 章节抽取 | vendor 固定来源；.NET 10 Linux x64 自包含构建，workspace JSON 协议，原件授权后复制到项目任务目录 | `verification/enhancements.ts`：真实 DOCX 表格、页眉/页脚、LibreOffice 打开与越界拒绝 |
| `1bc96dfc9f5337d732ea5e9ba26092369b8fac98` | 独立模板任务、字段扫描及内容控件 | `openxml/fields.ts` 按扫描→穷尽分类→apply 流程异步适配；模型仅给建议，人工确认；签字/盖章必须 manual。保留普通目录降级 | 字段漏分/重复/人工签章测试；Linux 真实扫描和写入 2 个控件 |
| `bc6fe56da4241a421fb81725a1e8f7dbc1c553b2` | 独立技术分册不套“技术方案/监理大纲”等外壳 | 采用最终固定提交的 standalone prompts；服务端校验技术属性、人工锁定根目录和评分映射 | `tasks/vendor/outlineV2.test.cjs`、`runners/outline-v2.test.ts` |
| `8cd0d371dc8c88a19aef6a714cf7b24c8d00e4fe` → `6f433665867c114ea5f041497394b9a95523f0d8` | 小节最小数量与严格字数约束 | 采用后续修正版：每技术分支至少 1 叶，允许根节点直接成文；不照搬已修正的“每分支至少 2 叶” | 上游原样回归样本：10/6→10，4/6→6，4000 字/3000 单节→1，无法容纳 6 分支时报错 |
| `52889bf5ed75b853548512d4087748af69fc626f` | 一级目录返回后未弹确认框 | Web 显式请求结构化根目录选择，持久化每阶段与人工决定；重连按项目查询待答问题；不依赖桌面 checkpoint 同步广播 | V2 断线重试不会重复初始/规划/分配阶段或已答问题；实际客户端提交 selectedIds |
| `edc9119b5fbe947a36f0c9883d86e7bb68a5908c` | 材料不足时 Agent 主动失败；解析项重试 | 增加受控 report-failure 终止当前 Pi 任务，保留原件；采用材料不足不得编造的 V2 提示词。Web 已有单项解析重试接口继续保留，未复制 Electron 通信 | 类型检查/已有解析回归；材料不足时业务失败路径与 JSON 校验；真实模型行为待批准服务联调 |
| `33eedc920d61725361d3668ef4fd4e02ba77be8e` | 长文句子切分二次复杂度、近似匹配重复分配和阻塞 UI | 递增计算非空字符数；预计算 loose text、复用计数数组；每 500 句 await 进度并让出事件循环；元数据完成状态独立于后续比对 | `duplicateUpstream.test.ts`：26 万字长句有界处理、显示截断不影响完整匹配、多次交错匹配计数不串 |
| 固定提交内 `contentIllustrationPlanning.cjs` / `contentIllustrationGeneration.cjs` | 配图规划、HTML 布局修复、Mermaid 修复、图题与插入顺序 | 保留 CJS 算法；Web adapter 用离线 Chromium 和 sharp，优先引用已保存资产；异步 PG 保存、人工章节冲突保护 | CJS 多图/幂等回归；Linux 实际规划 2 图、HTML 布局修复 1 次、Mermaid 代码修复 1 次，Word 含 2 图 |
| 固定提交知识读取模式 | 桌面同步存储直接 map，Web 异步调用可能静默漏资料 | 所有选中知识目录/正文读取 await；V2 提供 readReferences PostgreSQL 适配，关联许可和处理域随任务传递 | `knowledgeAsync.test.ts` 与 V2 异步知识 fixture |

## 明确不直接移植的部分

- BrowserWindow/nativeImage、桌宠、IPC/preload、桌面自动更新与 Windows helper 下载：不适用于 Docker Web；浏览器渲染、授权 API、Linux 构建替代。
- 桌面 developer-mode 模板开关：Web 使用增强镜像和显式模板任务；技术目录始终为技术分册，不把商务模板带入目录。
- 桌面同步 store、全局持久任务 key、并行 fork Session：Web 用项目限定工作区、顺序持久 Agent 阶段和 PG 检查点；不同项目不会共用工作区。
- 埋点、许可证/插件市场、竞品测算和 ComfyUI：冻结非目标/后置范围，不作为本轮未完成修复。

所有目录/配图输入都继续经过 Web 权限与出网策略；移植没有恢复任意 bash、任意本地文件或公网 Mermaid。模型输出测试使用合成 fixture，不能代替真实模型/OCR 质量验收。单项回退先关闭相应入口或 V2 开关，保留不可变文件和来源记录。
