# 首页 v4：小机甲与清晰主入口

此文档保留v4历史设计与生成记录。当前已由[首页v5](home-courtyard-v5.md)替代：小队稍左移，家长入口放在开始按钮下方。

## 设计依据与取舍

- [Khan Academy Kids 官方界面说明](https://blog.khanacademy.org/supporting-english-language-acquisition-with-khan-academy-kids/)：减少文字，以清晰播放按钮进入学习。本项目只保留一个儿童主按钮，标题与按钮组成左侧控制区。
- [Pok Pok 官方介绍](https://playpokpok.com/)：手绘画面与声音避免过度刺激。本项目据此降低环境装饰密度、减少人物画面占比；不是复制其具体界面。
- [ASTRO BOT 官方素材](https://www.playstation.com/en-us/games/astro-bot/)作为明亮探索氛围的辅助参考。角色仍是家长指定的Q版变形金刚，人物与基地同一场景绘制。
- 上述主次层级与家长入口左下角位置为本项目的设计判断，不声称参考应用使用同一位置。家长按钮有锁图标、至少44px点击高度，继续打开原PIN门槛；竖屏放到底部中央。
- 横版机甲约占画面高度38%，由之前近景改为远景右侧伙伴，左侧超过半幅留作标题与主按钮。竖版上部放操作，下部放小机甲。场景铺满页面，无卡片外框或独立导航留白。

## 最终素材

使用内置 imagegen，无API key、付费API回退、充值或升级。横版以v3场景为角色身份/材质参考，竖版以本次横版为参考，都是重新构图的完整场景；没有程序拼图或程序缩改原图。

- 横版：`public/assets/brand/autobot-courtyard-desktop-v4.png`，1448×1086，4:3。
- 竖版：`public/assets/brand/autobot-courtyard-portrait-v4.png`，941×1672，约9:16。
- 消费者：`shared/visual-theme.ts`、`src/entry-home.tsx`、`src/entry-home.css`。
- 单词图片主题ID、已批准词图、学习记录与发音功能未在本任务中修改。v3文件保留作历史版本。

## 横版完整提示词

```text
Use case: stylized-concept.
Asset type: final full-bleed LANDSCAPE 4:3 background illustration for a private children's vocabulary-learning app. This is artwork, NOT a UI mockup.
Input image 1 role: CHARACTER IDENTITY / MATERIAL REFERENCE ONLY. Do not preserve its crowded close-up composition. Recompose the whole world and drastically reduce the three robot figures.
Primary request: a calm, spacious toy-mecha adventure home screen with a strong EMPTY LEFT control zone and a small integrated group of Q-version Transformers on the RIGHT. The real HTML play button will be the focal point, not enormous characters.
Composition: eye-level medium-wide establishing shot, camera pulled far back. LEFT 55% of the entire image is calm warm ivory negative space with only a subtle, low-contrast continuation of floor/sky, no character or architecture silhouette entering it. Right 45% contains a compact launch courtyard and the three friends. Every part of all three robots including hands and boots stays within x=61–94% and y=42–82%. Optimus Prime about 38% of image HEIGHT, Bumblebee and Arcee about 31–34%; they must look substantially smaller than in the reference. Do not zoom their heads toward camera. Keep plenty of breathing room above them and at the right edge, and visible floor beneath their boots. A gently curved inlaid path may connect the quiet left foreground to the right platform, but no bright decorations near the left control zone.
Subjects: recognizable chibi Optimus Prime in red-blue truck armor with two chest windshields, Bumblebee in yellow-black car armor, Arcee in pink-white vehicle armor. Compact oversized helmet proportions but unequivocally hard-surface ROBOT MECHA faces: opaque silver full faceplates or segmented respirator, narrow angular cyan optical lenses. NO human eyeballs, pupils, lashes, lips, mouths, skin or doll faces. Calm friendly inviting poses, leader looking gently toward the left play area. All six boots on the same deck with consistent perspective, real contact shadows and subtle reflections. Same shared warm soft upper-left light and blue fill.
Environment: bright, inviting futuristic toy exploration courtyard, soft cream floor with a small pale-blue/silver landing deck on the right, a restrained small architectural hangar opening behind the group, soft blue sky and distant pale mountains. Avoid a giant arch framing the entire screen, busy machinery, thick foreground objects, clutter, detailed floor grids, props, planets, particles or glowing gadgets. Premium clean 3D toy craftsmanship, beveled manufactured armor, soft ambient occlusion, matte ivory architecture, sky-blue accents, warm sunlight. Coherent single rendering, no cutout collage, no separate pasted avatars.
Full artwork reaches all four canvas edges; no picture-card border, rounded panel, empty white header strip or decorative framing.
Text: NONE. Do not draw buttons, icons, logos, labels, badges, writing, letters or watermark. No weapons, fighting or frightening elements.
Priority: smaller grounded characters, at least 55% truly usable left space, clear visual hierarchy, low stimulation.
```

## 竖版完整提示词

```text
Use case: stylized-concept.
Asset type: final PORTRAIT 9:16 full-bleed responsive background for a children's vocabulary-learning app, artwork only, no UI.
Input image 1 role: reference for exact SMALLER character scale, identity, toy material, environment and unified lighting. Recompose it vertically, do not crop the landscape.
Primary request: a calm spacious toy-mecha courtyard where HTML title and a big play button can occupy the upper area. The three Q-version Transformers are friendly SMALL supporting companions in the LOWER HALF, not huge close-up heads.
Composition: upper 47% is quiet warm ivory/pale blue atmosphere with subtle clouds and distant pale mountains, very low contrast, clear enough for readable separate UI. No robots or architecture silhouettes enter that upper control area. A compact group is centered slightly right in the lower half, all hands, helmets and boots within x=20–86% and y=53–81%. Tallest Optimus is about 28% of total image HEIGHT, the two companions 24–26%. Leave floor and breathing room below their boots, with lower 12% calm and clear for a small HTML parent button. Shared circular deck, warm ivory floor and small futuristic hangar on the right edge; architecture has low visual weight. No giant frame arch or foreground pillars. One consistent perspective and real contact shadows/reflections for all six boots.
Subject identities: red/blue truck-armored chibi Optimus Prime, yellow/black car-armored Bumblebee, pink/white Arcee. Oversized compact helmets, truly ROBOT MECHA faceplates: rigid opaque silver masks/respirator, narrow angular cyan optics, panel seams. No human eyeballs, round pupils, eyelashes, lips, mouths or doll faces. Same premium 3D toy quality and warm-left/cool-right soft illumination as reference. Calm welcoming stance oriented slightly toward the quiet control area; no weapons or fighting.
Full-bleed continuous illustration across every edge, no card, no border, no white header rectangle, no panel, no text, buttons, icons, badges, logos, letters, numbers or watermark.
Priority: quiet control area above, small grounded robot companions below, clear hierarchy and generous space.
```

## 验证与限制

- 两张生成图已目视核对：机器人较小、机械面罩、同平台接触阴影，无烘焙UI/英文答案；文件PNG尺寸正确。
- 本轮311/311自动测试、生产构建含类型检查通过；离线React SSR确认两个入口、开始按钮在键盘顺序中优先、家长按钮在footer、busy只禁用开始按钮。当前8787新JS/CSS及两张PNG均HTTP200。最终构建曾遇到共享备份校验中unknown词ID未收窄的类型错误，仅补充字符串ID守卫后通过，未改游戏逻辑。
- 基于人工观察的保守人物范围，独立计算13组视口的cover裁切与按钮范围，未发现按钮/人物相交或人物超出视口；这是离线几何预检，**不是浏览器DOM测量或视觉验收**。
- Work仍拒绝本聊天的本地浏览器控制，本轮没有实际页面截图或真实点击验收。证据在忽略的`artifacts/home-v4-qa/`。
