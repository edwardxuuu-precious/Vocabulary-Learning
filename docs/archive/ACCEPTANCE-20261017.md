# MVP 验收记录

## 儿童自主挑战、Codex初判与家长集中核验（2026-10-17）

- 当前完成页“挑战测试”免PIN，自动选本轮最多5词20项，儿童准备页不提前给中英答案；录音保存/重录、暂停、刷新与整轮提交均自主完成。家长空间保留30分钟授权的集中回听/版本化批量核验、失败阶段重试与旧现场测试。
- 类型检查、401/401全量测试、生产构建与git diff --check通过。新增9组挑战测试覆盖无PIN与受保护接口、首次选择/替换/空录音/题序/冻结/幂等、AI不晋级与预算、部分核验、跨天补核/同日限制/改判、失败补缺/重启/迟到结果、旧义项/原音删除失败重试/备份兼容、免费额度/认证/协议/工具拒绝。测试替身不当作云端验证。
- 隔离8798浏览器使用Windows离线合成成人声音及明确标识的转写/Codex测试替身，实际完成5词20项、15段录音、提交前重录；第二题暂停刷新免PIN恢复，提交后离开/刷新可找回。后台15次模拟转写、1次整轮初判；家长核验前仅5条选图正式成绩、口头0条，核验15项后共20条；15段原音全部删除，转写/AI建议/结论保留，模拟账本0笔费用。
- 另用独立第六词的合成历史验证到期复测仅1词1项朗读并完成提交。390×844与1280×800截图尺寸已核实，390px的clientWidth/scrollWidth均390；浏览器控制台无错误。刷新后的自动播放被浏览器手势限制时可点“再听提示”，播放完成才可录音，失败仍可跳过。
- 真实云端冒烟单独使用固定成人合成apple：Scribe v2官方文件接口识别出apple，独立受限Codex适配器返回1项matched结构化建议。请求前确认Free且关闭超额计费、Codex官方ChatGPT登录及限额，未充值/升级/切换服务；STT本机预算估算0.001051元，使用免费包含额度。此结果不代表儿童真实口音或发音质量验证。
- 正式8787更新前确认图片/发音队列空闲并校验当前构建素材；重启后health=ok，原SQLite全部15个字段哈希一致（17词、13条旧尝试、0正式测评、61笔原用量），未写正式孩子测试成绩。当前生产资源：index-D-w4gi0g.js / index-IxBVUc01.css。
- 证据：`artifacts/challenge-qa-83bac7a8-7f25-4dfb-95a9-2c7a8225e3c7/verification.json`、before-review.json、after-review.json、cloud-smoke.json、mobile-review-390.png、mobile-weak-reading-390.png、desktop-reading-1280.png；检查日志为`artifacts/challenge-{check,tests,build}.log`，正式数据对比为`artifacts/challenge-rollout-{before,after}.json`。
- 待核验原音只在私有本机目录；不进公共素材、Git、日志或常规备份。恢复备份缺原音的未核验题须重测。沿用现有密钥/官方登录；配置权限见README。后续仅需家庭实际麦克风和儿童日常使用反馈，不宣称已验证儿童识别准确率。


验收环境：Windows / Node.js 24 / 本机 IAB 浏览器。以下按阶段保留证据，三遍本地录音跟读的最新验收见文末（2026-10-17）；此前入口、配置、会话及测试数量仅为各阶段快照。

## 2026-10-17 独立测评体验入口

- 新增专用体验构建和8799本机入口，复用真实AssessmentCenter组件；示例档案持续标识，6个已学示例词、默认5词20项，不进入正式导航、不改正式PIN与数据目录。启动命令见README，服务在本轮会话保留供家长试用。
- 浏览器实际完成5词20项（1项合成“需要练习”、19项合成独立答对），暂停刷新恢复至第2题；核对20条报告并点击真实既有dog缓存。模拟下一天后成功进入20项到期复测；最后点击清空体验，审计确认测评/尝试/进度均0、时间回当天。口头判定只为显式示例，不代表儿童真实能力。
- 手机窄屏口头题及欢迎页无横向溢出（截图375px宽），恢复默认视口后欢迎页与开始按钮可见，页面已保留打开。跨源清空/切日请求均403；所有外部适配器调用计数空、费用0。正式8787的profile/settings/packs/words/progress/attempts/四项测评数组/activeSession/stickers/usage共13项JSON与本轮前相同。
- 类型检查、368/368全量测试、正式构建及最终独立体验构建通过。证据：`artifacts/assessment-experience-delivery-20261017/`中的verification.json、completed-audit.json、reset-audit.json、welcome.jpg、mobile-welcome.jpg及检查日志。体验只复用本机既有MP3，不充值、不合成新声音；真人使用效果待家长体验。

## 看、读、双向翻译独立测试与弱项复习（2026-10-17）

- 学完及家长学习记录均可发起1–5词测试；5词20项依次中译英、朗读、英译中、看英文选图。口头题由家长确认，选图由服务端判首次选择；整轮结束展示结果与缓存示范，进行中的测试结果不在报告中提前公布。提示、未确认、错误、跳过、选项不足均保留真实状态，不制造发音分数。
- `npm.cmd run check`、354/354自动测试、最终`npm.cmd run build`与`git diff --check`通过。10项新专项覆盖题量/分组/版本、首次判题/幂等/来源、1/3/7/14/30天与同日限制、未确认待测、弱项预算/旧会话冻结、备份检查点/证据与进度重放、30分钟PIN授权过期/撤销/改PIN/恢复后失效、同源和缺缓存不调用云端。
- 隔离8796真实浏览器完成5词20项；第3题暂停、刷新后重新输入测试PIN，恢复到相同题目。完成后到期复测只包含另一个词的朗读1项。390×844口头题、选图题及结果页无横向溢出，1280×800朗读题布局通过；截图PNG尺寸单独校验。
- 隔离切到下一天后，儿童完成中译英联想、先读后听、英文词义选图及看英文选图4项练习。新增4条参与记录，测试进度/级别/复测日期逐项相同；本轮13/13步预算，无新词超量。练习后整个隔离备份验证通过。
- 全部缓存播放复用既有MP3，隔离云接口调用与费用记录均0；没有采集测试录音、启用云端识别、充值或新增密钥。正式8787在确认素材任务空闲后更新；更新前后15项存储字段哈希完全一致，17词、13条原学习尝试、2个会话、61条既有用量及0条正式测试保留。健康接口与新JS/CSS为HTTP200，未授权测试接口返回403 ASSESSMENT_AUTH_REQUIRED。
- 证据：`artifacts/assessment-qa-4bdc24f3-1d99-4dd2-ac5b-82fb5942d58f/verification.json`、前后练习审计及4张截图；`artifacts/assessment-{check,tests,build}.log`、`artifacts/assessment-rollout-{before,after}.json`。后续浏览器重新连接被URL策略拒绝，未绕过；界面结论来自此前已完成操作与保存截图。儿童本人效果和家长判定一致性仍需实际体验。

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

