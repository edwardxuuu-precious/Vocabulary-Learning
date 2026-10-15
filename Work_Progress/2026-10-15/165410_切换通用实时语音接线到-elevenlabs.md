# 任务记录

## 任务名称
- 切换通用实时语音接线到 ElevenLabs

## 执行时间
- 开始时间：2026-10-15 16:54:10 +0800
- 结束时间：2026-10-15 16:58:26 +0800

## 仓库根目录
- C:\Users\edwar\Documents\ChatGPT\英语学习

## 任务背景
- 用户改为 ElevenLabs 输入和朗读，Codex 保持对话与图片；本子任务负责服务端接线和边界测试

## 任务目标
- 使用 speech-router 通用实时 STT 工厂，去除 Soniox 硬编码并保留取消、预算、同源及硬限保护

## 已执行动作
1. [16:58:25] server/index.ts 改用 speech-router 导出的 createLiveSttSession；relay 移除 Soniox 密钥文案，额度/频率受限时给可恢复中性提示。12 项实时与 14 项核心模拟测试通过，覆盖 ElevenLabs 通用工厂、额度失败不调旧服务、不提示充值、未配置不预留费用，以及原取消/硬限/同源/单麦/SSE 边界。未直接读取凭据文件或调用真实服务。

## 结果
- 服务端实时语音已通过通用工厂接入 ElevenLabs，保留取消、预算及45秒保护，无自动付费服务回落。

## 状态
- 成功

## 相关文件
- server/index.ts
- server/live-voice.ts
- tests/realtime-api.test.ts

## 验证
- npx tsx --test tests/realtime-api.test.ts tests/core-api.test.ts tests/core.test.ts：26/26通过；npm run check：通过。

## 遗留问题/下一步
- 总控汇合 Scribe provider、UI 和文档后构建并重启，按用户免费额度限制执行真实语音验收。