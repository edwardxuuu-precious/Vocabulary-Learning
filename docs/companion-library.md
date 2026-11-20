# 100位变形金刚伙伴

汽车人、霸天虎各50位，共100位，不重复计算同一人物的改名或升级形态。人物清单真源为`shared/companions.ts`，新增80位资料位于`shared/companion-expansion.ts`，统一由`shared/visual-theme.ts`供界面与配图使用。

## 使用方式

- 首页右下角“伙伴图鉴”显示已解锁数量。擎天柱、威震天的图片和故事默认开放，动画自动解锁门槛分别为累计新学会10词、20词。经家长明确授权，擎天柱可单独获得观看奖励。其余98位显示模糊灰影与待解锁，不能打开大图、故事或动画。
- 顶部按“全部100 / 汽车人50 / 霸天虎50”筛选；每页20位，全部5页，单阵营3页。仅新词推进10+10循环：先10词开一位的图片/故事，再10词开同一位的动画，随后进入下一位；原18位顺序保持，新增人物在其后交替安排两阵营，一方没有剩余时继续另一方。
- 新学会沿用当前义项四项正式独立通过标准；同英文跨词书只记一次，复习通过不推进此循环。晚核验保留原作答日，提示、录音与完成轮次不直接计数。例：10词同时开擎天柱动画和大黄蜂图文，20词同时开威震天与大黄蜂动画，30词见阿尔茜图文、40词看阿尔茜动画；其他角色节点和按词数已得奖励保留。旧账本也须满足领袖动画词数，原先默认开放不作为已赚取奖励。
- 首页进度优先提示当前节点尚未开的领袖动画；每位详情显示自己的剩余词数。动画未开时没有播放按钮、iframe或原站链接，缺失动画授权按锁定处理。
- 点已解锁图片查看原批准大图、阵营、英文名、短简介与可展开的故事。左右按钮或方向键只在当前筛选内已解锁角色间循环；关闭/Esc返回原卡片，详情打开时背景不可操作，Tab焦点包括故事和动画链接。
- 桌面详情图文并排，手机上下排列、短屏可滚动，关闭和切换按钮保留。学习页、等待与小游戏的独立伙伴也限制在已解锁人物，沿用会话/任务位置的稳定选择。
- 奖励账本真源为`shared/companion-unlocks.ts`，在服务端事实事务中记入；读取只返回人物、动画各自的已开ID及下一阶段/目标人物/剩余词数。v1迁到v2时冻结旧复习奖励数量，其历史仍保留，新复习不再发奖；旧/新备份合并保留已得人物和动画，不因后来答错/改义/删词收回，家长测试档案隔离。
- 后续新画或重画单词图按词义及作业编号从完整人物库分配一位；家长审核场景明确指定人物时尊重该选择。角色不能替代目标物或破坏词义。
- 现有已批准词图、主题ID、家长审核、发音缓存与学习证据规则保持原语义；不批量重画、不自动批准图片。

## 人物与素材