## M15 家长指定词表与预缓存（2026-10-16，当前交付）

- UI/Core/Integrations分模块完成后总控集成。`npm.cmd test`最终255/255通过，`npm.cmd run build`含类型检查通过，正式8787已启动。新增覆盖默认示例退出、迁移挂起不丢记录、解析混合输入、HTTP确认/启用门槛、缓存并发owner、取消、重启、配置/预算/配额错误、内容变化、前端预览失效与唯一选项不算掌握。
- 隔离8792浏览器：首页0正式词，入口“请家长准备词表”直达家长PIN和词书工坊；重复apple/Apple被拦，编辑后确认按钮消失。混合空格/中文逗号/tab输入apple/cat/dog，确认后仅3正式词保存，发音3/3缓存、图片3/3复用，显式“给孩子学习”回首页，学习会话和听音干扰项仅这3词、不含12词示例。实际喇叭使用此前真实生成的MP3。
- 另建隔离book书，显示发音0/1、图片0/1、未配置错误、词表保留和补缺入口；启用按钮不可用。点图片准备只显示该书1词；占位图显示“等待一张新插画/待准备/生成插画”，没有冒充内置图或可批准。刷新后两书及原学习状态保留。390px文档宽375px，无横向溢出。
- 浏览器QA删除继承密钥变量、抑制.env加载、注入所有外部适配器并封锁外网；只复制已有12词MP3，最终charges=[]、denied={}。语音新生成/配额失败、前台共享请求等用真实provider实现加fake-fetch自动测试，不作为本轮真实供应商额度查询或新生成的实测。最初旧core-api fixture未完整mock新预缓存依赖，可能打开临时目录上游请求，无法确认；已修正ttsStatus/synthesize mocks，后续全套与浏览器完全隔离，未把未知情况写成零调用。
- 正式档案从SQLite只读基线比对：profile/settings/words/progress/attempts/stickers/jobs/charges逐项相同，仍4尝试、55笔用量，206TTS字符/61.6838125历史识别秒、本地估算0.18894元。仅starter标isSample并停用，旧活动会话只增加suspendedAt；剔除此字段后原会话逐项相同，无伪完成和奖励。无正式词表、无测试词导入，尚待家长提供指定词表。未充值、订阅升级或扩大密钥权限。
- 正式状态默认dialogue disabled，家长工作台无麦克风；界面warn/error为空。维护脚本默认只检查正式词表，返回0词；显式--include-samples返回12/12缓存。当前页面已留在正式词书工坊待粘贴，测试页和8792进程关闭，只保留正式8787。
- 证据：`artifacts/parent-import-20261016/`的tests-final.txt、confirmed-ready.png、mobile-workbench.png、main-workbench.png、qa-confirmed-learning.json、qa-final.json、qa-audio-*.json、main-before/after-data.json、main-preservation.json和verification.json；隔离脚本`scripts/parent-import-qa.ts`。孩子实际词表未知；新词图片生成和人工审核仍是必要步骤，既有Codex接入未在本轮再发生成请求。

## M16 自动图片准备与批量审核（2026-10-16，当前交付）

- UI/Core/集成安全与真实生图模块完成后总控集成。最终`npm.cmd test`279/279、`npm.cmd run build`含类型检查通过，正式JS/CSS与隔离验收构建一致。覆盖串行跨书队列、状态读取不生成、错误停止/显式补缺、已有生成任务等待、取消drain、配置探测阶段取消防迟到、图片/义项/版本原子审核、图片真正加载后可选、坏图清选、分页范围和重画清旧选择。
- 初次HTTP fixture使用SVG返回，被原媒体路径保护正确拒绝；改为PNG fixture，没有放松保护。另一项合法旧词的version undefined/0兼容失败已修复，当前二者仅按0等价，后续版本仍严格匹配。失败记录保留于tests-initial.txt，最终完整通过见tests-final.txt。
- 真实官方OAuth仅一次provider调用：book/书、无兴趣，35.763秒生成1254×1254 PNG，1,497,132字节；人工查看主体为一本清晰蓝色展开书、无文字或标识。生成前configured=true但unverified，真实结果与匹配的verification.json使正式重启后codex=verified。图位于`data/images/smoke-pack-auto-20261016-d195088b-5b65-4ed3-b2f4-0fb8b32a93f4/illustration.png`，安全metadata为smoke-result.json；未写正式Store作业或词表，imageJobs仍0不能误称没有调用。
- 沿用固定官方CLI0.162.1、ChatGPT OAuth、app-server内置生图、word_assets隔离目录和拒绝额外审批；最小环境剥离API密钥、禁用外部插件/命令，ephemeral线程没有创建持久侧栏会话。不读/复制auth.json，不改模型、全局CLI或权限范围，不请求付费图片API、不充值。
- 8793浏览器为明确标注的模拟图片编排：Pillow确定性QA图和此前真实MP3，完整stub服务、删除继承密钥、抑制.env加载、封锁外网。确认apple红苹果/ball玩具球后自动生成两张review，放大预览、本页全选2张；重画apple立即清成仅选ball，新图回来仍只选1，重新选择后原子批准2张，显式启用回儿童页，进入仅这2词的听音题。图片质量不以这些模拟图作为真实AI验收，真实book单图另列。
- 浏览器car测试首次模拟额度失败，书和发音保留，未继续无穷请求；手动补缺后review1。moon长任务点击停止后status=stopped、pending1，没有批准或发奖。最终图片调用轨迹apple/ball/apple/car/car/moon均为mock，浏览器charges为空、denied为空。小屏390px文档宽375px无横向溢出，两张512px图片真实加载，控制台warn/error为空。
- 正式8787停止→构建→隐藏启动，health200。重启前后profile/settings/packs/words/progress/attempts/activeSession/stickers/usage九项逐项相同，仍12示例、4尝试、无正式词表、无活动会话；55笔历史用量保留，预算估算0.18894元、206TTS字符、61.6838125历史识别秒未变。仅新增隔离真实book素材证据，既有示例保持disabled，聊天disabled，无录音入口。
- 正式页面留在家长词书工坊，可粘贴正式词表确认后自动备音图。测试图不进入孩子词表，家长尚未提供正式词表；实际批量生图速度随账户和云端变化，单次36秒不是稳定保证，额度以服务响应为准。已停止QA8793并关闭测试标签，保留正式8787。
- 证据：`artifacts/pack-images-20261016/`中tests-final.txt、batch-selected.png、mobile-image-review.png、main-workbench.png、qa-approved-learning.json、qa-final.json、qa-images-*.json、main-pre/post-restart.json、main-preservation.json和verification.json；隔离脚本`scripts/pack-images-qa.ts`。真实单图证据在上列data/images目录。

