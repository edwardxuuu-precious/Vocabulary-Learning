# 20位变形金刚伙伴

2026-10-17按家长要求扩充，不限阵营。人物清单真源为`shared/companions.ts`，统一由`shared/visual-theme.ts`供界面与配图使用。

## 使用方式

- 首页右下角“伙伴图鉴”可查看全部20位；点图片看大图及每位约200字的中文简介，左右按钮循环切换，关闭或Esc返回。桌面图文并排，手机上下排列、短屏内容可滚动，关闭和切换按钮始终保留。无需解锁，不修改学习档案。
- 学习和小游戏按已保存会话及任务位置轮换伙伴；同一任务刷新后角色稳定，下一环节再换。通用等待头像按本地日期选择伙伴。
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
|威震天|Megatron|霸天虎|`/assets/brand/companions-v1/megatron.png`|
|红蜘蛛|Starscream|霸天虎|`/assets/brand/companions-v1/starscream.png`|
|声波|Soundwave|霸天虎|`/assets/brand/companions-v1/soundwave.png`|
|震荡波|Shockwave|霸天虎|`/assets/brand/companions-v1/shockwave.png`|

原3位素材保留在`public/assets/brand/`；本轮17位素材分别使用内置imagegen生成，最终PNG保存在`public/assets/brand/companions-v1/`。每张均保留生成结果的alpha透明通道，未程序改画。完整逐角色提示词见[companion-library-prompts.json](companion-library-prompts.json)。无付费图片API回退、充值或升级。

风格统一为Q版玩具机甲、机械面罩和光学镜，保留各角色标志配色和装甲，不使用拟人眼球、睫毛、嘴唇；无武器或战斗。角色名及阵营参考[Hasbro官方角色资料](https://transformers-bios.hasbro.com/en-us)与[Hasbro Pulse](https://www.hasbropulse.com/)，本项目采用适合儿童的机械面罩造型。

## 人物简介

20段本地中文简介维护在`shared/companions.ts`的`companionBiographies`，按本图鉴采用的经典G1身份编写；各段约200字，说明身份、外观、性格与代表本领。涉及其他作品版本时明确区分，不混用《领袖之证》阿尔茜或《Animated》警车等不同设定；霸天虎仍按故事中的对手介绍，不改写为汽车人成员。

身份与基本设定核对来源：[擎天柱](https://transformers-bios.hasbro.com/en-us/optimus-prime-g1-autobot)、[艾丽塔](https://transformers-bios.hasbro.com/en-us/elita-1-autobot)、[钢锁](https://transformers-bios.hasbro.com/en-us/grimlock-autobot)、[红蜘蛛](https://transformers-bios.hasbro.com/en-us/starscream-g1-decepticon)、[声波](https://transformers-bios.hasbro.com/en-us/soundwave-decepticon)、[震荡波](https://transformers-bios.hasbro.com/en-us/shockwave-decepticon)及[千斤顶](https://www.hasbropulse.com/product/transformers-studio-series-the-transformers-the-movie-deluxe-class-wheeljack/G21985X00)的Hasbro官方资料。文字为面向亲子阅读的原创概述，末尾感想属于阅读引导，不作为动画原话或新增剧情。

## 验证

- 类型检查、静态素材检查、完整自动测试及生产构建通过；覆盖人物库素材完整性、完整轮换及配图角色分配回归。
- 20位详情简介逐一通过本机浏览器核验，长度203–213字（含标点），图片均加载，20→1循环正确；390×640手机短屏无横向溢出，能读到简介末尾，切换后滚动回顶部，关闭及切换按钮可见，Esc关闭后焦点回到原卡片。截图位于`artifacts/companion-biographies/`。
- 17张新增素材均为有效RGBA PNG；20位页面图全部加载，桌面图鉴与20→1大图循环已实测。
- 390px手机图鉴无横向溢出，大图左右边界20–370px、关闭按钮完整可点；Esc关闭后焦点回到原人物卡片。已修正页面入场动画造成的大图定位偏移和手机网格最小宽度溢出。
- 隔离浏览器完成认识词后进入听辨，伙伴由艾丽塔切换为天火；刷新并恢复后仍为天火。未增加正式答题记录。
- 正式8787已更新，重启前后档案、词表、学习证据、会话和用量等九项一致。本轮未请求新单词图或语音；配图角色分配通过单元测试验证，不等同于20种角色的真实单词图验收。
