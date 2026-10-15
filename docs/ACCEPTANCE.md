# MVP 验收记录

验收日期：2026-10-15，Windows / Node.js 24 / 本机 IAB 浏览器。以下按阶段保留证据，文末“真实语音完整学词复核”为当前最新验收，前述入口、配置、会话及测试数量仅为各阶段快照。

| 范围 | 实际验证 | 结论 |
| --- | --- | --- |
| 构建与类型 | `npm.cmd run build`，包含 `tsc --noEmit`；Vite 生产 JS/CSS HTTP 200 | 通过 |
| 自动测试 | `npm.cmd test`：核心/HTTP 14 项、接入 15 项，共 29/29；覆盖生成成功/失败/取消后不能重新批准已编辑义项 | 通过 |
| 儿童学习 | apple、banana、cat 三词认识、听图匹配、声音选择、跟读继续；错选重试；发放 1 张贴纸 | 通过 |
| 首次开放聊天 | 首次直接由小栗问“你喜欢什么”；无分类卡；成人代录“我喜欢在我的世界里面造房子”，确认前不保存，确认后原样保存并引入学习 | 通过 |
| 再次聊天与跳过 | 改为“我最近喜欢宝可梦”后回首页，原会话 ID 不变；暂不回答可进入过渡，不编造兴趣；最终清除验收资料 | 通过 |
| 学习记录 | 提示与纯练习不晋级；同日上限、跨天调度、恢复和幂等奖励由核心测试验证 | 通过 |
| 家长导入 | 浏览器粘贴两列 apple/苹果、rocket/火箭，预览并创建词书；新词待准备，词书默认未启用 | 通过 |
| 图片生成 | 从家长页触发 rocket 生图，Codex OAuth 成功；图片出现火箭、太空和小恐龙，无答案文字；待审核后手工确认 | 通过 |
| Codex 探测 | 另一张 apple/苹果＋恐龙真实生成；本机图片格式/hash、账号与 CLI 摘要验证；服务重启后仍为 verified | 通过 |
| 设置 | 每日新词改为 2 并保存，API 与备份确认持久化；最终恢复为默认 3 | 通过 |
| 备份/恢复 | 家长下载 14 词、1 张贴纸、2 个图片文件的 JSON；通过页面恢复初始备份，自动保留恢复前快照 | 通过 |
| 语音缺配置 | 服务页显示 unconfigured；点击语音命令明确提示、按钮可继续，不请求麦克风；本机朗读演示和点击学习可用 | 通过 |
| 云语音接入 | 模拟 Azure 响应验证缓存、SSML、WAV、错误、计费与密钥保护；当前没有真实密钥 | 待真实请求验证 |
| 本机启动 | PowerShell 启动器实际隐藏启动服务，health 与生产 bundle 返回 200；停止器只操作匹配本项目路径的进程；停止/再启动成功 | 通过 |

## 运行数据与证据
- 当前数据：12 个内置词，未选择兴趣，0 张贴纸，无活动学习会话。验收数据未写成孩子的正式学习结果。
- 初始备份：`artifacts/qa-baseline.json`；验收中间备份：`artifacts/qa-after-round.json`；最终入口截图：`artifacts/mvp-chat-first.png`；过渡截图：`artifacts/chat-to-play.png`。
- 页面下载的完整验收备份：用户 Downloads 中 `单词游乐园备份-2026-10-15.json`。
- 自动恢复快照：`data/backups/`；真实插画与验证文件：`data/images/smoke-0162-20261015/` 和 `data/images/9a0862c8-3e37-40fe-9029-39cdf151f38e/`。
- 自动审批拒绝清理接入调试时生成的 `.schema` 目录，已保留并加入 Git 忽略；应用不引用这些文件。

## 历史配置缺口（已由M8完成）
当时默认使用 Soniox 输入、ElevenLabs 输出；本机 `.env` 已准备，需 `SONIOX_API_KEY`、`ELEVENLABS_API_KEY` 与 `ELEVENLABS_VOICE_ID`。Azure 仅显式备选，配置见 README。真实儿童识别和云端朗读须单独验收，不能把本机朗读记为云音色。