## 简洁双入口首页（2026-10-16）
- 首页仅应用名、原有小栗素材、孩子“开始玩”和“家长入口”；取消首屏计划统计、贴纸摘要、流程说明和示例词卡。参考Khan Academy Kids官方的少文字/角色引导原则与Pok Pok平静视觉，未使用参考作品资产。
- 隔离8792：初始只有2个按钮，孩子无词书时进入简短待备课页；返回首页后家长错误数字被阻止，2468进入词书工坊。粘贴apple/苹果、cat/猫、jump/跳跃，复用本地音图并显式启用后，“开始玩”进入正式学习；推进到听音题，回首页再开始恢复同一步。
- 布局：1280×720桌面、390×844手机首屏无横纵溢出，按钮触控高度分别为家长50/48px、孩子84/80px；支持减少动态效果。截图：`artifacts/entry-home-qa/home-desktop.png`、`home-mobile.png`。
- `npm.cmd test` 279/279，`npm.cmd run check`与`npm.cmd run build`通过。正式8787健康、生产首页实测只有2个按钮；档案profile/settings/packs/words/progress/attempts/activeSession/stickers/usage九项与本轮前完全一致。
- 验收词书仅在隔离目录，不写正式档案；隔离provider审计无外部调用，无新服务配置或充值。QA8792收尾停止，保留正式首页标签。

## 儿童学习页统一视觉（2026-10-16）
- 认识、听音选图、看图选音、跟练、可选拼字、暂停、结果页统一至首页奶油/蓝/鼠尾草绿风格。每页一句提示、大图片、大按钮，仅单条进度与词数；详细记录留在家长空间。当前只播英文单词，页面无聊天/麦克风/评分入口。
- 隔离8791使用已有真实MP3与本地示例图片，显式开启测试示例，未更改正式词表。完整三词12步骤：错选图片与声音、刷新后提示保留、正确选择、暂停继续、自行跟练、跟练完成后刷新、下一词、贴纸及重复查看结果；11条尝试、1张贴纸、回忆测评进度0，家长记录区分有提示与独立答对。
- 积压场景完整三词复习：每词仅一道到期声音题，0新词，完成后直接结果；合成历史明确属于测试。可选拼字完整五步，验证拼错、移除字母、提示、提交正确、刷新恢复apple和拿贴纸；另独立验证跳过只记practiceOnly、不创建拼字进度。
- 4份完整流程审计共49次en-US/clear单词缓存请求，全部命中，charges与deniedCalls均为空；无新云服务调用、充值或付费切换。证据：`artifacts/child-learning-qa/{fresh-complete,review-complete,spelling-complete,spelling-skip}.json`及`audio-audit-summary.json`。
- 桌面1280×720、手机390×844，单词主图350/278px、手机选图167.5px，主按钮74/70px、字母按钮59/54px。修正拼字矮窗口溢出（1280×650通过）、答对反馈串入旧蓝色面板及刷新丢失正确选项高亮。最终桌面听音页无溢出、正确高亮恢复为苹果。
- `npm.cmd test` 279/279；`npm.cmd run check`、`npm.cmd run build`通过。正式8787已重启，JS/CSS HTTP200；profile/settings/packs/words/progress/attempts/activeSession/stickers/usage九项与本轮前完全一致。正式无词表时仍进入备课提示，未启用12示例词；QA8791与测试页均收尾关闭。
- 截图在`artifacts/child-learning-qa/`：learn-desktop、learn-mobile、listen-desktop、listen-mobile、sound-mobile、practice-mobile、spell-desktop、spell-mobile、reward-desktop、reward-mobile；所有学习截图为隔离测试，不代表正式已导入词表。拼字截图早于最终反馈类名调整，最终样式去掉旧蓝色面板，听音截图已复核。

## 家长备课流程与视觉统一（2026-10-16）
- 家长空间统一奶油/蓝/鼠尾草绿与小栗角色，三导航为备课、学习记录、设置。取消统计卡与左右堆叠；未建词表直接粘贴，新建不展示旧词表切换器。检查与确认分步，确认后聚焦新词表；发音、图片各一张状态卡，按状态提供停止/补缺。内部切页保留未提交草稿，缓存未读完显示检查中。
- 审核页收起换词表入口，批量选择放到图片之后；图片批准后同页出现单独交付按钮。部分交付显示实际词数；已启用词表追加审核时明确提示加入孩子学习。批准快照、图片加载检查、改图清选与服务端音频门槛保留。
- 隔离8793完整三词流程：混合CSV/制表符/空格粘贴，错误拦截，预览返回修改后旧确认失效；确认后复用3/3既有MP3，2张本地模拟图待审。放大、选择本页、重画apple清掉其旧选择；批准后enabled仍false，再单独交付后孩子进入3词正式学习，示例未启用。截图/JSON见`artifacts/parent-flow-qa/`。
- 额度/中断/部分路径：car第一次模拟CODEX_RATE_LIMIT，保留cat已批准图；手动补缺仅重试car，部分交付后cat approved、car review。moon模拟长任务停止后回draft并保留词表及发音。已启用词表之后批准car时提示加入学习。所有图片均明确为本机测试PNG，provider mock_only；未调用真实OAuth、TTS或外网。
- 隔离8792以`--missing-audio=cat`刻意移除适配器缓存引用：图片已批准、发音失败，词表仍未启用，审核页“给孩子学习”禁用；切设置再回备课保留粘贴草稿和名字。两个隔离环境denied={}，估算费用0；不代表真实云额度探测。
- 手机390×844审核、放大、取消选择、批准、同词表返回与新建入口通过，scrollWidth=375（含15px纵向滚动条），无横向溢出；桌面1280×720粘贴首屏主按钮可见（QA横幅下bottom710px）。最终正式1122×884主按钮bottom675px；保留`parent-final.png`为实际本机页面。
- 最终构建再次复核新建单词词表→自动准备→审核后未启用→独立交付成功，证据`final-before-handoff.json`与`final-handed-off.json`。`npm.cmd test`279/279，类型检查及生产构建通过；正式JS/CSS均HTTP200。
- 正式8787已更新，profile/settings/packs/words/progress/attempts/activeSession/stickers/usage九项与本轮前完全一致。正式仍无家长提供的词表，未导入4本隔离测试词表，未充值或更改服务配置；QA8792/8793及临时页收尾，正式保留家长粘贴页。
# M20 英文单列与自动备课验收

