# 20位变形金刚伙伴

2026-10-17按家长要求扩充，不限阵营。人物清单真源为`shared/companions.ts`，统一由`shared/visual-theme.ts`供界面与配图使用。

## 使用方式

- 首页右下角“伙伴图鉴”可查看全部20位；页面与大厅统一顶部留白、返回按钮、浅色卡片和机甲伙伴，卡片只保留角色图、名字与进入箭头。
- 顶部按“全部20 / 汽车人16 / 霸天虎4”筛选，无需输入或分页。点图片查看大图、阵营、英文名及每位约200字的完整中文简介，开头一句突出身份，其余内容继续完整显示。
- 左右按钮或键盘方向键在当前组内循环，关闭或Esc返回，保留筛选、浏览位置并将焦点还给原卡片。详情打开时背景不可操作，Tab焦点留在详情内；角色切换后阅读区回到顶部。
- 桌面详情图文并排，手机上下排列、短屏内容可滚动，关闭和切换按钮始终保留。无需解锁，不修改学习档案。
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

## 验证边界

素材完整性由静态清单和自动测试检查；界面及实际服务验证统一见 [当前验收](ACCEPTANCE.md)，逐次证据保留于任务记录与本机 `artifacts/`。图鉴展示和角色轮换不修改正式学习证据。