## M7 视觉重构验收（2026-10-15）
- 参考 Khan Academy Kids、Duolingo ABC、Lingokids 官方设计，采用原创透明 3D 小栗；提示词和生成来源保留在 `docs/xiaoli-3d-v1.prompt.txt`。重做聊天、首页、学习、奖励及家长视觉，未变更 API 和学习规则。
- `npm.cmd run build` 通过；本轮 `npm.cmd test` 29/29 通过。最终浏览器错误日志为空，生产页面已重载到最新包。
- 浏览器验证开放兴趣原话、成人代录、孩子确认后进入学习、缺语音配置提示、听图错选重试与正确继续，以及家长门控和真实服务状态。
- 默认 849px 和 390×844 窄屏检查：聊天、学习、家长页无横向溢出；已检查可见按钮触控尺寸至少 48px。窄屏实际视口中反馈栏不遮住题目，完整长截图的 sticky 栏有截屏定位偏差，不用该长截图作为交付证据。
- 最终截图：`artifacts/mvp-redesign-chat.png`；其他证据：`mvp-redesign-home.png`、`mvp-redesign-learning.png`、`mvp-redesign-mobile-chat.png`、`mvp-redesign-mobile-learning-viewport.png`。
- 已恢复本轮开始前备份 `artifacts/ui-redesign-baseline-20261015.json`；API 确认 12 词、0 兴趣、onboarding=false、0 贴纸、无活动会话，浏览器回到初次聊天，临时视口已重置。
- 当前 Speech=unconfigured，Codex=verified（生图证据）。Soniox＋ElevenLabs 为下一阶段推荐方案，尚未新增适配器、未发送儿童音频、未验收连续 Codex 对话。真实儿童表现及音色需试音后决定。

## M6 连续语音与真实对话接入（2026-10-15，覆盖上节当时状态）
- Soniox、ElevenLabs、Codex 对话、前端和本机 WS/SSE 已汇合，`npm.cmd test` **64/64**、`npm.cmd run build` 通过；生产服务重启至新版。
- 实时语音边界回归包括同源、单麦、PCM/45秒硬限、握手中断、未知费用保留预留、已知用量结算、关闭前结算及晚到回包隔离。供应商测试使用模拟连接，未据此标记真实服务可用。
- 固定台词“我喜欢会变身的挖掘机”通过真实 Codex OAuth 返回结构化兴趣提案；关闭 worker 后新进程使用原会话恢复，准确复述测试兴趣。浏览器成人代录入口真实回合、刷新恢复记忆、失效会话提示“重新聊”均通过。
- 真实对话证据：`scripts/smoke-dialogue.ts`、`data/dialogue-smoke/`（忽略）及 `artifacts/codex-dialogue-live-ui.png` / `codex-dialogue-refresh-memory.png`。测试兴趣未确认保存；0兴趣、0答题；保留用户已经开启的1个学习会话，没有恢复旧空白备份。
- 女声候选 Anna Su 已加入账号并把公开 Voice ID 写入忽略的 `.env`；后续核实其属于 Voice Library，免费账户不能经 API 调用，尚未作为可用音色验收。两把最小权限密钥创建已获用户明确批准，Soniox 已创建并安全保存到忽略的 `.env`，ElevenLabs 尚未创建；未代为付款。
- 合成音频测试工具已准备：`scripts/make-voice-fixture.ps1` 生成3.08秒16kHz mono PCM WAV；`scripts/smoke-voice.ts --live` 经过本机预算测试真实TTS/STT。该音频由Windows合成，不是儿童录音，尚未发送到供应商。
- Soniox/ElevenLabs 云端请求尚未验证。音色自然度、欢快语气和真实儿童识别效果不计为已通过。ElevenLabs 有免费额度，可先测试其允许 API 使用的音色；Soniox 新 API 账号不赠送额度。
- 已核实 ElevenLabs Scribe v2 Realtime 支持实时识别和中文，统一输入输出服务具备接口能力；本地尚未实现 Scribe 适配，未申请扩大识别权限，未用真实请求验证，不标记切换成功。

## M8 ElevenLabs 统一语音实测（2026-10-15，覆盖以上历史阶段状态）
- 用户明确授权识别/朗读专用 key；已创建 `Xiaoli Local Voice`，仅 Text to Speech 与 Speech to Text Access，直接保存到忽略的本机 `.env`，没有输出到聊天、截图或日志。Voice Design 创建“小栗 Xiaoli - 温暖欢快女声”，Voice ID 已替换旧候选。
- 控制台确认 Free 方案；生成前 0/10,000 credits，API 充值余额 $0，Auto Top Up Off。未购买订阅、未充值，未启用 keyterms 或 transcript_edit 附加功能。免费调用仍按单价折算本地预算记录，不代表实际扣费。
- `npx.cmd tsx scripts/smoke-voice.ts --live --dialogue`：真实 Scribe 将3.08秒固定合成句转写为“我喜欢会变身的挖掘机。”，Codex OAuth 回复“你喜欢会变身的挖掘机，听起来真有趣！我记对了吗？”并返回原话兴趣提案；同一原创女声经 v4 Turbo HTTP 生成74,858字节 MP3。没有确认兴趣。
- `--live --auto-endpoint --english`：不发送手动 finish，补静音后自动收到整轮定稿；英文 apple 云端朗读成功；重复中文问候命中缓存，不新增 TTS 请求。
- 全项目 `npm.cmd test` **75/75**、`npm.cmd run build`（含类型检查）通过。新增 Scribe 模拟覆盖认证不进 URL、分段/整轮、儿童恢复说话、短句 padding、配额停止、取消与错误；既有同源、单麦、45秒、预算、SSE、图片和学习边界继续通过。
- 浏览器家长页显示 Scribe/TTS/Codex 对话/Codex 生图均 verified；每项有独立实际请求证据。学习记录保持12词、0兴趣、0答题，保留用户1个活动会话；未恢复旧备份或消除用量。凭据扫描516个源码/文档/日志文件，未发现两把真实 key；`.env`、`data`、`artifacts` 均被 Git 忽略。
- 证据：`artifacts/voice-live-smoke.json`、`voice-auto-smoke.json`、`xiaoli-voice-sample.mp3`；服务状态截图 `elevenlabs-app-services.png`。本轮没有上传儿童录音，也未在真实麦克风/儿童环境下验收发音含糊、长停顿和音色喜好。