- 自动化：287/287测试、类型检查和生产构建通过。新增英文/逗号/短语解析、严格结构化OAuth与无工具权限、21词分批失败后补缺、停止后晚响应丢弃、元数据备份/词义变更、确认门槛与图片说明传递；同中文义项不互作干扰项。
- 真实外部验证：`scripts/vocabulary-smoke.ts`仅请求一次官方Codex OAuth，apple/jump/light三词约11.0秒，得到苹果/名词、跳/动词、轻的/形容词，light有多义提示。任务ephemeral；没有创建正式词书、请求TTS/生图或使用API计费回退。
- 隔离UI：模拟词义建议/测试图片，已有MP3。英文三词→检查中文词性→修改jump使旧配图思路失效→仅补jump→确认→复用三词图音→查看图片→交给孩子→三词12步骤→贴纸。错误选择可重试，口头只记跟练；示例停用，charges=0，外网deny计数空。moon补全可停止且草稿保留；light多义提示和形容词在390×844可编辑，无横向溢出。
- 本机更新：正式8787健康，英文preview四词无须中文，原profile/settings/packs/words/progress/attempts/activeSession/stickers/usage逐项相同，仍无正式词书。浏览器停留新版英文粘贴入口；无充值、升级或新增语音费用。
- 证据：`artifacts/vocabulary-preparation-qa/`的oauth-result.json、browser-result.json、main-comparison.json、tests.log、mobile-preview.png与parent-english-final.png。真实词表的缺音/缺图生成仍按现有账号额度执行，失败保留并停止；没有把模拟素材当作本轮真实生图验证。
# M22 Q版变形金刚机械主题（2026-10-17）

- 用户明确选择变形金刚主题，并要求角色面部为机械结构。内置image_gen生成后按反馈编辑：擎天柱、大黄蜂、阿尔茜均保留Q版比例，改为窄青色光学镜/金属面罩，无拟人眼球、睫毛、嘴唇或笑脸；最终三图RGBA，完整保存在`public/assets/brand/*-mecha-v2.png`。先前拟人稿移至忽略的验收drafts，不被产品引用；完整提示词与参考见`docs/autobot-theme-assets.md`。
- 首页已改为探索浮岛基地、三角色同框、单一儿童主按钮和家长入口，适配宽/窄/矮屏CSS并提供减少动效规则；学习、等待、奖励和家长头像同步机械伙伴。离线React SSR确认恰好2个按钮、4个最终资源引用，无旧狐狸资源引用；这不代表浏览器视觉/点击验证。
- 单词prompt统一Q版变形金刚机械面部，限制最多一个小陪伴、无武器/文字，物品/动作/属性优先，不能把目标动物或食物改成机器人。新版确认显式传当前imageTheme，仅复用已批准且主题/词义/词性/场景相同的图；已有批准图不被覆盖，新图仍待家长审核。备份兼容imageTheme，过期主题409。
- 真实OAuth：`scripts/autobot-image-smoke.ts`一次apple资产请求44.2秒成功；目视确认大苹果为主体、小型大黄蜂机械面部、无英文文字。文件在`artifacts/autobot-cover-qa/oauth-word-image/illustration.png`，仅验收素材，未导入正式词书或批准。
- `npm.cmd test`289/289、类型检查与生产构建通过；HTTP200核对新JS/CSS及4个资源。正式8787已重启使用新生图规则；profile/settings/packs/words/progress/attempts/activeSession/stickers/usage九项语义相同，时间字符串仅归一化基线PowerShell的`.48Z`/`.480Z`格式，不修改数据。未充值、升级或新增TTS请求。
- 限制：用户报告已开启页面控制后，getTab和重置连接仍返回Work设置禁用本地浏览器。没有绕过限制、没有本轮浏览器截图或移动端现场验收；已通过应用工具排队打开新版首页。真实页面视觉和点击验收待页面控制恢复。证据目录`artifacts/autobot-cover-qa/`含SSR/HTTP/状态对比/测试/真实图结果。

# M24 首页一体场景重设计（2026-10-17）

- 根据用户截图反馈，取消浮岛背景与独立角色贴图组合；内置imagegen以现有机械头像为身份参考，将三位机甲、基地、地面接触阴影和反射统一绘制，另生成竖版重新构图。两张实际图片已人工目视核对，分别1536×1024、1086×1448；文件及完整提示词见`docs/home-courtyard-v3.md`。未充值、升级或调用付费API回退。
- 首页改为暖白底、横版左文右景，820px以下标题/竖图/按钮排列，contain保留人物全身。删除汽车人小队标签、粒子与独立角色定位，仅保留孩子开始、家长入口；主题ID、单词图片规则、家长审核门槛和学习功能未改。
- `npm.cmd run build`（含类型检查）通过；离线React SSR确认2按钮、1个响应式picture、两个正确素材地址，无旧角色叠放/标签，忙碌时仅禁用开始按钮。本机8787返回新JS/CSS和两张PNG均HTTP200，当前JS包含新资源且无旧标签；证据在`artifacts/home-courtyard-v3-qa/`。未重启服务或写入学习档案。
- 本轮getTab仍返回`Local browser use is disabled in Work settings`，无法取得实际页面截图或验证移动端布局/点击；未绕过限制。应用工具打开新版URL返回queued，不能当作已打开成功；可通过`http://127.0.0.1:8787/?theme=transformers-courtyard-v3`查看。

# M25 审核图片重画反馈（2026-10-17）

- 正式任务记录显示yellow/not此前只有初次生成，其他3词有同期重画；旧实现全局最多3项，错误只在列表上方，生成卡片从默认待审核筛选移除。没有历史HTTP日志证明用户当次请求的返回码；隔离回归已复现同时3项时第4项429/QUEUE_FULL、不新增任务不更改旧图，释放容量后显式重试成功，同词重复提交复用任务。
- 卡片直接显示提交/重画/错误原因，缺登录也显示原因；重画中的卡片保留原图，禁止审核旧图，移除全页提交锁定。成功读取状态后以单词实际状态为准，完成或停止后可再次操作；不自动重试、不扩大3项容量限制。
- 294/294自动测试通过（外部响应为模拟），生产构建含类型检查通过。离线React SSR核对重画卡片仍在列表、按钮禁用且标注重画、旧图保留、不能勾选审核、缺登录提示可见；本机8787新JS/CSS均HTTP200且包含新反馈。这不代表浏览器点击或布局验收；getTab仍被Work设置禁用。
- 正式实际OAuth重画yellow/not各一次，48/47秒完成且返回generated。人工目视yellow为大黄色气球、少量蓝色对比及小擎天柱；not为孩子拒绝蛋糕、小大黄蜂旁观，无英文答案。两词使用当前transformers-mecha-v2主题，状态review，待家长确认；新旧图片HTTP200。未自动批准或启用词表。
- profile/settings/packs/其他词/词义/progress/attempts/activeSession/stickers逐项相同；仅目标两词素材字段变化，imageJobs增加2，TTS/STT用量和本地估算费用相同，无充值或升级。证据在忽略目录`artifacts/redraw-qa/`，含完整测试日志、SSR、HTTP与result.json；正式服务未重启。

