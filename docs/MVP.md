# 单词游乐园 MVP 规格

## 目标与完成边界
- 6–8 岁、中文母语、英语零基础；单孩、Windows 本机浏览器。
- 业务目标：帮助孩子学习家长指定的英语单词，通过练习与跨天复习检查记忆。核心成果为理解词义、听音辨认、看图主动回忆及跨天独立答对记录。
- 家长备课，孩子通过单词发音、大图卡和点击独立学习；默认新词上限3、复习上限6、预计10分钟。新词完整学、旧词只练到期技能，复习优先并按任务预算和积压自动减少新词。
- P0 包含词表与素材准备、直接学词入口、认识词与练习、分技能学习记录、跨天复习、孩子今日结果、家长逐词概览、恢复与备份。
- 当前语音仅保留英文单词发音与点击重播；停用聊天、兴趣访谈、语音指令和录音输入。角色奖励、家长生图与可选拼写保留，图片先由家长审核，拼写默认关闭。
- 不包含公开部署、多用户账号、开放闲聊、自动发音评分、手机跨设备同步。语音识别不能冒充发音评测。

## 首次入口与学习闭环
- 首次和再次打开均进入学词首页，突出今日安排与“开始学词”；有未完成会话时显示“继续学词”，点击后恢复词和步骤，学习不依赖兴趣或 onboardingCompleted。
- 儿童路径：学词首页 → 恢复未完成练习，或到期复习优先 → 新词 → 听音选图/看图选声音/看图说词 → 今日结果与贴纸 → 之后跨天复习。
- 当前没有聊天或兴趣访谈入口；保留既有兴趣数据，不新增未确认事实。英文示范只读单词本身，中文提示显示在界面。
- 未配置或语音失败时显示真实提示，点击学习与跟练继续始终可用；跟练不计独立答对。可选聊天的成人代录保留，不制造识别成功。
- OAuth Codex仅保留家长生图能力；学词和单词发音不依赖对话。回忆页无录音时只记跟练，不计独立答对。

家长备课：导入词表 → 按确认兴趣准备图片/语音 → 家长确认 → 启用词表。
- 儿童不会因网络、麦克风或识别失败被判错；点击操作始终可用。
- 听辨、主动回忆、拼写分开记录；有提示和纯体验不晋级；复习间隔 1/3/7/14/30 天。
- 同一题的干扰图片保持相近风格，选项位置随机；不使用倒计时惩罚和连续签到损失。
- 图片与音频先备课缓存，儿童学习时不等待图片生成。
- 家长学习记录按词展示听辨、看图回忆、可选拼写的尝试与独立答对，并单列有提示答对、跟练/体验及到期时间；记录由现有数据计算，不推断掌握分数。“跨天独立答对”仅表示同一技能在多个日期有独立答对记录。

## 当前发音模式（2026-10-15 21:00）
- 当前正式默认聊天关闭，/api/chat/status返回disabled；对话生成/准备/取消/重置接口返回CHAT_DISABLED，不探测或预热对话。旧适配器只为维护与显式测试保留。
- UI同时关闭语音输入，孩子点击喇叭听英文单词；不需要新的语音API或充值，TTS继续使用现有本机密钥、清晰英文和音频缓存。
- 现有词表12个英文词已预生成缓存。维护脚本scripts/cache-word-audio.ts默认只检查，--apply仅补缺失项，通过同一本机TTS预算路径生成，失败即停止；12/12真实流式重播命中缓存，不新增合成用量。新词表或发音配置变化后可手动再运行。
- 跟读完成记practiceOnly，提示后不晋级。既有兴趣、单词、进度和费用不清空。

## 历史接入与事实边界（以下M6–M11记录已被当前发音模式覆盖）
- 当前已实现职责：语音输入 API 做流式 ASR（声音转文字），OAuth 登录的 Codex 理解、生成回复、提出图片与任务决策，TTS 负责朗读。用户最新要求原生端到端语音，候选为语音模型聊天、Codex 执行与生图；分工及服务条件待确认，现有运行路径尚未切换，详见 NATIVE_VOICE.md。
- 本地服务管理会话、取消、预算和任务白名单，只把定稿转写提交给 Codex；切换学习卡、记录已确认兴趣等操作经过应用校验，图片继续先审核。
- Codex 生图、连续对话与受控应用动作已接通；ElevenLabs Scribe 流式 ASR、按句 TTS 和打断处理已实现。固定合成语音的真实接口闭环通过；真人儿童体验单独验收。
- Azure Speech API：TTS 普通话/美式英语，STT 对应 zh-CN/en-US；缺少密钥时明确显示未配置，可使用本机朗读演示与点击学习，不伪造识别结果。
- Codex：通过官方 CLI/App Server 账号状态与 OAuth 流程接入；只在独立素材任务目录生成图片，不读取或暴露 auth.json。用真实图片生成验证能力后再标记可用；失败不切换付费图片 API。
- 所有生成图片先待确认；家长启用后进入儿童词表。缓存键覆盖英文、中文义项、兴趣与画风版本。
- API 预算默认 30 元/月，按保守可配置单价预留并记账；界面标明估算，Codex 订阅额度独立。
- 凭据只在服务端 .env/环境变量；儿童录音默认不落盘，仅处理请求期间保留。