## M9 语音到学习全流程与修复（2026-10-15，历史阶段）
- 正式主服务8787与隔离后端8788/网页5174分离。浏览器通过真实录音处理代码运行Windows合成麦克风，实际调用Scribe、Codex OAuth及ElevenLabs TTS；没有采集房间声音或上传儿童录音。测试兴趣和答题仅进入独立档案，主档案与本轮基线的profile/settings/packs/words/progress/attempts/activeSession/stickers全部一致。
- 完整路径通过：自由说“我喜欢会变身的挖掘机”→Codex原话提案→说“对”确认→说“开始学习”→apple学习。首次进入认识词页；已有练习则恢复原步骤，未重置答题。听图错选保持同题、答对解锁继续、休息恢复通过。进入学习已清除旧的兴趣确认字幕。
- 2秒与3秒句中停顿均保留完整后半句。最新收尾修复后，叠加至少3秒连接准备等待的3秒停顿仍通过。不能据此承诺任意长停顿或儿童含糊表达一定识别准确。
- 点麦克风立即并行采集和连接，最多160KB/约5秒内存缓冲。合成麦克风启动本轮27–38ms；实际设备/首次权限授权另计。真实MP3播放中点击开麦，暂停事件在WS创建后19–27ms到达；取消/过期合成不能复活下一句。当前需要点击麦克风，不是持续免点击监听或仅靠说话自动打断。
- 慢连接短确认用例：短句在2235ms已说完，应用在3606ms收到就绪，6014ms返回最终“对。”，6033ms确认保存，6436ms开始缓存朗读；没有丢句首，没有额外Codex回合。提前结束用例：2717ms手动停麦，3305ms才收到就绪，仍将缓存音频顺序提交，6250ms定稿“开始学习。”并成功进入学习。
- 曾捕获云端committed“对。”后重复partial“对。对。”，等到约45秒硬限才结束。已修复为已有committed、partial稳定至少1.5秒且连续实际静音至少4秒时，每连接最多发一次真实commit，再等待最多8秒；新语音活动取消恢复等待。只使用真实committed或真实空partial确认过的stable，不把重复partial猜成最终答案。故障时序保留，恢复分支有可控回归；最终真实慢连接短句复跑正常收尾，未复现该随机重复。
- 确认解析不会把“我还没想好”“我喜欢对战”误当肯定。确认和开始由严格本地规则处理，未知表达不落兴趣，图片仍需家长审批。备份恢复合并账本且同ID本机记录优先，不能冲销已发生或未知预留用量。
- 官方app-server model/list核实gpt-6-luna及low effort可用后，本机`.env`已选该对话模型；没有改电脑全局或生图模型。兴趣页只发送学习可用性/已批准词数，学习页保留所需词汇上下文。模型进入会话/验证指纹，旧模型会话不能静默复用。未缓存最终自然语言回答或跳过原话/schema/权限校验。

| 时延样本（合成语音、真实云端） | 本轮结果 |
| --- | --- |
| 原默认Codex gpt-6.1-sol回合 | 6.631/17.730秒；旧浏览器完整回合21.820秒 |
| gpt-6-luna模型独立探测 | cold7.483秒，warm5.569秒 |
| gpt-6-luna浏览器真实回合 | 5.337/5.595/9.245秒 |
| 说完到首次MP3开始播放，未缓存回复 | 优化前28.691秒；优化后12.784/13.073/17.218秒 |
| 停顿后自动整轮收尾 | 正常约3.6–3.8秒；有意留出慢说时间 |
| 本地确认、开始接口 | 最终压力样本17ms/11ms；不计静音等待和界面渲染 |

以上为少量实测样本，不能当作稳定P50/P95或儿童设备时延。当前回复仍可能等十几秒，主要来自静音保护、Codex和首次TTS。HTTP TTS每句完整收MP3再播，不宣称已做边收边播；重复播放从本机缓存读取。