# M26 首页四周留白（2026-10-17）

- 用户实际截图显示固定3:2圆角场景居中、上下/左右外边距以及独立导航占位。取消卡片宽度/比例限制、外边距、圆角和阴影，首页与场景占满视口，导航覆盖场景。图片按高度等比、右侧对齐，左侧背景衔接；较窄横屏标题与按钮上移。窄屏或宽高比≤6:5使用竖版，完整展示人物。
- `npm.cmd run build`含类型检查通过。离线React SSR仍为2个入口，横竖切换条件正确；源码核对场景无卡片外边距，正式8787当前JS/CSS与两张图片HTTP200。没有新增生图或语音调用，未重启服务；证据`artifacts/home-fullbleed-qa/`。
- getTab仍返回Work禁用本地浏览器；没有本轮实际页面截图或不同尺寸现场布局验证，SSR和CSS检查不能替代现场视觉验收。

## 2026-10-17 家长入口 PIN
- 原公开固定码移除，首次由家长自设并重复确认6位PIN；之后隐藏输入，连续错误5次暂停30秒；修改需当前PIN，无儿童可点的重置入口。PIN只存服务端加盐哈希，不进入学习备份；本机重置命令只删除PIN。
- `npm.cmd run check`、293/293自动测试、最终生产构建与`git diff --check`通过；隔离8792浏览器验证首次设置界面、错误拦截、正确进入、设置修改入口、返回儿童首页重新上锁及390px布局。隔离档案无外部调用、无费用；首次保存/修改PIN的逻辑由隔离API测试覆盖，未代家长设置正式PIN。
- 正式8787已重启并显示首次设置，390px无横向溢出、两个输入均password且为空。17词、2本词书、4条答题保留；画像、设置、词书、进度、答题、会话、贴纸、用量逐项相同。一张原后台图片在09:18:31生成完成转待审核，早于09:18:55重启，保留新图且未批准；其余单词字段相同。
- 截图与前后状态：`artifacts/parent-pin-qa-20261017/`。仍需家长在正式网页自己设置PIN；云服务沿用原配置，本轮未触发新的音图生成或充值。

## 2026-10-17 make配图构图核验
- 原已批准图为1254×1254、2159370字节，PNG各块CRC与IEND校验通过；浏览器自然尺寸1254×1254、实际316×316、object-fit:contain、transform:none。顶部头盔/天线在原图已出框；不是下载不完整或页面二次裁切。
- 内置imagegen编辑生成`artifacts/word-image-framing-20261017/make-full-frame-v2.png`，1254×1254、1815863字节，PNG完整；人工检查头盔、天线、双手和纸船均在画内，保留原机甲与折纸语义。候选未进入正式词书，原已批准图URL/哈希/批准状态核对不变；未刷新正在学习的页面或重启正式服务。
- `shared/visual-theme.ts`新增主体完整入镜及10%安全边距，供之后新生成使用，待下次服务启动加载；不自动重画已有图。294/294测试、类型检查与生产构建通过；最终`git diff --check`通过。候选需家长确认后再替换。

## 三遍本地录音跟读（2026-10-17）
- “自己说一说”增加三遍录音：先播示范、再录音、点“说完啦”收好，逐遍回放，三遍后完成。静音不增加次数；权限拒绝、设备/播放错误可重试或跳过。暂停、后台与离页取消采集；本页已录片段在暂停时保留。
- 录音仅保留页面内存与blob URL，不上传、不落盘、不进备份。离页/刷新释放录音；已有练习恢复后仍可补做三遍。完成为source=speech、correct=false、practiceOnly=true；跳过为source=click，不新建或晋级回忆进度。
- 类型检查、生产构建、302/302测试通过；新增8项控制器测试覆盖三遍上限、并发点击、权限/示范/采集失败、迟到取消与回放资源回收。HTTP测试验证录音来源仍是练习且不创建回忆进度。
- IAB隔离合成麦克风经过真实AudioContext/MediaRecorder录成三份并回放，确认每遍后采集流为0；完成、静音、权限拒绝后跳过和录音中暂停均通过。未采集房间声音，未调用云识别。真实儿童麦克风和音量体验尚未验证。
- 完整隔离学习页完成认识、听图、选音、跟读跳过与刷新恢复。390×844下scrollWidth=390，录音操作在首屏；截图artifacts/follow-along-qa/lesson-390.png。正式8787首页与新JS均HTTP 200，bundle包含MediaRecorder；仅更新前端，未重启或向正式档案写入验收记录。
- 隔离组件夹具位于artifacts/follow-along-qa，使用既有apple缓存与合成声；正式素材和外部配置未改。无新增密钥、云调用或充值。

## 2026-10-17 完整配图采用与儿童大图
- 家长明确确认完整配图后，将make的imageUrl替换为`/media/images/parent-approved-make-20261017-fullframe/illustration.png`；1254×1254，SHA256与已展示候选一致，HTTP200。原图原路径与额外副本保留；本机审批记录保存在新图片目录。逐字段断言只改变这一个imageUrl，17词、13条答题、全部sessions/charges/设置等其余数据完全相同；正式8787已重启，新生图方形/安全边距规则已加载。
- 学习、跟练、声音题和拼字图统一1:1与contain，图片本身取消圆角遮罩，主图最大520px框；选图区域也增大。生图要求方形原图至少1024px、重要主体四周10%边距、头盔/天线/双手/道具完整，不自动重画其它图片。
- 302/302测试与生产构建含类型检查通过；隔离8794浏览器完整检查learn/listen/sound/recall/spell，未调用云服务或麦克风。最终认识页390×844图片320px、768×1024图片约314px、1280×720图片406px、1280×800图片486px；所有图片为contain与0圆角，四种尺寸无横向溢出、下一步按钮在屏幕内。手机声音题主图260px、跟练320px、拼字200px，仍保留自然页面滚动。
- 证据与桌面/手机截图在`artifacts/word-image-layout-20261017/`。正式当前会话已经完成，没有重置或新增学习任务；截图用隔离词表展示相同生产布局。正式首页已打开，原学习结果保留。

