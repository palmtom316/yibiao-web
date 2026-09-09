# 改造实施基线

实施日期：2026-09-08。工作目录 `/home/palmtom/projects/yibiao-web`。

- 实施起点：`c9d45b2`（2026-09-07 23:09:59 +08:00 的审核修订计划）；业务基线 `8a6b8d99e59a44778306b676ddf285304953442f`。开工时工作区干净。
- 固定官方对照：`b079bc0d923c4a533b9c2de3a9f573f4c75d8137`。当前同级 `yibiao` 实际是旧 Web fork，不能当作官方对照。
- 初始主机：Linux amd64、Node 24.20.0、Docker 29.8.0；没有可用的 .NET、psql、LibreOffice。pnpm 启动器默认下载 12.3.4，与计划不符。
- 本项目固定 Node 22.23.2（开工时官方 latest-v22.x）、npm 10.9.3、pnpm 10.17.1。
- Node Linux x64 下载 SHA-256：`d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`，来自官方 SHASUMS256.txt。
- 初始缺口：两端 test、后端 typecheck、迁移历史、Docker 交付及实施记录均缺失。

验证结果逐项记录，不将网络可访问、容器启动或 mock 通过等同于全部验收通过。