- `npm.cmd test` **118/118**、`npm.cmd run check`和`npm.cmd run build`通过；浏览器最终控制台无error。正式服务重启后再次运行`scripts/smoke-voice.ts --live --dialogue`，3.08秒固定合成句完整转写，Codex原话提案、未缓存66,081字节MP3成功。正式服务stt/tts/dialogue/codex均verified，当前对话状态显示gpt-6-luna。
- 主服务新增用量保留，最终本地月估算0.073519元（含此前用量，非实际扣款）；隔离验收账本另存，未通过旧备份回滚。未充值、未订阅、未改自动充值设置。83个源码/文档/日志/构建文件扫描未发现两把真实key，`.env`/`data`/`artifacts`均忽略。
- 临时隔离服务已停止，正式8787继续运行。证据：`artifacts/voice-e2e-*-timeline.json`、`voice-e2e-final-learning.png`、正式入口`voice-e2e-main-ready.png`、`voice-live-smoke.json`、`voice-e2e-main-baseline.json`、`voice-e2e-main-after.json`。失败及修复证据都保留；新QA源码仅显式测试入口载入，正式页面不包含合成麦克风/测试面板。
- 尚需孩子本人试用实际设备，确认含糊发音、背景回声、混合中英和音色偏好。合成语音不替代该体验，也没有发音评分。

## M10 接话提速、流式播放与麦克风（2026-10-15，历史阶段）

- 用户接受“先自然接话，再播Codex实际回答”，两种延迟分开验收。正式对话继续由OAuth的gpt-6-luna生成，保持low/default tier、完整schema与本轮原话校验，不缓存模型最终回答，不增加付费Fast模式。
- 兴趣自由表达阶段预备固定女声“嗯，我在听。”，约1.6秒安静触发，录音继续。孩子恢复声音立即停播，重新持续说话400ms后才可再次触发，每次录音最多两次。缺音频/失败就跳过，不阻塞正式回答、不猜理解或确认兴趣。
- 真实MP3使用HTTP流和浏览器MediaSource播放，实际playing事件计时；取消同时终止fetch/reader/Audio，已中断或损坏音频不能成为缓存。完整/流式同键并发共用请求及预算预留。自动测试用受控上游验证EOF前可收到音频，真实主服务也验证首批早于EOF。

| 真实API、合成麦克风/固定文字样本 | 当前结果 |
| --- | --- |
| 三秒句中停顿，最终声学结束→接话 | 1.707秒；整句“我喜欢。会变身的挖掘机。”保留 |
| 句中继续说话→停止接话 | 42ms；不停止PCM上传 |
| 最终后台归档版本，声学结束→接话 | 1.727秒 |
| 同一最终样本，Codex完整校验回合 | 11.639秒（含线程恢复）；首delta后约400ms完成 |
| 同一最终样本，说完→正式回答首次声音 | 19.775秒；其中识别收尾约4.627秒、首次TTS约3.506秒 |
| 主服务真实未缓存流，HTTP首批/完整EOF | 1.730秒/2.800秒；重复缓存7ms（不是浏览器声音时延） |
| 官方OAuth独立模型探测 | gpt-6-luna warm4.189/4.004秒、cold9.088秒；5.6-luna warm1.802/4.891秒、cold9.026秒，未见稳定优势，保持原模型 |

以上是少量样本，不能视为稳定P50/P95；接话达到用户接受的两三秒体验，**正式回答未达到两三秒**。中间同步归档版本还曾测到说完18.736秒才播放，失败/慢样本均保留。最终样本的临时QA页关闭前未导出完整JSON，关键事件按已观察DOM时序单独转录并明确注明，未虚构新测量。

- Codex启动预热只准备连接/配置，不创建空聊天。9条辅助运行/基准记录已归档；正式内部线程每轮成功后后台归档，不删除历史，下轮解除归档并resume同一记录。下一轮、close/reset等待后台清理；归档失败保留pending并提示，不吞有效回复。官方协议无隐藏持久线程标志；恢复曾单独测到约2.95秒，不能把归档成本当作消失。
- 真实中文确认“对。”成功保存隔离兴趣，无额外Codex回合。一次“开始学习”连接超过5秒音频缓冲上限，明确停止并提示重试；证据保留。重启连接后真实定稿“开始学习。”成功返回原目的地，再点击进入apple认识页，中文与英文按顺序流式朗读，旧聊天字幕清除、最终控制台无error。此前M9的首次聊天→确认→语音开始直入学习全路径证据保留。
- 纠正合成测试脚本的文化设置：默认en-US曾使中文生成空WAV且退出0，属于harness故障；已显式zh-CN，并验证每段实际PCM峰值，空音频直接失败。没有把该故障记作产品识别错误。
- Codex内置浏览器实际返回NotAllowed，用户确认没有允许入口；网页新增只读浏览器授权/接口状态和Chrome/Edge/Windows设备指引。用户已在Chrome允许本机站点麦克风并确认“能听见小栗回应”。这是成人真实设备验证，儿童含糊发音、回声和音色偏好仍未验收；持续免点击监听不在本版范围。
- 最新`npm.cmd test` **161/161**、生产构建（含类型检查）通过；8787重启后真实Scribe自动定稿和未缓存TTS流通过，stt/tts/dialogue/codex均verified。主档案仍12词、0兴趣、0答题，活动会话ID保留；没有恢复备份或冲销用量。本地主账本估算0.160862元，非实际扣款；隔离账本另存，未充值或订阅。
- 证据：`artifacts/latency-final-pause3-timeline.json`、`latency-final-confirm-timeline.json`、`latency-final-background-archive-measurement.json`、`latency-final-start-connection-timeout.json`、`latency-final-start-retry-timeline.json`、`latency-final-start-and-learning-timeline.json`、`latency-final-learning.png`、`tts-stream-latency.json`、`voice-auto-smoke.json`及`latency-main-final-summary.json`。
- 收尾：602个源码/文档/任务日志/构建及服务日志文件未发现本机真实key；`.env`、`data`、`artifacts`继续忽略。临时5174/8788服务与QA页关闭，只保留8787正式服务和一个Chrome应用页；截图`artifacts/latency-main-ready.png`。另一个用户主动创建的进度聊天未动，不把它当辅助运行记录归档。

