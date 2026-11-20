# 项目目录与模块入口

使用见 [README](../README.md)，产品规则见 [MVP](MVP.md)，当前状态见 [任务树](TASK_TREE.md)，验证见 [验收](ACCEPTANCE.md)。固定展示见 [项目工作台](PROJECT_DASHBOARD.html)，指标/循环/Skill与经验规则见 [业务工作流](PROJECT_WORKFLOW.md)。各文件维护一种事实，不复制阶段日志。[学习优化策略](LEARNING_STRATEGY.html) 保留研究诊断与旧33项定义，其到新业务任务的映射维护在任务树；提案与已实现行为分别表述。

## 固定结构

| 路径 | 职责与保留边界 |
| --- | --- |
| `src/` | 儿童与家长 React 界面、浏览器音频和录音 |
| `server/` | 本机 HTTP、SQLite、家长授权、素材队列与外部适配器 |
| `shared/` | 接口合同、词汇、学习与游戏计划、测评、成长和视觉定义 |
| `tests/` | 必要的单元、接口与恢复回归测试 |
| `scripts/` | 启停、桌面入口、素材检查、备课维护、隔离验收与打包 |
| `public/assets/` | 在用主题、伙伴、背景、示例插画和图标 |
| `docs/` | 当前规范、模块规则、资产来源、任务树与验收摘要 |
| `Work_Progress/` | 每轮中文任务证据，历史记录不作为当前规格 |
| `data/` | 私有档案、图片、发音、原音、PIN 与本机日志；忽略、不清理 |
| `artifacts/` | 隔离体验、验收证据、原素材恢复清单与项目包；忽略 |
| `dist/`、`node_modules/` | 可重建/重装的本机输出；忽略 |
| `.env.example`、`.env` | 无密钥模板与私有配置；只有模板提交 |

根目录只保留启动、构建、依赖和协作入口。历史实现用 Git 追溯，任务与隔离证据保留；可重新生成的旧构建与解压副本依赖不属于证据真源。

## 技术框架与调用方向

React 19 + TypeScript + Vite 构建儿童和家长界面；Node.js 24 本机 HTTP 服务提供 API、静态页面和私有媒体访问，SQLite 保存事实。`shared/` 的纯函数负责冻结学习编排、校验目标与素材、计算复习和成长，前后端共用合同。

```text
src/ 页面与交互 ── src/api.ts ── server/index.ts 路由/授权
        │                              │
        └──── shared/ 合同与策略 ───────┤
                                       ├─ server/store.ts → data/playroom.sqlite
                                       ├─ 私有录音/素材管理 → data/
                                       └─ integrations/ → 本机 Nova / ElevenLabs / 官方 Codex
```

儿童学习主线是讲解 → 目标适配练习/穿插回忆 → 同范围短句学习 → 学习完成；独立测试由孩子另行启动，跨天复习按原目标安排。参考与取舍见[学习环节](LEARNING_FLOW.md)。短音频集中走缓冲播放器；测评核验与练习参与分开写入。家长测试使用独立数据库和原音目录，共用词表、批准素材与缓存。正式运行只依赖项目代码、`public/`、构建产物、私有配置和 `data/`，不依赖隔离体验目录或其他 worktree。

`data/nova-voice/settings.json` 选择本机英文音色。准备工具从此目录读取模型和依赖，产出的音频按原文缓存至 `data/speech/nova-v1/`。`scripts/nova-voice/render.py` 使用已确认的词句语速及音量配置。词表准备补齐单词与已支持的用法短句，普通播放走同一缓存路径。模型、依赖和缓存属于本机资料，源码包保持可用于原语音配置。

## 模块定位

