# 历史资料（不作为当前要求）

当前用法、规格与状态以根 README、docs/MVP.md、docs/TASK_TREE.md、docs/PROJECT.md 为准。这里保存整理前的文档原文；历史数字、链接位置、配置和功能描述只代表对应阶段。

- `*-20261017.md`：2026-10-17 整理前的 README、AGENTS、规格、任务树、验收和主题说明快照。
- `NATIVE_VOICE.md`、`xiaoli-3d-v1.prompt.txt`、首页 v3/v4：停用方向与素材来源。
- `config-20261017.example.txt`：旧配置模板，无实际密钥。
- `retired-static-assets-20261017.json`：旧图原路径、大小和 SHA-256；对应 ZIP 在忽略的 `artifacts/archive/`。恢复时先核对哈希，再按原相对路径解压，不能覆盖当前资源。
- 停用语音工具现位于 `scripts/legacy/`；历史命令的 `scripts/xxx` 改为 `scripts/legacy/xxx`，浏览器面板改为 `/scripts/legacy/qa/voice-e2e.html`。这些工具保留 `--live` 显式开关，不是当前运行要求。

此目录、停用工具与历史素材包均不进入精简源码包；任务证据和正在使用的隔离体验继续保留原位。