## 学词主线 MVP（2026-10-15，用户确认方案的实现与验收）
- 业务目标调整为家长指定单词的理解、听辨、看图主动回忆和跨天复习。首次/日常统一学词首页；兴趣聊天独立可选，任何阶段可返回，不依赖兴趣确认即可学习。
- 首页与后端共用纯函数选词：启用且图片批准的词、到期较早的复习优先、之后新词，保持每日上限、未完成会话恢复及1/3/7/14/30天规则。复用现有API/数据结构/备份版本，未改用户默认设置。
- 孩子结果页按本轮实际记录显示完成词数、听辨/看图回忆独立答对及跟练词数；家长空间新增默认“学习记录”，按词分技能显示独立答对天数/次数、提示后答对、跟练/体验和复习时间。独立答对不推断长期掌握，不提供发音评分。
- npm.cmd test：166/166通过；npm.cmd run build（含tsc --noEmit）通过。新增5项回归覆盖前后端选词一致、逾期顺序/去重/待审核与禁用排除、无兴趣学习与跨天恢复、提示/跟练不算独立答对、上海日期边界、分技能/分会话去重和复习状态。
- 隔离浏览器8791使用独立数据和明确未配置的外部服务，无儿童录音、无云端请求。完成apple/banana/cat三词：认识词→听音选图→看图选声音→看图回忆的跟练继续→一张贴纸。实际结果为听辨独立答对3词、看图独立说出0词、跟练3词；家长记录正确区分有提示答对与跟练，未标记掌握。
- 浏览器还验证错选停留同题、暂停/恢复、刷新后继续原词回忆步骤；未配置识别时点击麦克风真实提示，可跟练继续。可选聊天使用明确标识的代录演示，未确认提案直接返回，最终兴趣为空、onboardingCompleted=false，学习仍可完成。控制台无error。该过程不代表实际麦克风权限或儿童语音验收，M10已有的成人麦克风确认记录保留。
- 849px默认与390px窄屏布局检查通过，页面无横向溢出；家长大表格仅在自身区域内横向滚动，并有窄屏提示。修复窄屏角色气泡过窄换行。
- 隔离服务停止再启动后，profile/settings/packs/words/progress/attempts/activeSession/stickers逐项相同；浏览器仍可查看3词结果和1张贴纸，无重复发奖。
- 正式8787通过本项目停止/启动脚本重启，health与最新JS构建返回200；正式档案上述8项与本轮基线全部相同（12词、0兴趣、0答题、原活动会话保留）。原语音配置保留，识别/朗读重启后为unverified，Codex对话/生图为verified；本轮未重新请求云服务，不把模拟/历史请求作为当前进程的新验证。
- 证据：artifacts/learning-mvp-qa/中的tests.txt、results.png、parent-learning.png、parent-mobile.png、home-mobile.png、restart-check.json、main-preservation.json及正式档案前后快照。隔离测试数据不导入正式孩子档案。
- 尚需孩子本人在实际设备上试用，确认发音含糊、回声、长停顿、中英混说与音色偏好；既有M10的2–3秒正式回答目标仍单独待验收。