| 功能 | 主要入口 |
| --- | --- |
| 页面协调 | `src/main.tsx`、插画主页 `src/entry-home.tsx` / `src/entry-home.css`、`src/learning-hub.tsx`。跨页约束见 [UI 规范](UI_SYSTEM.md)，数值与共用样式在 `src/ui-tokens.css`、`src/ui-system.css`，返回、进度和题目标题在 `src/ui-layout.tsx` |
| 基础题面与帮助 | `src/learning-task-frame.tsx` / `.css`统一词图、题目与底部操作；`goal-games.tsx`、`memory-loop.tsx`、`word-introduction-view.tsx`和`repair-task.tsx`接入；`learning-help.tsx` / `task-help.css`提供可滚动的操作示意，沿用原规则键及学习合同 |
| 学习过程词图 | `src/learning-word-images.css`经`src/child-learning.css`引入，统一完整词图的自然比例、尺寸上限和实际图片边界圆角；保留答题标记及拼图/揭图局部机制，不修改原图片或学习事实 |
| 项目业务工作台 | `docs/TASK_TREE.md`维护进度，`docs/PROJECT_WORKFLOW.md`定义口径，`docs/BUSINESS_RECORDS.md`登记决策/经验，`docs/ACCEPTANCE.md`维护验证；`scripts/project-dashboard.mjs`校验并生成展示，模板为`scripts/project-dashboard.template.html`；不连接孩子私有数据 |
| 双入口与工程准备 | `shared/learning-entry.ts`为正式用途/来源/已学池/范围合同，`shared/entry-recommendation.ts`与`dailyLearningPlan`共用正式新词/到期推荐的预览与开局，服务端与界面共用；`docs/ENTRY_RULES.md`定义规则/场景；`shared/entry-rules.ts`、`shared/entry-prototype.ts`与`src/entry-prototype.ts`为隔离预演；生成页默认桥接正式词书，示例显式开启；`scripts/entry-integration-qa.ts --recommendations`使用独立标记档案验收正式组件，发音就绪为本机工程替身；加`--no-due`或`--unprepared`验空状态 |
| 备课、编辑与审核 | `src/pack-workbench.tsx`、`src/english-import.tsx`、`shared/import-draft.ts`、`src/pack-editor.tsx`、`src/pack-image-review-panel.tsx`、`server/import-preparation.ts`、`server/pack-audio.ts`、`server/pack-images.ts`；核对依据见 [IMPORT_REVIEW](IMPORT_REVIEW.md) |
| 课堂范围与轮次管理 | `shared/lesson-plan.ts`、`src/lesson-planner.tsx`、`src/learning-hub.tsx`、`server/store.ts` |
| 学习计划与恢复 | `shared/learning.ts`、`shared/learning-policy.ts`、`shared/mainline-experience.ts`、`shared/adaptive-mainline.ts`、`shared/learning-goals.ts`、`shared/game-plan.ts`、`src/learning-session.ts` |
| 完整任务连续学习 | `src/learning-continuation.ts`只确认已完成内部边界，不重排冻结分组/回忆，不新增学习事实；`src/learning-topbar.tsx`与续学入口展示整体进度，`tests/continuous-learning.test.ts`覆盖跨组、保存/恢复及失败重试 |
| 词档案与体系重构 | [完整规划](LEARNING_REFACTOR.md)；`shared/word-learning.ts`只读证据投影，`shared/study-agenda.ts`逐目标计划，`shared/study-continuity.ts`旧现场映射与续接合同，`server/study-read-model.ts`版本绑定；`server/study-execution.ts`统一执行，`learning-sessions.ts`构建兼容现场，`learning-position.ts`保存；`src/study-controller.ts`/`study-hub.tsx`/`word-learning-archive.tsx`承接儿童与家长；`scripts/audit-word-learning.ts`只读盘点和迁移提案 |
| 证据与业务指标 | `shared/learning-evidence.ts`统一当前版本/来源/作答顺序；`shared/business-metrics.ts`计算K1–K3；`shared/business-observations.ts`只读首次探测与运行片段；指引见`docs/BASELINE_OBSERVATION.md` |
| 私有使用简记 | `server/business-observations.ts`管理SQLite独立表`business_observations`及修订/去重；`/api/business`查看/补记/导出须家长授权，`/api/business/events`只收有界运行事件；`src/business-observations.tsx`、`src/learning-observation.ts`为表单/非阻塞片段。普通AppState/学习备份/项目Dashboard不带明细；完整实例备份需保留SQLite |
| 新词教学顺序 | `shared/new-word-flow.ts`保护奇数尾词回忆间隔并提供计划覆盖，`shared/learning-policy.ts`冻结meaning-recall-v1新轮次；旧轮恢复不重排 |
| 操作引导与有限求助 | `shared/learning-guidance.ts`为操作族/负担/核心范围与元数据合同；`src/learning-help.tsx`、`src/learning-help.css`为无答案/音频/麦克风的互动示意及支持面板；`server/store.ts`仅按当前题持久化rules-seen/rules-help，不产生作答或提示。实际词汇帮助仍走原活动规则 |
| 今日词量与选词 | `shared/daily-learning-choice.ts`、`src/learning-choice.tsx`及`/api/session/daily-choice`保存当日目标/跨天范围和版本；不改家长长期默认与冻结轮次，测试档案隔离 |
| 家长核验摘要 | `shared/parent-review.ts`和`src/assessment-review.tsx`按待核验/缺音/改义筛选，并从当前合法正式证据给短反馈；原核验/授权合同不变 |
| 复习提醒与恢复 | `shared/review-history.ts`按当前版本/方向读取合法原目标结束，`reviewCompletionTimes`保存真实完成日、`reviewHistory`只读投影供刷新；`shared/learning.ts`统一推荐/概览及普通/弱项目标去重，加练与正式日期独立 |
| 保存退出与复习补救 | `src/learning-save.tsx`等待实际录音保存并拦截失败；`shared/learning-pause.ts`校验冻结位置/草稿，`shared/round-feedback.ts`只读本轮事实；`shared/review-support.ts`冻结复习方向顺序与有限再试，`src/review-support.tsx`为显式求助及无评分再遇；`server/store.ts`的saveLearningPosition/reviewSupportEvent与HTTP合同同步，测试/孩子档案分别保存 |
| 整本词表复习与游戏 | `shared/pack-practice.ts`、`shared/pack-games.ts`、`src/word-book-practice.tsx`、`src/word-book-games.tsx`；复用轮次接口，书与玩法快照由 `server/store.ts` 校验保存，`GET /api/pack-games` 返回真实可玩目录 |
| 游戏与素材 | `shared/game-registry.ts`、`shared/game-materials.ts`、`shared/game-material-builder.ts`、`server/game-validation.ts`、`server/pack-game-audio.ts` |
| 讲解、跟读与录音 | `src/word-introduction.ts`、`src/recall-demonstration.ts`、`src/memory-loop.tsx`、`src/memory-recall.css`、`src/oral-practice.tsx`；`src/voice-turn.ts`只判本地音量/停顿端点，不识别或评分；原音由`server/practice-recordings.ts`私有保存 |
| 声音与反馈 | `src/buffered-audio.ts` 统一短音频、预热和提示音；`src/browser-speech.ts` 兼容回退与原始对照；`src/buffered-player.tsx` 私有回放；`src/audio-check.tsx` 家长声音检查 |
| 挑战与核验 | `src/child-challenge.tsx`、`src/assessment-review.tsx`、`server/challenges.ts`、`server/assessments.ts`、`server/assessment-grants.ts` |
| 数据与 HTTP | `server/store.ts`、`server/index.ts`、`shared/contracts.ts` |
| 家长入口 | `src/parent-gate.tsx`、`server/parent-gate.ts` |
| 角色解锁与动画 | `shared/companion-unlocks.ts`独立永久奖励账本/汇总，`shared/companion-videos.ts`国内普通话动画映射，`shared/companion-video-source.ts`集数/CID与播放器来源，`shared/companion-expansion.ts`及`shared/companion-expansion-videos.ts`补充80位G1人物/故事/动画；`src/companion-access.tsx`限制所有独立伙伴，`src/companion-library.tsx`模糊锁定与已解锁详情、`src/companion-animation.tsx`按点击加载/关闭的页内播放器；`scripts/companion-unlocks-qa.ts --port=未占用端口`仅隔离工程示例，不加载家庭配置或调用云端 |
| 短句学习与测试范围 | `shared/sentence-study.ts`定义同句教学/练习与资格，`server/sentence-study.ts`保存真实参与并校验备份，`src/sentence-course.tsx`接单词完成与挑战入口，`src/sentence-demonstration.ts`控制两遍真实示范、取消与保存重试；`scripts/cache-sentence-audio.ts`仅按已确认免费额度准备缓存 |
| 题面语境与图片帮助 | `shared/assessment-cues.ts`区分必要语境、歧义和可选帮助，`server/challenge-state.ts`冻结所见版本及看图顺序，核验不把有提示或歧义记作独立成功 |
| 学习阶段与完成后验证 | `shared/learning-journey.ts`只读同范围教学阶段，`src/learning-stages.tsx`呈现学习环节；`shared/learning-verification.ts`只读本轮全范围及真实核验状态，`src/child-growth.tsx`完成页直接衔接，`src/child-challenge.tsx`十词以内一次完整测试并保留原有轮次；主卡推荐创建与最新学习续接分别由`shared/entry-recommendation.ts`负责 |
| 用屏休息 | `shared/screen-time.ts`定义15/5分钟合同，`server/screen-time.ts`持久化独立计时表，`src/screen-time.tsx`/`src/screen-time.css`全屏休息/PIN提前解锁；服务端阻止休息期儿童推进，练习原音保存另行允许 |
| 成长与视觉 | `shared/growth.ts`、`shared/badge-catalog.ts`、`shared/visual-theme.ts`、`shared/companions.ts`、`shared/learning-backgrounds.ts` |
| 家长测试模式 | `server/test-mode.ts` 的独立 SQLite 与私有录音位于 `data/test-mode/`；`POST /api/test-mode` 需家长授权，`/api/test/*` 需独立临时令牌；`src/test-mode-context.ts` 统一 JSON、流与原音请求，`src/test-mode-ui.tsx` 提供入口、持续标识与测试记录 |
| 外部服务 | `server/integrations/`；停用的实时语音/聊天适配器仍被合同、消费者和回归测试引用，不能仅凭开关关闭删除 |