|人物|英文名|阵营|素材|
|---|---|---|---|
|擎天柱|Optimus Prime|汽车人|`/assets/brand/optimus-mecha-v2.png`|
|大黄蜂|Bumblebee|汽车人|`/assets/brand/bumblebee-mecha-v2.png`|
|阿尔茜|Arcee|汽车人|`/assets/brand/arcee-mecha-v2.png`|
|铁皮|Ironhide|汽车人|`/assets/brand/companions-v1/ironhide.png`|
|救护车|Ratchet|汽车人|`/assets/brand/companions-v1/ratchet.png`|
|爵士|Jazz|汽车人|`/assets/brand/companions-v1/jazz.png`|
|千斤顶|Wheeljack|汽车人|`/assets/brand/companions-v1/wheeljack.png`|
|警车|Prowl|汽车人|`/assets/brand/companions-v1/prowl.png`|
|探长|Hound|汽车人|`/assets/brand/companions-v1/hound.png`|
|幻影|Mirage|汽车人|`/assets/brand/companions-v1/mirage.png`|
|横炮|Sideswipe|汽车人|`/assets/brand/companions-v1/sideswipe.png`|
|热破|Hot Rod|汽车人|`/assets/brand/companions-v1/hotrod.png`|
|通天晓|Ultra Magnus|汽车人|`/assets/brand/companions-v1/ultramagnus.png`|
|钢锁|Grimlock|汽车人|`/assets/brand/companions-v1/grimlock.png`|
|艾丽塔|Elita-1|汽车人|`/assets/brand/companions-v1/elitaone.png`|
|天火|Jetfire|汽车人|`/assets/brand/companions-v1/jetfire.png`|
|飞过山|Cliffjumper|汽车人|`/assets/brand/companions-v2/cliffjumper.png`|
|大汉|Brawn|汽车人|`/assets/brand/companions-v2/brawn.png`|
|变速箱|Gears|汽车人|`/assets/brand/companions-v2/gears.png`|
|鲁莽|Huffer|汽车人|`/assets/brand/companions-v2/huffer.png`|
|充电器|Windcharger|汽车人|`/assets/brand/companions-v2/windcharger.png`|
|飞毛腿|Sunstreaker|汽车人|`/assets/brand/companions-v2/sunstreaker.png`|
|蓝霹雳|Bluestreak|汽车人|`/assets/brand/companions-v2/bluestreak.png`|
|开路先锋|Trailbreaker|汽车人|`/assets/brand/companions-v2/trailbreaker.png`|
|消防车|Inferno|汽车人|`/assets/brand/companions-v2/inferno.png`|
|红色警报|Red Alert|汽车人|`/assets/brand/companions-v2/redalert.png`|
|吊车|Grapple|汽车人|`/assets/brand/companions-v2/grapple.png`|
|滑车|Hoist|汽车人|`/assets/brand/companions-v2/hoist.png`|
|轮胎|Tracks|汽车人|`/assets/brand/companions-v2/tracks.png`|
|烟幕|Smokescreen|汽车人|`/assets/brand/companions-v2/smokescreen.png`|
|刹车|Skids|汽车人|`/assets/brand/companions-v2/skids.png`|
|感知器|Perceptor|汽车人|`/assets/brand/companions-v2/perceptor.png`|
|录音机|Blaster|汽车人|`/assets/brand/companions-v2/blaster.png`|
|宇宙飞碟|Cosmos|汽车人|`/assets/brand/companions-v2/cosmos.png`|
|滑翔机|Powerglide|汽车人|`/assets/brand/companions-v2/powerglide.png`|
|浪花|Seaspray|汽车人|`/assets/brand/companions-v2/seaspray.png`|
|巨浪|Beachcomber|汽车人|`/assets/brand/companions-v2/beachcomber.png`|
|战戟|Warpath|汽车人|`/assets/brand/companions-v2/warpath.png`|
|杯子|Kup|汽车人|`/assets/brand/companions-v2/kup.png`|
|啰嗦|Blurr|汽车人|`/assets/brand/companions-v2/blurr.png`|
|弹簧|Springer|汽车人|`/assets/brand/companions-v2/springer.png`|
|转轮|Wheelie|汽车人|`/assets/brand/companions-v2/wheelie.png`|
|沙暴|Sandstorm|汽车人|`/assets/brand/companions-v2/sandstorm.png`|
|排炮|Broadside|汽车人|`/assets/brand/companions-v2/broadside.png`|
|淤泥|Sludge|汽车人|`/assets/brand/companions-v2/sludge.png`|
|铁渣|Slug (Slag)|汽车人|`/assets/brand/companions-v2/slug.png`|
|嚎叫|Snarl|汽车人|`/assets/brand/companions-v2/snarl.png`|
|飞镖|Swoop|汽车人|`/assets/brand/companions-v2/swoop.png`|
|猛大帅|Metroplex|汽车人|`/assets/brand/companions-v2/metroplex.png`|
|大力金刚|Omega Supreme|汽车人|`/assets/brand/companions-v2/omegasupreme.png`|
|威震天|Megatron|霸天虎|`/assets/brand/companions-v1/megatron.png`|
|红蜘蛛|Starscream|霸天虎|`/assets/brand/companions-v1/starscream.png`|
|声波|Soundwave|霸天虎|`/assets/brand/companions-v1/soundwave.png`|
|震荡波|Shockwave|霸天虎|`/assets/brand/companions-v1/shockwave.png`|
|闹翻天|Skywarp|霸天虎|`/assets/brand/companions-v2/skywarp.png`|
|惊天雷|Thundercracker|霸天虎|`/assets/brand/companions-v2/thundercracker.png`|
|挽歌|Dirge|霸天虎|`/assets/brand/companions-v2/dirge.png`|
|喷气机|Ramjet|霸天虎|`/assets/brand/companions-v2/ramjet.png`|
|冲锋|Thrust|霸天虎|`/assets/brand/companions-v2/thrust.png`|
|闪电|Blitzwing|霸天虎|`/assets/brand/companions-v2/blitzwing.png`|
|大火车|Astrotrain|霸天虎|`/assets/brand/companions-v2/astrotrain.png`|
|毒气弹|Octane|霸天虎|`/assets/brand/companions-v2/octane.png`|
|机器狗|Ravage|霸天虎|`/assets/brand/companions-v2/ravage.png`|
|激光鸟|Laserbeak|霸天虎|`/assets/brand/companions-v2/laserbeak.png`|
|锯齿鸟|Buzzsaw|霸天虎|`/assets/brand/companions-v2/buzzsaw.png`|
|轰隆隆|Rumble|霸天虎|`/assets/brand/companions-v2/rumble.png`|
|迷乱|Frenzy|霸天虎|`/assets/brand/companions-v2/frenzy.png`|
|机器蝙蝠|Ratbat|霸天虎|`/assets/brand/companions-v2/ratbat.png`|
|萨克巨人|Scorponok|霸天虎|`/assets/brand/companions-v2/scorponok.png`|
|铁甲龙|Trypticon|霸天虎|`/assets/brand/companions-v2/trypticon.png`|
|狂飙|Cyclonus|霸天虎|`/assets/brand/companions-v2/cyclonus.png`|
|瘟疫|Scourge|霸天虎|`/assets/brand/companions-v2/scourge.png`|
|六面兽|Sixshot|霸天虎|`/assets/brand/companions-v2/sixshot.png`|
|汽车大师|Motormaster|霸天虎|`/assets/brand/companions-v2/motormaster.png`|
|打击|Breakdown|霸天虎|`/assets/brand/companions-v2/breakdown.png`|
|封锁|Dead End|霸天虎|`/assets/brand/companions-v2/deadend.png`|
|抢劫|Drag Strip|霸天虎|`/assets/brand/companions-v2/dragstrip.png`|
|莽撞|Wildrider|霸天虎|`/assets/brand/companions-v2/wildrider.png`|
|袭击|Onslaught|霸天虎|`/assets/brand/companions-v2/onslaught.png`|
|吵闹|Brawl|霸天虎|`/assets/brand/companions-v2/brawl.png`|
|旋风|Vortex|霸天虎|`/assets/brand/companions-v2/vortex.png`|
|爆炸|Blast Off|霸天虎|`/assets/brand/companions-v2/blastoff.png`|
|诈骗|Swindle|霸天虎|`/assets/brand/companions-v2/swindle.png`|
|铲土机|Scrapper|霸天虎|`/assets/brand/companions-v2/scrapper.png`|
|吊钩|Hook|霸天虎|`/assets/brand/companions-v2/hook.png`|
|推土机|Bonecrusher|霸天虎|`/assets/brand/companions-v2/bonecrusher.png`|
|拖斗|Long Haul|霸天虎|`/assets/brand/companions-v2/longhaul.png`|
|搅拌机|Mixmaster|霸天虎|`/assets/brand/companions-v2/mixmaster.png`|
|清扫机|Scavenger|霸天虎|`/assets/brand/companions-v2/scavenger.png`|
|反冲|Kickback|霸天虎|`/assets/brand/companions-v2/kickback.png`|
|弹片|Shrapnel|霸天虎|`/assets/brand/companions-v2/shrapnel.png`|
|炸弹|Bombshell|霸天虎|`/assets/brand/companions-v2/bombshell.png`|
|利爪|Razorclaw|霸天虎|`/assets/brand/companions-v2/razorclaw.png`|
|俯冲|Divebomb|霸天虎|`/assets/brand/companions-v2/divebomb.png`|
|猛虎|Rampage|霸天虎|`/assets/brand/companions-v2/rampage.png`|
|铁头|Headstrong|霸天虎|`/assets/brand/companions-v2/headstrong.png`|
|野牛|Tantrum|霸天虎|`/assets/brand/companions-v2/tantrum.png`|
|饿龙|Hun-Gurrr|霸天虎|`/assets/brand/companions-v2/hungurrr.png`|
|污点|Blot|霸天虎|`/assets/brand/companions-v2/blot.png`|
|裂齿|Rippersnapper|霸天虎|`/assets/brand/companions-v2/rippersnapper.png`|