## 2026-10-17 首页 v4：小机甲与清晰主操作

- 根据用户要求，参考Khan Academy Kids官方的少文字/播放入口、Pok Pok的平静视觉，并以ASTRO BOT官方素材辅助探索氛围判断。内置imagegen生成4:3横版1448×1086、约9:16竖版941×1672；两图实际目视通过，机甲约占横版画高38%，在右侧同一平台落地，左半幅为可用控制区，脸为金属面罩与窄青色光学镜。无付费API回退、充值或升级。来源及完整提示词见`docs/home-courtyard-v4.md`。
- 主开始按钮290×88px，标题与按钮成组，家长入口改为底部较弱的锁图标按钮；横屏左下角、竖屏底部中央，点击仍走原PIN。去除header中的家长按钮；键盘先到儿童开始，busy仅禁用开始。正式词表、素材审核和学习功能不在本任务中改动。
- 生产构建含类型检查通过；离线React SSR核对2个入口、footer归属、按钮顺序、忙碌状态和新资源引用；正式8787新JS/CSS及两个PNG均HTTP200。13组离线裁切数学预检使用人工观察的保守人物范围，未出现按钮与人物相交或人物越界；这不是浏览器DOM或视觉验收。
- 本聊天getTab仍返回`Local browser use is disabled in Work settings`，未执行本轮页面截图、点击或现场响应式验收；没有绕过限制。证据目录`artifacts/home-v4-qa/`保存SSR、HTTP与裁切预检；服务未重启，没有请求新的单词图或语音。
- 最终311/311测试与生产构建通过，新JS/CSS及两张PNG再次HTTP200。构建中发现共享备份校验的unknown词ID类型错误，最小补充字符串守卫后通过；该处非字符串ID原本亦无法命中已验证的词ID集合，没有扩大导入写权限或改动其他游戏实现。
# 三种强化游戏验收（2026-10-17）

- 声音翻翻乐、基地补给、神秘传送门接入新会话；每组2–3个词先认识、混合辨认后再回想，替换原步骤，3词仍为12步。旧会话保留原安排，单词/有效选项不足退回基础练习。
- `npm.cmd run check`、`npm.cmd test`（313/313）、`npm.cmd run build`通过；11项新专项覆盖服务端判题、重试幂等、提示、缓存失败、末对练习、跨天、单词失效、备份与旧会话兼容、复习证据边界。
- 真实浏览器完成3词12步并获得1张贴纸；补给误选后刷新仍保留重试，翻牌答对后暂停恢复，末对只记练习，传送门揭晓刷新后保留答案与提示，跳过可继续。390×844、1280×720与1280×650检查无横向溢出，短屏通关按钮完整，浏览器错误日志为空。
- 11次播放请求全部命中已有MP3，费用记录0、禁用云接口调用0。此验收未证明任何新云服务可用，也未评价儿童真人发音。原录音跟读不参与新传送门流程。
- 正式8787在确认图片/发音任务空闲后重启，新游戏接口与构建资源HTTP核对通过；profile/settings/packs/words/progress/attempts/sessions/stickers/charges九项哈希全部保持。17词、13条尝试、2个历史/活动会话与60条既有用量均保留，未写正式测试词表。
- 证据：`artifacts/learning-games-20261017/verification.json`、`live-before.json`、`live-after.json`、测试日志与浏览器截图；独立体验：`http://127.0.0.1:8792/__qa/app`。儿童本人操作理解、时长与难度待用户体验。

## 2026-10-17 英文优先的认识单词页
- learn页DOM改为英文/中文词性/发音在先、完整图在后。桌面左词右图，最大1040px内容区、48px间距、300–360px图框；820px以下改为文字在上、280px图框在下。英文短词88–104px、窄屏64–76px，按容器和最长单词长度缩字，短语按词换行；词性去填色并与中文保持24px/20px，认识页引导20px/18px、头像44px。发音handler不变；没有新增API、数据字段或生图。
- 313/313现有测试、npm.cmd run check、最终生产构建和git diff --check通过。四词make/butterfly/refrigerator/make a paper boat × 1280×800/1280×720/768×1024/390×844共16组浏览器验收通过：全文可见、无横向溢出、图片contain且方形、下一步在屏幕内。make桌面102.4px/手机70.2px，refrigerator手机48.125px，短语手机56px并自然两行。
- 隔离验收只使用已有make MP3，自动播放和点击按钮两次正确命中缓存，无云服务调用或费用；其他长词配图为布局fixture，不代表正式语义素材。听辨页不显示英文答案，刷新后恢复listen。生产变更限定于learn JSX与追加.lesson-learn样式，其余题型逻辑与原样式未改。
- 正式profile/settings/packs/words/progress/attempts/activeSession/stickers/usage九项按等价时间戳核对相同：PowerShell前快照曾将480Z序列化成48Z，原始数据未改。正式8787的新JS/CSS均HTTP200，页面已刷新；未重启服务、修改词表/批准状态/进度或用量。
- 证据：`artifacts/word-first-qa-20261017/`，桌面`desktop-make.jpg`、手机`mobile-make.jpg`为相同生产布局的隔离示例。截图尺寸单独核验为1280×800与390×844；测试页关闭、临时视口恢复。

## 2026-10-17 首页 v5：机甲左移与常用家长按钮

- 内置imagegen对v4横竖场景做小幅左移编辑，保留三角色比例、机械脸、统一落地光影和完整身体；实际生成图目视与PNG尺寸通过（横1448×1086、竖941×1672），接入v5文件。旧文件保留，无充值、升级或付费API回退；最终路径和完整编辑提示词在`docs/home-courtyard-v5.md`。
- 家长入口从页角移到开始按钮下方，同一操作组同宽。改为蓝白填充、清晰描边、人物图标、方向箭头与18px文字“家长空间”，宽屏290×66px；短屏最小52px高。保留原openParent/PIN与aria-label“家长入口”，无新增流程；儿童开始仍为黄色较大按钮且键盘先到。
- 生产构建含类型检查通过，离线React SSR验证两入口/同组/键盘顺序/busy只禁用儿童按钮。16组离线裁切与按钮位置计算通过，包括矮横屏和小方形视口；该计算使用人工观察的保守人物范围，不是浏览器DOM或实际截图验收。当前8787新JS/CSS及两张PNG均HTTP200，JS包含v5资源和家长空间入口。
- 本聊天getTab仍被Work本地浏览器设置禁用，未做本轮现场点击或截图核验。证据目录`artifacts/home-v5-qa/`；没有请求单词图或语音，没有重启服务或写入学习数据。