## 真实语音完整学词复核（2026-10-15 20:27）
- 用户要求重新使用真实语音检查听单词、看图说词与学习记录。本轮在独立档案完整跑完3词；使用Windows en-US合成语音注入真实前端录音处理，实际调用ElevenLabs TTS/Scribe，不录制房间或儿童声音，不把合成语音当真人体验。
- 复用显式QA入口，补齐apple/banana/cat英文样本；时序新增朗读locale、音频播放事件和答题字段。正式页面不载入QA脚本。本轮未修改学习判定、数据库结构或AI能力边界。
- 三个词第一次英文朗读均locale=en-US、mode=api、cached=false，真实浏览器出现playing和ended；播放约892/965/786ms。apple重播cached=true且正常结束。看图选声音实际逐个播放，目标声音与所选图片一致。以上验证播放和请求对应关系，不是儿童发音评分或音色偏好结论。
- apple独立回答：真实定稿Apple.；recall correct=true、hinted=false、practiceOnly=false、source=speech，回忆stage=1。
- banana先听提示后回答：真实定稿Banana.；correct=true、hinted=true、practiceOnly=false、source=speech，回忆stage=0、successes=0；家长页只显示提示后答对，不显示独立回忆。
- cat图下故意输入Apple.：真实定稿后页面提示重试，没有新增回忆答对或错误记录。随后点击跟练继续，仅保存correct=false、practiceOnly=true、source=click，回忆stage=0，不计独立答对。
- 最终9次尝试：每词2次听辨正确，听辨复习级别均只晋升至1；另3次回忆分别为独立、提示、跟练。完成3词、1张贴纸，结果页显示听辨独立答对3词、看图独立说出1词、跟练1词。家长表、现有汇总函数与实际API数据逐项一致；使用真实记录计算次日复习包含cat/banana/apple。
- 隔离语音进程于本轮启动，期间共享工作区有另一个任务更新服务端预热/端点代码；未覆盖这些模块。完整浏览器样本对应该隔离进程。源码更新后全套190/190和类型检查、构建通过；首次回归189/190的预热取消测试失败及随后单项/全套通过均保留证据，不把首次失败改写成通过。
- 正式8787重启到当前构建/服务端后，再做不写学习记录的真实接口冒烟：未缓存英文apple, banana, cat朗读返回41,421字节MP3；最新识别进程将固定英文样本定稿为Apple.。stt/tts/dialogue/codex状态均verified。该冒烟覆盖新进程接口，不等同于重新跑全部浏览器用例。
- 正式档案profile/settings/packs/words/progress/attempts/activeSession/stickers与本轮基线一致，仍12词、0兴趣、0答题、原活动会话。正式用量估算从0.160862至0.17254元；隔离估算0.10045元、144字符、21.283625秒。均为本地预算估算而非账单；费用记录未回滚，没有充值或升级。
- 证据目录：artifacts/learning-voice-live-20261015/，包含verification.json、current-main-smoke.json、各词learn/recall/sounds时序、cat-mismatch.json、parent-records.txt、parent-records.png、results-final.png、current-word-sample.mp3、tests-final.txt及正式档案前后快照。浏览器控制台无error。
- 尚未替代孩子本人实测：实际发音、背景回声、含糊表达、长停顿、中英混说和音色偏好仍待试用；不由本轮结论承诺2–3秒正式对话回复。

## M11 真正回答延迟定位与原生语音转向（2026-10-15）

- 历史19.775秒样本拆为识别4.627秒、Codex完整校验11.639秒、首次TTS约3.506秒。新时序记录真实PCM结束、识别定稿、Codex各阶段、TTS首批与浏览器播放；仅隔离诊断启用，不向正式儿童路径注入测试音频。
- Scribe改云端1秒分段与本地3.25秒连续实际静音保护重叠；只接受真实定稿且语音版本一致。3秒句中停顿后继续说话保留完整后半句；恢复声音至接话停止44ms。接话1.704秒与正式回答分别计时。
- 官方归档查询同一条记录默认thread/list约1472/1659ms，useStateDbOnly约1.1/1.2ms；新增DB快路径和未命中完整扫描。显式开麦时预恢复已有兼容线程，一轮预恢复441ms与录音重叠，实际turn线程准备0ms。页面探测不创建线程，准备有取消/60秒租约/实际回合接管和迟到保护。

| 真实API、合成麦克风 | 说完→正式回答首声 | 识别 | Codex完整校验 | TTS请求→首声 | TTS缓存 |
| --- | --- | --- | --- | --- | --- |
| gpt-6-luna 首轮 | 11.843秒 | 3.323秒 | 5.748秒 | 2.753秒 | 否 |
| gpt-6-luna 已有会话、3秒停顿 | 10.579秒 | 3.382秒 | 7.159秒 | 24ms | 是 |
| gpt-5.6-luna 首轮 | 13.280秒 | 3.312秒 | 7.253秒 | 2.704秒 | 否 |
| gpt-5.6-luna 已有会话、3秒停顿 | 7.104秒 | 3.372秒 | 3.701秒 | 23ms | 是 |
| gpt-5.6-luna 已有会话、新内容 | 15.591秒 | 3.799秒 | 6.140秒 | 5.641秒 | 否 |

