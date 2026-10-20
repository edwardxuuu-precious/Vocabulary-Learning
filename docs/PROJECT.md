# 项目目录与模块入口

使用见 [README](../README.md)，产品规则见 [MVP](MVP.md)，当前状态见 [任务树](TASK_TREE.md)，验证见 [验收](ACCEPTANCE.md)。各文件维护一种事实，不复制阶段日志。研究诊断、依据、完整规划与交互示意见 [学习优化策略](LEARNING_STRATEGY.html)，33 项任务的依赖/执行状态统一维护在任务树；规划不代表功能已经实现。

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
                                       └─ integrations/ → ElevenLabs / 官方 Codex
```

儿童主线是讲解 → 自动游戏 → 主动回忆 → 保存休息点 → 完成与跨天复习。短音频集中走缓冲播放器；测评核验与练习参与分开写入。家长测试使用独立数据库和原音目录，共用词表、批准素材与缓存。正式运行只依赖项目代码、`public/`、构建产物、私有配置和 `data/`，不依赖隔离体验目录或其他 worktree。

## 模块定位

| 功能 | 主要入口 |
| --- | --- |
| 页面协调 | `src/main.tsx`、`src/entry-home.tsx`、`src/learning-hub.tsx`、`src/learning-topbar.tsx`、`src/learning-flow.css`；选词/挑战/成长/图鉴/家长共用样式 `src/page-system.css` |
| 备课、编辑与审核 | `src/pack-workbench.tsx`、`src/pack-editor.tsx`、`src/pack-image-review-panel.tsx`、`server/import-preparation.ts`、`server/pack-audio.ts`、`server/pack-images.ts` |
| 课堂范围与轮次管理 | `shared/lesson-plan.ts`、`src/lesson-planner.tsx`、`src/learning-hub.tsx`、`server/store.ts` |
| 学习计划与恢复 | `shared/learning.ts`、`shared/learning-policy.ts`、`shared/mainline-experience.ts`、`shared/adaptive-mainline.ts`、`shared/learning-goals.ts`、`shared/game-plan.ts`、`src/learning-session.ts` |
| 整本词表复习与游戏 | `shared/pack-practice.ts`、`shared/pack-games.ts`、`src/word-book-practice.tsx`、`src/word-book-games.tsx`；复用轮次接口，书与玩法快照由 `server/store.ts` 校验保存，`GET /api/pack-games` 返回真实可玩目录 |
| 游戏与素材 | `shared/game-registry.ts`、`shared/game-materials.ts`、`shared/game-material-builder.ts`、`server/game-validation.ts`、`server/pack-game-audio.ts` |
| 讲解、跟读与录音 | `src/word-introduction.ts`、`src/recall-demonstration.ts`、`src/memory-loop.tsx`、`src/memory-recall.css`、`src/oral-practice.tsx`、`server/practice-recordings.ts` |
| 声音与反馈 | `src/buffered-audio.ts` 统一短音频、预热和提示音；`src/browser-speech.ts` 兼容回退与原始对照；`src/buffered-player.tsx` 私有回放；`src/audio-check.tsx` 家长声音检查 |
| 挑战与核验 | `src/child-challenge.tsx`、`src/assessment-review.tsx`、`server/challenges.ts`、`server/assessments.ts`、`server/assessment-grants.ts` |
| 数据与 HTTP | `server/store.ts`、`server/index.ts`、`shared/contracts.ts` |
| 家长入口 | `src/parent-gate.tsx`、`server/parent-gate.ts` |
| 成长与视觉 | `shared/growth.ts`、`shared/badge-catalog.ts`、`shared/visual-theme.ts`、`shared/companions.ts`、`shared/learning-backgrounds.ts` |
| 家长测试模式 | `server/test-mode.ts` 的独立 SQLite 与私有录音位于 `data/test-mode/`；`POST /api/test-mode` 需家长授权，`/api/test/*` 需独立临时令牌；`src/test-mode-context.ts` 统一 JSON、流与原音请求，`src/test-mode-ui.tsx` 提供入口、持续标识与测试记录 |
| 外部服务 | `server/integrations/`；停用的实时语音/聊天适配器仍被合同、消费者和回归测试引用，不能仅凭开关关闭删除 |

正式模块不因整理而改名。静态路径与哈希由 [ASSETS.json](ASSETS.json) 检查；来源保留在 [主题](autobot-theme-assets.md)、[首页](home-courtyard-v5.md)、[伙伴](companion-library.md) 及两个提示词 JSON。

## 状态边界

家长导入 → Codex 草稿 → 家长确认词义 → 保存停用词书 → 缓存发音/串行生图 → 家长批准所见图片 → 显式交付全部或已备好子集 → 儿童推荐/自选/恢复 → 练习与成长。

儿童自主挑战 → 冻结作答与原音 → 转写 → Codex 建议 → 家长按所见版本核验 → 正式证据与复测 → 清理挑战原音。练习原音独立私有留存，不套用挑战删除流程。完整语义见 MVP，不在目录文档重写接口。

## 隔离验收与维护

| 用途 | 入口与前提 |
| --- | --- |
| 学习大厅、跨批与多轮 | `node --import tsx scripts/learning-hub-qa.ts --port=未占用端口`；独立示例，关闭语音并拒绝云调用 |
| 游戏库与素材 | `scripts/game-library-qa.ts`、`scripts/game-material-fixtures.ts`、`scripts/game-demo-assets.ps1`；演示素材前提见脚本，输出留在 `artifacts/` |
| 自动编排 | `scripts/automatic-games-qa.ts`；复用本机缓存，固定 8828，启动前确认空闲 |
| 新版主线与旧轮次升级 | `node --import tsx scripts/mainline-qa.ts --port=未占用端口`；须本机8787已有批准音图，禁用云、明确模拟麦克风；加 `--legacy` 验证检查点升级，不写孩子档案 |
| 自主挑战 | `scripts/challenge-qa.vite.ts`、`scripts/challenge-qa.ts`；明确转写/初判替身，独立原音 |
| 旧家长现场测试 | `npm.cmd run build:assessment-experience`、`npm.cmd run assessment:experience`；独立档案，默认 8799 |
| 课堂范围与轮次管理 | `node --import tsx scripts/classroom-qa.ts --port=未占用端口`；40词隔离示例与测试PIN，所有云调用禁用；加 `--games` 开放已实现玩法供验收 |
| 成长、导入与图片 | `scripts/growth-qa.ts`、`scripts/parent-import-qa.ts`、`scripts/pack-images-qa.ts` |
| 学习进度清零 | `node --import tsx scripts/reset-learning-progress.ts` 默认只预览；明确授权并停服后加 `--apply`，私有数据库快照先验证，保留词表/素材/设置/PIN/用量/原音文件 |
| 发音与游戏维护 | `scripts/cache-word-audio.ts`、`scripts/prepare-game-materials.ts`；默认检查，显式 `--apply` 才准备缺项，不自动交付 |

`scripts/game-library-qa.ts --serve --batch=1 --memory-loop --synthetic-mic --port=未占用端口 --dist=dist` 可验收分段闭环；合成麦克风明确标识，`/__qa/day` 只推进独立档案时钟。需已有 12 词缓存清单，不加载 `.env` 或调用云服务。加 `--recall-ui` 可停在首个回忆题，并以带本机体验令牌的 `POST /__qa/failure?kind=demo|save|activity` 注入一次失败；仅此隔离工具提供故障入口。

脚本存在不等于服务已运行。不要停止其他体验；原有目录、数据和证据继续保留。云端 smoke 只有明确授权且额度通过后才能运行，普通检查/测试/构建不生成云端素材。

## 源码交付

`npm.cmd run package:project` 输出 `artifacts/project-package/little-word-playroom.zip`、`.sha256` 和包内 `PROJECT_MANIFEST.json`。脚本按源码目录白名单取当前工作区，逐项检查哈希，拒绝打包期间的源文件变化；不含凭据、`data/`、依赖、构建、Git、任务证据和调试 schema。

源码包不是本机实例备份。新环境需单独配置服务、登录、词书和素材；迁移私有数据前停止服务并另行保存，普通学习备份不携带 PIN、授权或原音。
