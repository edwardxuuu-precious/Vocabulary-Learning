# 任务记录

## 任务名称
- GPTLive计费ZDR与Codex委托只读补充核验

## 执行时间
- 开始时间：2026-10-15 20:43:33 +0800
- 结束时间：2026-10-15 20:45:27 +0800

## 仓库根目录
- C:\Users\edwar\Documents\ChatGPT\英语学习

## 任务背景
- 总控发现官方GPT-Live原生全双工与client delegation更贴合当前语音前端加Codex执行需求。

## 任务目标
- 仅核对Live当前价格/免费条件、live sessions ZDR限制、client delegation接官方OAuth Codex条件，更新一页结论，不推理/申请key/改生产。

## 已执行动作
1. [20:45:27] 实际读取官方Live入门、delegation、模型价格/Free表、your-data的live sessions限制及费用说明。官方LED示例实际用Responses后端，未将其误写为OAuth Codex运行时示例；连接Codex OAuth以任意自有harness的client delegation能力及现有官方app-server为依据，标注为可实现适配推断。

## 结果
- GPT-Live更贴合语音前端与自有Codex后端分离；技术上可做client bridge，但Live非免费，Live ZDR也不自动覆盖Codex OAuth后端。仅补充三点研究结论。

## 状态
- 成功

## 相关文件
- Work_Progress/2026-10-15/204333_gptlive计费zdr与codex委托只读补充核验.md；Work_Progress/2026-10-15/203824_原生语音到语音儿童接入条件只读核验.md

## 验证
- 官方模型页Free Not supported；价格$0.05/min按秒；官方ZDR端点限制；client delegation事件与任意harness能力逐条核对。没有云推理、key申请或生产修改。

## 遗留问题/下一步
- 总控确定分工；任何真实儿童接入仍需核实API项目ZDR、免费/计费许可，以及Codex OAuth后端自身的数据条件。

## 一页补充结论：仅三点（2026-10-15）

1. **价格与免费条件。** `gpt-live-1` 的语音会话为 **$0.05/分钟，按秒，不按整分钟向上取整**；等后端、闲置且仍开着的时间也计会话费。WebRTC创建时先计15秒（按现价$0.0125），运行后抵扣，不再额外加15秒。后端推理/工具另外按其自身规则结算，Codex OAuth额度不支付Live会话。官方模型页Free明确Not supported，需要有权限的项目API key；未查询账号余额，不能承诺免费试用。[模型与Free表](https://developers.openai.com/api/docs/models/gpt-live-1)、[初始化计费](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live#webrtc-initialization-charges)

2. **`/v1/live/sessions` 的ZDR限制。** 官方列为ZDR兼容；获批并启用ZDR时 `store` 强制为false。会话录制默认不存；开启存储且 `store:true` 才保留已完成录音30天，以供下载/fork；下载和fork需要允许持久化的数据政策，ZDR下不可用。fork设false只影响新会话，不删除源录音，当前无公开stored-session删除接口。普通 `store:false` 不等于已获批ZDR；under13数据要求与ZDR审批门槛仍然存在。**委托后端/工具各有自己的数据控制，Live ZDR不自动覆盖Codex OAuth路径。** [官方精确端点限制](https://developers.openai.com/api/docs/guides/your-data#v1livesessions)

3. **能否接官方OAuth Codex。** 官方client delegation允许任何应用自管model/agent harness/service：`{model:"gpt-live-1",delegation:{type:"client"}}`。据此可由本机server把请求桥接到现有官方Codex app-server，仍由官方客户端管理ChatGPT OAuth，不读取/转发OAuth token；**这是公开接口能力支持的适配推断，尚未实测，非现成OAuth直连选项。** Live前端仍独立使用API key。delegation事件只有ID/offset等元数据、没有任务原话；应用须收集transcript与最新任务状态、校验授权/确认/重复执行，再调用Codex；把已验证结果以同一delegation ID经 `session.commentary.append` 返回（可被改述，非逐字朗读保证）。[client delegation](https://developers.openai.com/api/docs/guides/live-delegation#configure-client-delegation)、[Live架构](https://developers.openai.com/api/docs/guides/live)