## 2026-10-17 认识页分步自动讲解
- 取代静态左右两栏：先英文显示与朗读，再显示并朗读家长确认的中文释义，再读英文；随后显示完整批准图片，停留650ms后英文+同一中文释义复述，结束停在“玩一玩”。居中紧凑排列，英文层级最高；图片230–300px/窄屏280px，继续1:1 contain，不重新生图。
- 随时重听、箭头继续；语音失败停当前步，静音明确显示“声音已关闭”。暂停、家长门、切后台、离开、词义变化取消旧播放；重入/刷新从本词开头讲解，暂停恢复当前步。讲解与重听不写答题或掌握证据，进入游戏仍需显式点击。其他题型保留布局与无英文答案规则。
- 英文仅读已有缓存，中文使用现有ElevenLabs配置音色，首次成功后缓存；不使用系统声回退。服务端对新增中文合成强制校验免费方案、剩余额度、超额计费关闭，校验失败时在供应商合成及预算预留前停止。沿用原TTS路由，无新增持久化字段或词表变化。
- npm.cmd run check、328/328测试、npm.cmd run build通过。新增测试验证精确朗读顺序、缓存参数、失败/静音手动继续、取消竞态、重听、图片等待取消、禁止本机声回退、免费额度不足/未知/付费方案/超额计费拒绝、缓存离线重播和取消额度读取；既有流式HTTP测试同步提供免费方案模拟响应。
- 16组浏览器布局（make、butterfly、refrigerator、make a paper boat × 1280×800、1280×720、768×1024、390×844）全部无文字截断/横向溢出、图片完整、下一步可见。720高桌面的双行短语缩至72px；手机长词48.125px、短语56px。浏览器确认初始无释义/图片、自动顺序、暂停恢复、重听、失败停释义且可继续、离开取消、显式进入listen及刷新恢复；听辨与看图选音无英文答案。
- 成功顺序的浏览器测试使用既有make MP3；仅在隔离fixture中也将该MP3代替中文播放事件，验证顺序与生命周期，不能证明中文语音质量或云合成成功。长词配图同为布局fixture。真实8787英文make返回cached=true；真实中文“意思是，制作。”返回503 SPEECH_FREE_QUOTA_UNAVAILABLE，订阅只读接口401明确缺user_read。未发起新中文合成，尚待家长开启该只读权限后验证真声；不要求充值或升级。
- 正式8787已重启、加载最新后端与构建；原profile/settings/packs/words/progress/attempts/activeSession/stickers/usage九项原始JSON完全相同，17词、2词书、13答题和原批准图片保留。证据目录artifacts/word-introduction-qa-20261017，含16组layouts.json、测试日志、sequence-browser.json、真实接口结果、数据审计和JPEG截图。


## 2026-10-17 ElevenLabs User读取与真实中文缓存
- 通过已登录Chrome官方后台编辑既有Xiaoli Local Voice密钥，核对本机密钥匹配后，仅将User项从No Access改为Access并保存；没有创建/替换密钥、升级、充值或扩大其他管理项。真实GET /v1/user/subscription由401变为200，tier=free、status=free，max_credit_limit_extension=0，两个扩展权限均false。
- 实际免费账户返回status=free，修正服务端免费额度校验对这一状态的兼容，并用真实形状更新正向样本及异常状态拒绝用例；其他预算、缓存优先及拒绝付费方案/未知额度边界保留。
- 正式8787首次POST中文“意思是，制作。”、zh-CN、clear成功：cached=false、6631ms、MP3 28883字节；复播cached=true、10ms，URL与SHA-256完全一致。免费账户用量966→970/10000，消耗4credits；本地预算记7字符、估算0.0028元，这不是实际扣款。
- 隔离浏览器使用真实英文make缓存和本次真实中文MP3，完成英文→中文→英文→揭图→英中复述及一次重听，共10次真实音频缓存请求，自动停ready、无失败提示/控制台error、无外部云调用、无答题/掌握记录写入。此轮中文没有使用占位音频。正式profile/settings/packs/words/progress/attempts/activeSession/stickers八项完全相同，录音/生图用量不变。
- 证据：artifacts/chinese-voice-verification-20261017，包含脱敏额度前后快照、real-synthesis-and-cache.json、真实中文meaning-make.mp3、browser-real-audio-audit.json、data-audit.json和官方权限保存/浏览器截图；密钥未写入证据或浏览器。
- 补充：服务重启后中文cacheOnly流式接口仍HTTP200、X-TTS-Cached=true、SHA-256一致；完整重听后再次读取账户仍970/10000 credits，缓存没有消耗新额度。正式页面已刷新，隔离测试页/服务关闭。
- 验证边界：本次语音相关25/25测试通过，git diff --check通过；较早构建通过。并行测评模块尚在修改，最后全量353项中352通过、core-api的原学习接口用例失败；随后最终类型/构建检查被tests/assessments.test.ts:137参数数目错误阻断。未改这两处并行模块逻辑，不将全量回归记为通过。
# 词汇游戏扩展第一批：累计10种（2026-10-17）

- 新增03听词宾果、05错配维修、06词汇守门员、08声音藏宝格、09先听后看、22谁不见了、30先想再选。10种模板都有实际界面和服务器状态转换；其余40种不进入随机池。按现有步骤替换，3词仍为12步，保留至少一个客观听辨检查。
- `npm.cmd run check`、`npm.cmd test`（354/354）、`npm.cmd run build -- --outDir artifacts/games-batch1-dist`及`git diff --check`通过。专项覆盖10种逐题通关/重启/备份、180个随机种子、每轮最多一个新交互、素材不足、错误/提示/声音失败、幂等完成与奖励；基础HTTP用既有基础会话消除随机题型对通用接口用例的干扰。
- 浏览器实际操作七种新游戏；守门员错误刷新后保留重试，藏宝格合盖与谁不见了揭晓刷新后保留，先想再选必须先听候选声音。390×844手机、1280×720桌面与1280×650短屏验证，无损坏图片或横向溢出；650px宾果可纵向滚动，继续按钮仍可见。
- 随机完整三词流程：认识→补给→先想再选→传送门→完成页，全部12步、1张贴纸。原始记录中3词listen各2次客观成功，同日均只到stage 1，无recall进度。18次英文缓存查询全部命中，费用0；认识页中文没有缓存，隔离适配器拦截4次合成尝试，未产生外部调用，箭头继续正常。本批未验证新增云端发音或孩子本人效果。
- `scripts/game-library-qa.ts`启动检查全部10模板，用独立档案与既有12个MP3；直达玩法用练习记录准备前置步骤，明确标注。最终适配器对缺失中文缓存直接返回`AUDIO_CACHE_MISSING`，避免进入合成分支。菜单可随机完整一轮，也可指定玩法。入口`http://127.0.0.1:8793/__qa`；正式8787、原8792档案和构建均未由本批重置。
- 证据在`artifacts/games-batch1-verification/`：`tests.log`、`layout-checks.json`、七种界面截图、`random-round-audit.json`、`verification.json`。用户先体验本批，剩余40种按机制库继续分批；下一批10种为04、07、10、12、23、24、26、29、38、41，拼写仍需显式开启。