- 7.104秒缓存样本不代表新回答稳定速度。相同账号模型对照存在明显云端波动；未修改正式.env模型，仍gpt-6-luna。未缓存模型最终自然语言，也未提前播放尚未校验的JSON片段。
- 首轮TTS首批到播放约65ms，主要等待在上游，不是浏览器仍等完整MP3。另用固定合成文字对比4次HTTP/WS，无握手WS首批约430/435ms（提前连接后等待11秒再发文字）；6次真实TTS探测用量独立结算保留。尚未将预连接WS接入生产，也不把该首批时间当完整回答速度。
- `npm.cmd test`190/190、`npm.cmd run check`和`npm.cmd run build`通过。首次189/190的归档失败重试断言曾失败，修复后完整复跑通过；不删除该失败记录。新回归覆盖准备租约/同源/过期取消/真实回合接管及停顿恢复，普通测试不发云请求。
- 原8788/5174由另一个用户任务占用，首次QA启动EADDRINUSE后明确改8789/5175，不结束其他进程。仅停止本轮明确拥有的QA进程并关闭其测试页；正式8787继续运行，其他任务自行管理其服务。新测试兴趣/答题在隔离档案，未恢复备份或擦除费用，未充值或升级。
- 用户最新要求“端到端语音”。已核对原生音频、连续会话/打断与服务端委托方案，实施清单见NATIVE_VOICE.md。当前未接入原生服务、未切换聊天分工、未申请新key或发送儿童音频；独立API额度与儿童项目数据条件待核实。旧链路改进不能当作原生语音交付，2–3秒有意义回答仍未达成。
- 证据：`artifacts/actual-reply-summary.json`及5份`actual-reply-*-timeline.json`；`artifacts/tts-transport-latency/results.json`与`preconnected-results.json`；`Work_Progress/2026-10-15/202427_luna_comparison/`及本轮任务日志。


## M12 单词发音模式（2026-10-15 21:00，当前交付）

- 用户明确暂不需要聊天，只要单词正常发音；停止原生语音方案实施。儿童端关闭聊天、兴趣访谈、语音指令和所有录音入口。服务端默认禁用chat，状态返回disabled，准备/生成/取消/重置返回409 CHAT_DISABLED，不探测或预热对话。旧适配器及其显式维护测试保留。
- 学习仅发出英文词条，locale=en-US、tone=clear，无情绪标签；认识词和听音阶段自动读词，喇叭与声音选项可重播。中文说明与反馈保留文字，不合成闲聊或奖励话语。现有ElevenLabs配置和英文清晰示范参数继续使用，未新增供应商/密钥、充值或升级。
- 回忆页保留自行说词与听音跟练，点击“我练习过啦”调用既有practiceRecall。隔离档案真实保存correct=false、practiceOnly=true、hinted=true、source=click；没有录音就不自动判定独立说出，旧独立答对记录保留。
- npm.cmd test为191/191通过；npm.cmd run build含类型检查通过。新增回归验证默认聊天不触发任何provider方法、chat接口关闭且零预算仍能读缓存单词，profile/attempts/progress/charges/sessions/stickers不变。初次新测试模拟文件放错目录，被媒体路径保护拒绝；修正fixture至speech目录后通过，没有放松保护。
- 独立8789/5175浏览器完成apple认识词→重播→听音选图→声音选项→自行跟练→下一词banana。6次播放均出现playing/ended，所有请求均为英文单词/en-US/clear；chat/WS/录音事件均0，识别秒数为0。apple首次真实未缓存请求至首声1074ms；重播请求至首声18ms（HTTP缓存返回9ms）。这是少量测试样本，不是稳定延迟承诺。
- banana真实云音频在本轮自动认识词生成，后续重播为缓存；cat另做真实未缓存英文合成，12164字节MP3、完整返回956ms。未把合成字节验证当作儿童本人音色偏好或发音评测。
- 正式8787按项目脚本重启后health为200，dialogue=disabled，apple缓存MP3为13418字节且可播放；浏览器打开原活动会话并显示听单词按钮，无聊天/录音入口，控制台无error。profile/settings/packs/words/progress/attempts/activeSession/stickers与本轮基线逐项一致，仍12词/0兴趣/0答题；本地主账估算0.17254元未变，不是实际扣款。隔离费用保留。
- 证据：artifacts/pronunciation-20261015/中的tests.txt、apple-timeline.json、learning-timeline.json、browser-summary.json、word-audio.json、isolated-state.json、verification.json、main-before.json、main-after.json及main-ready.png。本轮未请求识别或Codex对话、未采集儿童/房间音频；测试服务与测试页收尾关闭，只保留正式入口。


## M13 现有词表英文发音预缓存（2026-10-15 22:15）