原3位素材与`companions-v1/`中的17张批准图片保持原样；新增80张使用内置imagegen逐位生成，正式路径为`public/assets/brand/companions-v2/`，保留生成结果的alpha透明通道，不用换色副本或占位图凑数。原提示词见[companion-library-prompts.json](companion-library-prompts.json)，新增提示词与风格参考见[companion-expansion-prompts.json](companion-expansion-prompts.json)。素材是否已全部就绪以当前验收为准，不把目录登记当作图片验证完成。

风格统一为Q版玩具机甲、机械面罩和光学镜，保留各角色标志配色和装甲，不使用拟人眼球、睫毛、嘴唇；无武器或战斗。角色名及阵营参考[Hasbro官方角色资料](https://transformers-bios.hasbro.com/en-us)与[Hasbro Pulse](https://www.hasbropulse.com/)，本项目采用适合儿童的机械面罩造型。

## 人物简介

100段本地中文简介由`shared/companions.ts`的`companionBiographies`统一提供，新增80段维护在`shared/companion-expansion.ts`；保留原20段内容，按本图鉴采用的经典G1身份编写身份、外观、性格与故事导读。涉及其他作品版本时明确区分，不混用《领袖之证》阿尔茜或《Animated》警车等不同设定；霸天虎仍按故事中的对手介绍，不改写为汽车人成员。

身份与基本设定核对来源：[擎天柱](https://transformers-bios.hasbro.com/en-us/optimus-prime-g1-autobot)、[艾丽塔](https://transformers-bios.hasbro.com/en-us/elita-1-autobot)、[钢锁](https://transformers-bios.hasbro.com/en-us/grimlock-autobot)、[红蜘蛛](https://transformers-bios.hasbro.com/en-us/starscream-g1-decepticon)、[声波](https://transformers-bios.hasbro.com/en-us/soundwave-decepticon)、[震荡波](https://transformers-bios.hasbro.com/en-us/shockwave-decepticon)及[千斤顶](https://www.hasbropulse.com/product/transformers-studio-series-the-transformers-the-movie-deluxe-class-wheeljack/G21985X00)的Hasbro官方资料。文字为面向亲子阅读的原创概述，末尾感想属于阅读引导，不作为动画原话或新增剧情。

## 中文动画与页内播放

`shared/companion-videos.ts`及`shared/companion-expansion-videos.ts`为100位人物关联33集普通话G1动画；同集可包含多位伙伴，热破入口明确说明是成长为补天士后的故事。来源为B站上传者“深渊的幽灵”的[98集普通话合集](https://www.bilibili.com/video/BV1RW411E73m/)，资源上传者与播放器提供方分别标明，不称为孩之宝官方上传。萨克巨人对应《新生（下）》，六面兽对应《新生（上）》。

`shared/companion-video-source.ts`保存合集BVID、33个集数/CID与中文标题；使用普通话合集顺序，不直接套用英文播出/制作顺序。已核对合集98个分集的公开元数据，当前页面试播范围及限制见验收，不把元数据等同于逐集完整播放验证。

动画已解锁后点击“看中文动画”，`src/companion-animation.tsx`才加载[哔哩哔哩标准站外播放器](https://player.bilibili.com/)，在当前详情内显示；配置`autoplay=0`、`danmaku=0`，由用户手动开始。页面提供“全屏观看”，通过浏览器标准API请求全屏，失败如实提示并可继续页内看；原生全屏退出后保留当前人物的行为需以实际浏览器验收为准。收起、关闭详情或换人物卸载iframe，重新加载只重建当前播放器；失败/平台登录提示可重试或在国内原站打开同一集。未点击不加载iframe；动画未开只显示剩余新词数，无集数/播放器/原站入口，观看不写学习事实或奖励。

使用外站播放器仍需网络，画质、广告、账号限制和资源上下架由平台决定。本应用仅使用标准嵌入与原站链接，不下载、代理、提取或缓存远程视频。

完整新增动画映射位于`shared/companion-expansion-videos.ts`；链接核验与实际播放边界见[当前验收](ACCEPTANCE.md)。资料核对参考[经典G1角色汇总](https://en.wikipedia.org/wiki/List_of_The_Transformers_characters)、[汽车人中英名对照](https://dm.sohu.com/20070702/n250872248.shtml)及[霸天虎中英名对照](https://dm.sohu.com/20070702/n250872288.shtml)。中译名存在地区差异，本图鉴用英文身份核对，不把同义译名算成不同人物。

中文资源示例：[第一天](https://www.bilibili.com/video/BV1RW411E73m/?p=1)、[天火](https://www.bilibili.com/video/BV1RW411E73m/?p=7)、[五面怪（四）](https://www.bilibili.com/video/BV1RW411E73m/?p=69)、[新生（下）](https://www.bilibili.com/video/BV1RW411E73m/?p=98)。旧YouTube映射已退出当前应用，历史核验仅保留于任务证据。

## 验证边界

素材完整性由静态清单和自动测试检查；界面及实际服务验证统一见 [当前验收](ACCEPTANCE.md)，逐次证据保留于任务记录与本机 `artifacts/`。图鉴展示和角色轮换不修改正式学习证据。