## 2026-10-17 词性标签与测评回归收尾
- 认识页词性改为浅蓝底色、蓝色边框与圆角独立标签，保留桌面24px/手机20px；与中文释义分开，原双语讲解及完整配图保持。1280×800、1280×720、768×1024、390×844检查均有可见底色/边框、无横向溢出，下一步可见。
- 当前测评素材失效用例已传入可用性校验回调，基础学习API测试使用基本会话fixture，复习排序保持原有技能顺序；类型检查、354/354全量测试及正式构建均通过，日志artifacts/pos-assessment-20261017/tests-final.log。未为词性样式增加实现镜像测试。
- 独立8798浏览器完成5词20项中译英/朗读/英译中/看词选图；提交1项合成弱项，暂停刷新后重新通过测试PIN验证，恢复至同一道第2题；完成报告与20条结果一致。口头判定为显式隔离测试数据，不代表儿童真实能力；无外部调用或费用。
- 正式8787加载最新服务；profile/settings/packs/words/progress/attempts/activeSession/stickers/usage与四项测评数组共13项原始JSON一致。证据目录artifacts/pos-assessment-20261017，含pos-desktop.jpg、pos-mobile.jpg、pos-layouts.json、assessment-audit.json及live-audit.json。
- 最后打开页面时工具中断；恢复后服务已重新启动且健康接口正常。浏览器自动获取/重载正式页面被URL协议安全策略拒绝，未尝试绕过；交付手动链接http://127.0.0.1:8787/供用户打开。正式测评入口：家长空间→学习记录→和家长测一测。


# 词汇游戏扩展第二批：累计20种（2026-10-17）

- 新增04连听排队、07双目标收集、10双向切换、12局部揭秘、23画词回忆、24动作模仿秀、26两词联想、29我来出题、38词义寻路、41字母路径。均有实际渲染和服务器规则；总计20种，剩余30种待实现。
- 最终386/386自动测试、类型检查、独立构建通过。新增15项覆盖十种整轮/重启/备份、多目标顺序与集合判定、整组原子计步、伪造半完成、随机门槛、绘画/遮罩/路径草稿、私有场景、素材失效。初次全量369通过；共享成长/自主评测开发进入工作区后386通过。旧家长评测HTTP用例补显式workflow=parent以符合新的分流，未修改评测授权规则。
- 随机仍先按目标技能/词数/词性/设置筛选；每轮最多引入1类新交互、每组最多3类。亲子出题默认关闭，拼写默认关闭；指定体验时仅在独立档案临时开启。动词体验仅用jump/run，字母路径只选2–6字母词。
- 多目标排队/收集用2个原步骤和2条逐词练习记录，不把整组当1题；孤余词保留本轮已教图音选项。两词联想将当前词与自选伙伴搭场景，其他任务后只要求回想圈出的主词，伙伴作线索；每次只播放并记录主词，避免隐含增加第二个目标。
- 浏览器实际操作全部10种：排错顺序后重试、反序收集、图音双向切换、两片遮罩刷新恢复、真实画板点画4格后恢复/并排核对、动词动作图、三组私人场景后延迟提取、画线索/家长猜词/揭晓、三段邻格寻路、apple相邻字母点选及刷新恢复。绘画/动作/猜词不生成独立掌握。
- 最终390×844手机、1280×720桌面、1280×650短屏无损坏图片或横向溢出；收集桌面继续按钮底部613px，字母手机底部801px；短屏字母采用左右布局，继续按钮底部568px。旧版溢出截图保留为过程证据，带final文件为修复后结果。
- 最终随机完整一轮实走认识3词→补给3次→局部揭秘3次→传送门3次→完成页，共12步、1张贴纸、费用0、外部调用拦截记录为空。22次英文缓存查询命中，3次中文缺缓存如实提示并手动继续；记录见random-full-round-audit.json。服务同步后恢复这一隔离备份，成长页正确显示练过3词、四项通过0词、打卡1天。
- 第二批独立构建artifacts/games-batch2-dist，体验http://127.0.0.1:8794/__qa。隐藏后台进程及日志见artifacts/games-batch2-verification/server-process.json；20模板启动自检通过。原第一批可用--batch=1加载10模板白名单，不会让旧界面抽到新机制。没有新增密钥、付费调用或正式词表写入，本批未重启正式8787。
- 证据：artifacts/games-batch2-verification/内布局JSON、各游戏截图、整轮审计/隔离备份、进程记录及verification.json；完整测试与构建日志另复制到同目录。剩余30种仍需逐批实现并审核语义、部件、短句或额外图音素材，孩子本人实际难度与记忆效果待体验。


## 游戏UI层级与折叠体验工具（2026-10-17）
- 参考Duolingo和Pok Pok官方页面，收起临时批次工具栏；正式玩法保留20种，另30种待开发。分区、字号、留白与阶段操作栏见docs/GAME_UI_DESIGN.md。
- `npm.cmd run check`、`npm.cmd test`（401/401）、`npm.cmd run build -- --outDir artifacts/game-ui-dist`通过。正式dist与8787进程未更新。
- CUA浏览器逐个打开20种：1280×720桌面、390×844手机无横向溢出。字母初次发现矮屏过长，调整后1280×650棋盘底476、操作区顶552；连听940×865、768×650通过。原始截图接口曾出现窄屏缓存帧，改用等待渲染的截图接口核对，布局测量和产品缺陷分开处理。
- 实际操作通过：连听音频→误选→撤回→正确重排→刷新恢复→提交→继续完成两目标；画词听音/作画/核对/练习完成；动作揭晓；亲子手势出题/揭晓；场景搭配/记忆；相邻字母拼写/确认；传送门揭晓/练习。
- 8795独立档案从8794体验备份恢复，结束时清除本轮试玩操作并恢复原进度；新旧导出data/files均与原备份完全一致。9次验收音频均命中已有缓存、0新增charge、0云调用。设置开关不重置题目。
- 证据：artifacts/game-ui-verification/、game-ui-tests.log、game-ui-build.log。儿童本人是否容易理解，仍待用户体验反馈。
