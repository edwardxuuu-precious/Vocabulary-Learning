# 当前任务树

当前规则以 [MVP](MVP.md) 与 [合同](../shared/contracts.ts) 为准；[结构与状态图](PROJECT.md) 固定目录和交付边界，[验收](ACCEPTANCE.md) 记录当前验证。历史实施阶段完整保存在工作区 `docs/archive/TASK_TREE-20261017.md`，不再堆入当前进度。

## 已交付

| 模块 | 当前行为 | 真源 |
| --- | --- | --- |
| 家长入口 | 自设6位 PIN、服务端错误锁定、修改与本机重置 | `server/parent-gate.ts` |
| 词书备课 | 英文导入、Codex补全、家长确认词义、音图准备与补缺 | `server/import-preparation.ts`、`server/pack-audio.ts`、`server/pack-images.ts` |
| 审核交付 | 按所见版本批准、发音门槛、显式交付及部分交付；示例隔离 | `server/store.ts`、`src/pack-workflow.ts` |
| 自动讲解 | 英文/中文/英文/图片/英中复述后自动进入练习；词性小标签，静音/失败按阅读节奏继续 | `src/word-introduction.ts`、`src/word-introduction-view.tsx` |
| 中文配音 | 家长选定C款浑厚普通话男声，账户已保存、中文独立配置已生效；真实免费合成、缓存与流式复播验证通过，另已生成约22秒儿童学习引导试听 | `.env` 的 `ELEVENLABS_VOICE_ID_ZH`、`server/integrations/elevenlabs.ts` |
| 随机游戏 | 50种实现，按技能/词数/素材/设置筛选，固定选项与草稿，刷新恢复，多目标按实际计步 | `shared/game-registry.ts`、`shared/game-plan.ts`、`server/game-validation.ts` |
| 游戏界面 | 阶段操作栏、短屏布局、折叠体验工具；亲子和拼写默认关闭 | `docs/GAME_UI_DESIGN.md` |
| 学习调度 | 新词按批推进、每日额度含未完成预留；跨批到期优先、逐题预算、积压减新词、旧会话冻结 | `shared/learning.ts`、`src/learning-session.ts` |
| 认听读目标 | 每个新词固定认/听/读，按目标随机游戏；分别记录认词答题、听辨及已录/跳过朗读；到期弱项优先，录音不自动判对 | `shared/learning-goals.ts`、`shared/goal-game-rules.ts`、`src/goal-games.tsx`、`server/store.ts` |
| 桌面启动 | Windows 大黄蜂图标快捷方式，自动启动或复用正式本机服务，启动错误可见；直接运行快捷方式打开默认浏览器8787首页已验证，移动项目后可重装 | `scripts/install-desktop-shortcut.ps1`、`scripts/launch-desktop.ps1`、`scripts/desktop/playroom.ico` |
| 口头练习录音 | 三遍跟读、全部口头游戏（含哑剧/线索/补空/信息差）与口头复习接入，私有本机保存与刷新恢复，家长授权回听，不自动判对 | `src/oral-practice.tsx`、`server/practice-recordings.ts`、`shared/oral-practice.ts` |
| 麦克风错误提示 | 区分网页拒绝、系统拦截、未找到设备及设备占用；网页已允许时不再误报未授权；Chrome 真实开麦及暂停取消已验证，授权失败仍可重试或跳过 | `src/microphone-access.ts`、`src/browser-recording.ts` |
| 自主挑战 | 四关路线与机甲伙伴界面；中译英显示中文文字、直接录音；最多5词20项、免PIN提交，文件转写与Codex初判，家长版本化集中核验 | `server/challenges.ts`、`server/assessments.ts`、`src/child-challenge.tsx` |
| 正式证据 | 看词选图由服务端核对，口头证据由家长确认；AI建议不晋级；保留旧现场测试 | `shared/assessment.ts`、`server/assessment-grants.ts` |
| 复测与弱项 | 四维分别复测，1/3/7/14/30天，同日不重复晋级，孩子先练家长再测 | `shared/assessment.ts`、`shared/learning.ts` |
| 成长 | 会词/练过分开、打卡、128枚差异化奖章、四模块；真实进度、永久已得记录、稳定激励编号 | `shared/growth.ts`、`shared/badge-catalog.ts`、`docs/CHILD_GROWTH.md` |
| 视觉 | 首页v5、20位伙伴及每位约200字简介、三套按会话固定背景、完整词图 | `shared/visual-theme.ts`、`shared/companions.ts`、`shared/learning-backgrounds.ts` |
| 备份 | 旧备份兼容、学习事实与费用保留；不导出密钥、授权、PIN或挑战/口头练习原音 | `server/store.ts` |

## 学习大厅与跨批复习（2026-10-17）

- [x] 首页进入学习大厅；未完成轮次保存与显式恢复，进行中/最近完成分开。
- [x] 跨词书图片自选、完整重学/直接练习、未学词先认识与整组预算校验；重学只记练习。
- [x] 当日新词额度累计，完成后可继续混合练旧词；同优先级跨批复习。
- [x] 跨批推荐短测、初学次日起的首次测试、进行中与待核验项目去重；保留原核验与额度边界。
- [x] 最终检查、完整测试与构建通过；桌面/390px窄屏隔离验收、正式本机大厅冒烟与16类档案哈希核对通过，证据见本轮Work_Progress。

## 本次结构收敛（2026-10-17）

- [x] 其他项目会话全部空闲后开始；保留首次整理基线，后续功能完成后另存最终基线。
- [x] 固定 `src / server / shared`，保留各会话完成结果与正在使用的独立体验。
- [x] 8个停用语音工具与旧QA面板移入 `scripts/legacy/`；历史文档移入 `docs/archive/`。
- [x] 6张无当前引用的旧图退出静态目录，原图ZIP与路径/哈希清单保留。
- [x] 44个在用静态文件固定于 `docs/ASSETS.json`，新增素材检查与项目打包命令。
- [x] README、当前规格、状态图、任务树与AGENTS同步；配置模板保留当前服务所需项。
- [x] 最新整合的类型检查、422项测试、生产构建及本机44个素材/2个构建资源HTTP校验通过；111个核心文件、70个数据文件、16个存储字段与本轮最终基线一致，`.env`保持。
- [x] 精简项目包完成逐项哈希核验、独立解压安装、构建和隔离启动验证；含口头练习录音、128枚奖章与人物简介。交付路径和验证边界见README与ACCEPTANCE，早期未验证快照仅留在任务证据目录。

## 待验证与后续

- 暂缓：用户决定继续本地运行，不部署AWS。未创建云端资源或修改DNS，云端草案仅保留在独立工作区，不纳入当前本机版本；见`AWS_DEPLOY.md`。

- [x] 机制库剩余30种分三批实现；逐项界面、恢复、录音、素材审核与抽选验证，独立8803/8804/8805体验。
- [ ] 为正式词书逐项确认额外异图、关系、动作与熟悉词句；示例材料不代替家长审核。
- [ ] 儿童本人日常理解、时长、真实麦克风/口音与长期记忆效果；隔离合成数据不能替代。
- [ ] Codex内置预览的麦克风恢复尚未确认；Chrome实际录音已通过，可继续用Chrome。内置预览后续复测，证据保留在`artifacts/microphone-access-20261017/`。
- [ ] 新环境需单独配置ElevenLabs权限/免费额度与官方Codex登录；额度不足或不明时停止。

## 协调

共享工作区不得撤销其他会话未完成改动；接口同步合同与消费者。每轮先建中文任务记录，完成后按实际证据更新当前真源。历史目录分工不代表永久写权限，旧验收数字不代表当前状态。