正式模块不因整理而改名。静态路径与哈希由 [ASSETS.json](ASSETS.json) 检查；来源保留在 [主题](autobot-theme-assets.md)、[首页](home-courtyard-v5.md)、[伙伴](companion-library.md) 及两个提示词 JSON。

## 状态边界

家长导入 → Codex 草稿 → 家长确认词义 → 保存停用词书 → 缓存发音/串行生图 → 家长批准所见图片 → 显式交付全部或已备好子集 → 儿童推荐/自选/恢复 → 练习与成长。

儿童自主挑战 → 冻结作答与原音 → 转写 → Codex 建议 → 家长按所见版本核验 → 正式证据与复测 → 清理挑战原音。练习原音独立私有留存，不套用挑战删除流程。完整语义见 MVP，不在目录文档重写接口。

试用与后续成果门使用[执行检查卡](TRIAL_HANDOFF.md)；三类项目Skill在`docs/skills/`，工程调用不能代替真人流程和O03减负证据。

## 隔离验收与维护

项目工作台使用 `npm.cmd run dashboard`，固定本机入口为 [8790工作台](http://127.0.0.1:8790/PROJECT_DASHBOARD.html)。服务仅绑定回环地址且只读，刷新重新读取任务/流程源；`npm.cmd run dashboard:build` 更新自包含HTML快照，`npm.cmd run dashboard:check` 检查任务字段、依赖/映射、计数和快照同步，已纳入完整检查。来源改动未同步时明确失败，不给静默旧进度。

| 用途 | 入口与前提 |
| --- | --- |
| 学习大厅、跨批与多轮 | `node --import tsx scripts/learning-hub-qa.ts --port=未占用端口`；独立示例，关闭语音并拒绝云调用 |
| 学习与测试分离体验 | `node --import tsx scripts/new-learning-preview.ts --source=正式data绝对路径 --dist=隔离构建绝对路径 --port=未占用端口 --journey=已完成原轮次ID`。只读复制原范围，使用正常学习、练习与测试页面。`--resume-run=已有试用目录名` 复用同端口的独立档案。`--english-voice=音频清单目录绝对路径` 加载覆盖该组英文单词及短句的已准备音频。私有原音与云调用隔离 |
| 原词书基础题面截图 | `node --import tsx scripts/new-learning-preview.ts --source=正式data绝对路径 --dist=已核对构建绝对路径 --port=未占用端口 --basic-screens --word=原词`；只读复制原词书/批准词图/发音缓存，显式开启后`POST /__preview/basic-scene?step=learn`仅切换独立副本的位置与题型；step可取learn、recognize、listen、sound、recall、read、spell。回忆沿用memory-loop的portal题面，拼写仅在副本开启，不复制私有原音、不写正式档案或调用云端 |
| 完整任务连续学习 | 同一预览工具加`--continuous-learning --simulate-microphone`；须已有含检查点的当前任务，只读复制原内容，默认停在首个边界前。`POST /__preview/continuous-scene?scene=before-boundary`须带`x-preview-qa=当前run目录名`；另有pending-boundary、failed-boundary和final-task，分别验证自动确认、一次503失败重试及整份完成。只写副本，不复制既有私有录音或调用云端 |
| 集中选图界面预览 | 先运行 `node_modules/.bin/vite.cmd build --config scripts/recognize-preview/vite.config.ts`，再运行 `node --import tsx scripts/recognize-preview/server.ts --source=正式data绝对路径 --word=原词 --port=未占用端口`。`src/recognize-picture-task.tsx`只由此预览入口使用；只读SQLite与同一既有学习范围的三张批准原图，操作留在浏览器会话，服务拒绝写请求且不接云端。未集成正式题型或成绩合同 |
| 游戏库与素材 | `scripts/game-library-qa.ts`、`scripts/game-material-fixtures.ts`、`scripts/game-demo-assets.ps1`；演示素材前提见脚本，输出留在 `artifacts/` |
| 自动编排 | `scripts/automatic-games-qa.ts`；复用本机缓存，固定 8828，启动前确认空闲 |
| 新版主线与旧轮次升级 | `node --import tsx scripts/mainline-qa.ts --port=未占用端口`；须本机8787已有批准音图，禁用云、明确模拟麦克风；加 `--legacy` 验证检查点升级，不写孩子档案 |
| 自主挑战 | `scripts/challenge-qa.vite.ts`、`scripts/challenge-qa.ts`；明确转写/初判替身，独立原音 |
| 旧家长现场测试 | `npm.cmd run build:assessment-experience`、`npm.cmd run assessment:experience`；独立档案，默认 8799 |
| 课堂范围与轮次管理 | `node --import tsx scripts/classroom-qa.ts --port=未占用端口`；40词隔离示例与测试PIN，所有云调用禁用；加 `--games` 开放已实现玩法供验收 |
| 成长、导入与图片 | `scripts/growth-qa.ts`、`scripts/parent-import-qa.ts`、`scripts/pack-images-qa.ts` |
| 词义草稿增量与拼写修复 | `node --import tsx scripts/import-draft-qa.ts`，隔离8794的`/__review`；真实导入组件、明确模拟结果、不读取正式词书/PIN、不连接云服务 |
| 学完后的测试与用屏限制 | `node --import tsx scripts/learning-followup-qa.ts --port=未占用端口 --dist=构建目录绝对路径`；独立标记示例与工程PIN，不读取家庭词书/原音；无云服务；仅该进程的有界工程时间入口支持验证15/5分钟，不能写正式档案 |
| 学习进度清零 | `node --import tsx scripts/reset-learning-progress.ts` 默认只预览；明确授权并停服后加 `--apply`，私有数据库快照先验证，保留词表/素材/设置/PIN/用量/原音文件 |
| 发音与游戏维护 | `scripts/cache-word-audio.ts`、`scripts/prepare-game-materials.ts`；默认检查，显式 `--apply` 才准备缺项，不自动交付 |

`scripts/game-library-qa.ts --serve --batch=1 --memory-loop --synthetic-mic --port=未占用端口 --dist=dist` 可验收分段闭环；合成麦克风明确标识，`/__qa/day` 只推进独立档案时钟。需已有 12 词缓存清单，不加载 `.env` 或调用云服务。加 `--recall-ui` 可停在首个回忆题，并以带本机体验令牌的 `POST /__qa/failure?kind=demo|save|activity` 注入一次失败；该故障入口仅在此隔离工具启用。

`scripts/entry-integration-qa.ts --continuity`使用全新隔离示例、静音缓存替身和模拟麦克风验证退出/复习，不读取家庭档案或调用云端；`--resume=run-数字`仅续用该工具在项目artifacts内已有档案。加`--review-dedup`使用隔离弱项样例，带同一工程头的`POST /__qa/day`仅推进该验收档案一天，不改本机时钟。此模式可用带`x-qa-fixture=当前run目录名`的`POST /__qa/failure?kind=recording|position`注入一次保存失败；仅在该隔离进程启用，不进入正式应用。

`node --import tsx scripts/recall-warmup-preview/server.ts` 在本机8863启动隔天短回忆试用。从只读的正式快照选至多两词，求助词在两道其他词的英文选图题后再试一次。回忆位置和自报结果存于浏览器；继续学习进入独立SQLite，首次启动复制学习位置，之后重启沿用试用档案。已有现场接原题，空闲时进试用学习页。历史私有原音不复制。可追加单独端口作验收。

脚本存在不等于服务已运行。不要停止其他体验；原有目录、数据和证据继续保留。云端 smoke 只有明确授权且额度通过后才能运行，普通检查/测试/构建不生成云端素材。

## 源码交付

`npm.cmd run package:project` 输出 `artifacts/project-package/little-word-playroom.zip`、`.sha256` 和包内 `PROJECT_MANIFEST.json`。脚本按源码目录白名单取当前工作区，逐项检查哈希，拒绝打包期间的源文件变化；不含凭据、`data/`、依赖、构建、Git、任务证据和调试 schema。

源码包不是本机实例备份。新环境需单独配置服务、登录、词书和素材；迁移私有数据前停止服务并另行保存，普通学习备份不携带 PIN、授权或原音。