## 儿童语音与新版视觉要求（2026-10-15）
- 当前默认 ElevenLabs Scribe v2 Realtime 输入、Codex OAuth 理解与任务、ElevenLabs v4 Turbo 朗读；识别和朗读共用服务端专用密钥。使用 Free 可用额度，不充值或自动升级；旧 Soniox 仅显式备选，未有本项目儿童对比实测，不宣称识别最准。
- 区分发音含糊与意思不完整。前者请重说，后者由 Codex 根据当前任务作一次简短澄清；不直接猜测并写入兴趣或掌握记录。
- 点麦克风立即在内存采集并连接云端；连接前缓存上限约5秒，失败/取消清除；朗读与录音不能相互复活。当前打断需要点击麦克风，不持续监听。
- 允许儿童慢说、重复、长停顿；识别器分段不等于对话结束，保留手动“说完啦”。语气好奇、温暖、有起伏；单词示范清晰，鼓励简短，避免持续夸张或空泛表扬。
- 新版参考 Duolingo ABC 的单任务操作、Khan Academy Kids 的角色引导、Lingokids 的活力视觉；只借鉴原则，使用原创角色与素材。
- 明亮奶白、蓝、橙、浅黄，深色正文；大尺寸3D小栗、简短大气泡、明显麦克风。儿童主体文字20px起、按钮文字14px起、触控目标48px起，支持窄屏与减少动态效果。
- 首次直接进入学词首页；可选兴趣聊天仍采用开放提问，不恢复预设分类。成人配置进入次级帮助，真实服务状态与点击兜底保留。
- 官方参考：[Duolingo ABC](https://abc.duolingo.com/how-we-teach)、[Khan Academy Kids](https://www.khanacademy.org/kids)、[Lingokids](https://lingokids.com/)、[Soniox 断句](https://soniox.com/docs/stt/rt/endpoint-detection)、[ElevenLabs 模型](https://elevenlabs.io/docs/overview/models)。素材提示词：`docs/xiaoli-3d-v1.prompt.txt`。

## 接口合同
数据形状以 shared/contracts.ts 为准；服务统一返回 JSON，失败为 {error,code?}。

| 路径 | 请求与用途 |
| --- | --- |
| GET /api/state | 完整 AppState；状态探测不触发登录或生成 |
| POST /api/profile | {nickname?,interests?,onboardingCompleted?} |
| PATCH /api/settings | 部分 Settings |
| POST /api/import/preview | {text} → {rows:ImportRow[],errors:string[]} |
| POST /api/packs | {title,rows:ImportRow[]} → 更新 AppState |
| PATCH /api/packs/:id | {enabled:boolean} |
| PATCH /api/words/:id | {term?,meaning?,assetStatus?}，批准仅接受本地可用图片 |
| POST /api/words/:id/illustrate | 创建 IllustrationJob，后台执行；只由家长触发 |
| GET /api/jobs | {jobs:IllustrationJob[]} |
| POST /api/jobs/:id/cancel | 取消尚未完成任务 |
| POST /api/session/start | 生成或恢复 LearningSession；仅选择已启用、已批准词 |
| POST /api/attempts | LearningAttempt（id/createdAt 可由服务端生成） |
| PATCH /api/session | 新会话用{completedStep:{wordId,step}}按计划顺序和答题证据完成，最后一步自动完成词；complete发奖幂等；旧无tasks会话兼容completedWordId |
| POST /api/speech/tts | {text,locale:'zh-CN'|'en-US',rate?} → SpeechResponse |
| POST /api/speech/tts/stream | 与完整TTS相同请求（含tone），成功为audio/mpeg流及X-TTS-Mode/X-TTS-Cached；失败在音频开始前返回安全JSON |
| POST /api/speech/stt?locale=zh-CN | 16kHz 16bit 单声道 WAV 二进制 → RecognitionResponse |
| POST /api/integrations/codex/connect | 家长主动开始官方登录，返回授权链接/状态 |
| GET /api/backup | 包含词表、进度和本地素材的备份，不含凭据 |
| POST /api/restore | 导入备份；导入前保留旧副本 |
| GET /api/health | 服务健康 |
| WS /api/voice/stream | 同源本机流式识别；start/16kHz mono s16 PCM/finish/cancel，服务端保管 ElevenLabs key |
| POST /api/chat/turn（当前关闭） | ChatTurnRequest → SSE ChatStreamEvent，完整校验后返回短回复和动作提案 |
| POST /api/chat/prepare | {preparationId,conversationId?}；仅显式开麦准备已存在且兼容的自有对话，不生成回复或建立空线程 |
| POST /api/chat/prepare/cancel | {preparationId}；释放对应准备租约，不取消已接管的真实回合 |
| POST /api/chat/cancel | 中断当前 Codex 回合，不执行过期动作 |
| POST /api/chat/reset | 重新开始当前对话，不修改学习记录 |
| GET /api/chat/status | OAuth 对话连接与真实验证状态，区别于图片生成状态 |

## 集成模块边界
server/integrations/index.ts 提供：
- probeIntegrations(): Promise<IntegrationStatus>
- synthesizeSpeech({text,locale,rate?,dataDir}): Promise<{filePath?:string,mode:'api'|'local',cached:boolean,costCny:number,message?:string}>
- transcribeSpeech({audio:Buffer,locale}): Promise<{transcript:string,status:'recognized'|'unclear'|'unavailable',costCny:number,message?:string}>
- generateIllustration({jobId,term,meaning,interests:string[],outputDir,signal?}): Promise<{filePath:string}>
- beginCodexLogin(): Promise<{status:string,authUrl?:string,message:string}>
- estimateTtsCost(text:string):number；estimateSttCost(seconds:number):number。
- getCachedSpeech({text,locale,rate?,dataDir}): Promise<string|undefined>；先查已生成音频，使预算耗尽后仍可播放缓存。
外部服务失败抛出带 code 的 Error；不得返回伪造成功。后端负责预算预留、作业状态与媒体 URL 映射。

## 验收
- 首次无兴趣即可开始学词；无聊天、语音指令和录音入口，有未完成会话优先恢复。
- 演示词表可完成一轮，儿童路径无需输入文字；刷新与重启保留进度。
- 听辨/回忆/拼写与提示记录正确，跨天复习与奖励幂等。
- 孩子今日结果与家长逐词记录使用真实答题数据；跟练、提示、独立答对和跨天独立答对能区分，未练习不显示掌握。
- 导入重复词、歧义义项、坏 CSV、空词表有明确反馈。
- Codex/OAuth、TTS/STT 分别显示已验证、未配置或失败，不把代码接好记成云服务已验证。
- 缺密钥、断网、无声、权限拒绝、超时、超预算可恢复；不泄露密钥。
- npm run build、npm test 及浏览器主流程通过。

## 连续语音实施状态（2026-10-15）
- ElevenLabs Scribe 实时代理、前端 PCM 录音/字幕/定稿/打断、ElevenLabs 按句合成缓存和分服务状态已实现。已安全保存专用识别/朗读 key，Voice Design 创建“小栗 Xiaoli - 温暖欢快女声”；真实固定合成句 STT → Codex → TTS、自动静音定稿和英文示范通过。没有上传儿童录音，儿童体验不能用合成句代替。
- Codex 使用官方 stdio app-server 与既有 OAuth；text-only 线程只提案，应用校验白名单后执行。兴趣保留原话并确认；下一题不绕过答题门槛，图片请求仍须家长准备/审核。
- 对话支持跨进程恢复和取消。已用固定测试句真实验证首回合、关闭进程恢复及浏览器刷新恢复；测试兴趣没有写入孩子档案。对话元数据不进入当前学习备份。
- 语音连接仅本机同源，一个麦克风、45秒绝对截止、音频字节限制、握手取消、未知费用预留和已知用量结算均有回归覆盖。最新验收以 docs/ACCEPTANCE.md 为准。

## M9 端到端修复边界（2026-10-15）
- 真实API、合成麦克风、隔离档案验证语音兴趣、2/3秒句中停顿、显式确认、语音开始和学习答题。真人儿童发音、硬件回声和语气喜好仍须实际体验。
- 确认/开始等确定性界面动作经本地严格校验；“我还没想好”不会误确认。未知表达不写兴趣，需重新确认。
- 对话模型使用本机已验证的gpt-6-luna；模型切换令旧对话失效；兴趣页只发送学习可用性与已批准词数，学习页保留必要词汇上下文。
- 备份恢复合并费用记录并保留本机已存在项；测试用量不得通过恢复旧备份擦除。

## M10 响应与会话边界（2026-10-15）
- 用户接受先自然接话、随后正式回答。兴趣自由表达阶段先准备固定女声“嗯，我在听。”，实际安静约1.6秒可播放；不终止录音、不确认兴趣、不伪装理解。孩子恢复说话立即停播，同次录音最多两次，持续新语音后才可重新触发。
- 真实TTS通过同源HTTP流与浏览器MediaSource边收边播；不支持时兼容完整音频。仅完整成功MP3进入缓存，中断即取消供应商请求，未知费用保留预留；缓存和合成共享同一请求所有权，避免重复预留。
- Codex仍是唯一对话大脑，完整schema/本轮原话/权限校验之后才朗读及执行。连接预热不建立线程；每轮回复返回后后台归档内部持久线程，下轮解除归档并恢复历史，下一轮/关闭/重置须等待清理完成。
- Chrome真实麦克风已获用户确认可用；内置浏览器NotAllowed问题以宿主权限处理，网页只提供只读诊断与Chrome/Edge操作指引。儿童实际含糊表达、回声和音色偏好仍须试用。
- 计时从实际PCM声学结束算起，短接话与Codex正式声音分别记录。本轮接话约1.7秒，最终正式声音19.775秒；未宣称两三秒完整回答，详细真实样本见docs/ACCEPTANCE.md。

## M11 延迟定位与原生语音边界（2026-10-15）
- 已有对话在显式开麦时并行恢复；页面探测仅准备连接/配置。准备租约60秒失效，按ID取消和回合接管隔离；取消过期准备不打断实际回合。官方归档查询优先useStateDbOnly，未命中仍走完整官方扫描。
- Scribe云端1秒分段与本地3.25秒实际PCM静音保护重叠，真实定稿且语音版本一致才结束；临时字幕不能充当最终结果。保留3秒停顿、手动结束、45秒硬限与取消。
- 仅显式隔离诊断启用SSE timing事件，含阶段和耗时，不向正式儿童界面暴露协议细节或凭据。计时区分录音实际声学结束、识别定稿、Codex校验完成、TTS首批与真实播放。
- 190/190自动测试与构建通过，5轮真实API合成麦克风样本已留档；未缓存新回复11.843/13.280/15.591秒，2–3秒目标未达成。未切换正式模型或接入原生语音API。


## M14 每日任务与针对性复习（2026-10-15）

- 同一dailyLearningPlan用于首页和服务端，筛选已启用且图片批准的词。现阶段只有听辨、可选拼写参与客观复习；已关闭的口头识别不触发自动口头测评。
- 新词完整steps为learn/listen/sound/recall，启用拼写且为字母单词时再加spell。复习词只包含已到期技能：听辨在listen/sound间变化，拼写仅在启用且到期时加入；不先展示答案。
- 小任务上限为floor(sessionMinutes*60/45)，每步45秒是初始题量估算，不是学习效率结论或强制作答时间。先安排不超过复习上限的旧词，再放得下的完整新词；不会为凑数截断新词流程。
- 到期词数量不超过复习上限时保留配置的新词上限；超过后按floor(新词上限*(2*复习上限-到期词数)/复习上限)减量，最低0，达到两倍暂停新词。家长显式关闭复习（上限0）时不应用积压减量，但仍有总任务预算。
- 新会话持久化tasks、completedSteps、taskLimit、estimatedMinutes，刷新/重启/备份按服务器计划恢复；每步对应同会话/词/题型的正确或练习证据，有提示可完成但不晋级。listen答案不能充当sound证据；重复提交不重复推进或发奖。
- 旧无tasks会话保留原词序和完成合同，不在中途重新排题。跨夜完成按完成日期计入当天，避免同日再开新任务。
- practiceOnly仅保存参与记录，不创建或修改SkillProgress。历史纯跟练进度保留但不当测评；只有练习、尚无听辨进度的词，根据最近尝试在至少一天后派生一项听辨检查，不虚构熟练程度。
- 编辑词义通过learningResetAt/learningVersion重置当前学习语义，旧尝试保留为历史，当前排程与同日晋级只使用当前版本；固定时间或同毫秒操作也可区分。
- 语音仍仅英文词条、clear与已有缓存，不恢复聊天、录音或发音评分。不会为本轮调度测试请求新语音/生图服务或充值。