- 当前词表12个不同英文词。apple/banana/cat已有缓存；dog/ball/car/sun/moon/fish/bird/jump/run缺失。经现有本机TTS接口生成9个，使用英文、clear、当前音色/模型/默认语速，与前端喇叭参数相同；未调用识别或Codex对话。
- 新增scripts/cache-word-audio.ts，默认仅检查；--apply顺序补缺、验证真实api模式/MP3和缓存重复命中，通过现有预算预留/结算。不扩大key权限，不自动重试、切换服务、充值或升级；失败时保留已经成功的缓存和真实用量。
- 真实生成后12/12文件接口cached=true、媒体MP3有效。再按前端实际/api/speech/tts/stream逐词复检，12/12为HTTP200、audio/mpeg、api、cached=true，完整读取3–8ms；复检前后usage完全一致。该数字是本机完整HTTP读取，不是浏览器实际首声或稳定延迟保证。
- profile/settings/packs/words/progress/attempts/activeSession/stickers逐项与基线一致，识别秒数保持61.6838125；TTS本地统计由174至206字符，预算估算0.17614至0.18894元，新增0.0128元为保守用量估算而非实际扣款。缓存重播未增加字符或费用。没有恢复备份或冲销记录。
- 沿用此前Free账户专用key及不充值设置，未操作套餐/支付。当前key读取订阅接口返回401，未扩大权限；Chrome页面控制连接超时，未把此问题当作产品错误，也不声称本轮读取到实时剩余额度。9次TTS均真实成功，未遇额度错误。
- 脚本--apply真实执行成功，默认只检查复跑显示12/12、缺失0；应用源码和服务未改，无需重启。没有为这项数据准备重复运行既有191项测试，历史通过结果不冒充本轮新结果。
- 证据：artifacts/word-audio-cache-20261015/中的audit.json、before.json、precache-1792073982530.json及verification.json；音频保存在忽略的data/speech/elevenlabs。README、MVP与任务树已更新。

## M14 每日任务与针对性复习（2026-10-15，当前交付）

- 新词完整走认识、听音选图、找声音、自行跟读；开启拼写时再加入拼写。旧词直接练到期技能，交替听音选图/找声音，不先展示完整认识页。口头输入关闭时，回忆跟练不计入待复习技能，不创建或修改测评进度；纯跟练的词之后可收到简短听辨检查。
- 以每任务约45秒折算时长预算，默认10分钟最多13步；该数字是题量估计，不是倒计时或实际时长保证。先放复习，再放能容纳完整流程的新词；到期词超过每日复习上限逐步减新词，达到两倍暂停新词。显式复习上限为0时尊重设置。1000词/500到期词的自动用例仍只安排受限任务。
- 新会话保存任务模式、步骤、检查点和任务上限。完成必须按词/步骤顺序，找声音须有单独证据，不能复用前一题听音记录；有提示或纯练习可完成任务，但不晋升为独立掌握。同日重复正确只晋升一次，奖励幂等；跨午夜以实际完成日期限制当日任务。修改词义使用学习版本，旧义历史保留、不进入新义统计；备份校验和恢复覆盖新字段。
- `npm.cmd test`最终220/220通过；正式`npm.cmd run build`含类型检查通过，与隔离验收构建的JS/CSS哈希一致。自动用例覆盖计划、积压分档、任务预算、步骤证据、进程重开、备份、词义版本、旧会话、跨天和前端恢复；测试模拟上游响应，不作为本轮云服务实测。
- 浏览器隔离档案：3分钟安排1新词/4步，完整完成至1张贴纸；听音故意答错后刷新回原题，再正确记录hinted=true且不晋升级别；找声音独立答对后可晋升听辨；自行跟读记录practiceOnly=true、correct=false，刷新保留已练状态且没有recall进度行。
- 浏览器次日只安排该词1个找声音复习任务，不重走认识/跟读；混合场景先2个旧词各1题，之后进入cat新词4步；积压6个到期词、复习上限3时只安排3旧词/3任务/0新词，完整结束后刷新只有“看看今日结果”。旧会话保持3词、1完成，暂停/刷新回第二词原听音题；把设置改成1新词/3分钟后仍不改写旧会话。
- 390px首页及听音页无横向页面溢出，文档宽375px（保留滚动条）；图片和喇叭可操作。全页截图会改变sticky反馈栏的捕获位置，最终听音证据使用正常视口截图。直接QA页采集到1条无来源URL的MutationObserver错误；项目源码无该调用，未据此判为产品错误。正式应用刷新、续学和点发音后控制台warn/error均为空。
- QA仅复制并核验既有12词真实MP3，所有外部适配器禁止调用；场景快照charges为空、deniedCalls为空。未请求识别、对话、图片或新TTS，不充值/升级。测试记录全部留在隔离目录，未导入正式档案。
- 正式8787已按项目脚本停止、构建、隐藏启动，health=200；刷新浏览器显示原会话“沿用原有安排”，继续为banana认识页，点喇叭可播放。重启前后profile/settings/packs/words/progress/attempts/activeSession/stickers/usage逐项一致：12词、4次答题、2项进度、原3词会话已完成1词。用量仍206字符/61.6838125识别秒、本地估算0.18894元，不是实际账单。默认缓存检查12/12、缺失0。
- 证据目录：`artifacts/adaptive-learning-20261015/`，包括tests-final.txt、browser-short-budget/mixed/backlog/legacy.json、mobile-home/listen.png、main-home.png、main-pre/post-restart.json、main-preservation.json及verification.json；隔离脚本为`scripts/adaptive-learning-qa.ts`。正式词表仍为开发示例，待家长提供；孩子本人持续使用、实际完成时长和回访意愿尚待验证。
