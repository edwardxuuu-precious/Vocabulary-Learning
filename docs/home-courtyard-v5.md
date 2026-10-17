# 首页 v5：左移机甲与常用家长入口

## 本次调整

- 用户明确要求小队再向左一些，家长入口应作为常用操作醒目展示。
- 横竖版通过内置 imagegen 编辑：小队连同落地关系、接触阴影和反射向左小幅调整，保持小机甲比例、机械面罩及完整身体；继续使用同一基地和光照。
- 两个按钮放在标题下同一操作组中，顺序是“开始玩”“家长空间”。宽屏290px同宽，儿童按钮88px高，家长按钮66px高；使用蓝白底、人物图标、18px字和方向箭头。家长点击仍调用原openParent和PIN验证，aria-label保留“家长入口”。
- 竖屏同样成组居中，短屏/方形屏使用紧凑尺寸，家长按钮最低52px高；原页角footer按钮移除。家长入口在孩子加载期间仍可使用，键盘顺序先儿童后家长。
- 首页素材引用改为v5；词图主题ID、已批准单词素材及学习记录不在本任务修改。

## 最终文件与生成方式

使用内置 imagegen 编辑模式，无API key、付费API回退、充值或升级；没有用代码拼图或移动原图像素。

- `public/assets/brand/autobot-courtyard-desktop-v5.png`：1448×1086，输入为同名v4横版。
- `public/assets/brand/autobot-courtyard-portrait-v5.png`：941×1672，输入为同名v4竖版。
- v4编辑输入已随旧图原路径和哈希归档到工作区 `artifacts/archive/retired-static-assets-20261017.zip`；运行仅依赖本页v5输出。设计原则见[当前主题](autobot-theme-assets.md)，基础生成提示词保留在下方。

### 横版最终编辑提示词

```text
Use case: precise-object-edit.
Edit target: the supplied final landscape 4:3 app background.
Make ONE subtle composition adjustment: move the complete three-robot group and its shared contact shadows/reflections about 6 percent of the canvas WIDTH to the LEFT (roughly 85 pixels in the original 1448px canvas). Shift the small occupied landing-deck area coherently with their footing, but keep the distant building, mountains, sky, lighting and overall floor perspective in place. Fill revealed floor naturally. Their new group center should be around x=69% instead of about 75%. The entire group must still remain in the right half, keeping at least the left 48 percent calm and usable for separate HTML controls.
Preserve every robot's exact smaller scale, full-body framing, character identities, welcoming poses, armor colors/materials, chibi proportions and hard mechanical faces. Preserve silver masks and narrow cyan optical lenses, no human eyes/lips/lashes. Keep all six boots planted and the unified shadows/reflections believable. Do NOT enlarge characters, re-stage them into a close-up, add extra objects, change weather, add text/UI/buttons/logos, add a border or crop any helmet, hand or boot. Same 4:3 landscape canvas, premium coherent 3D toy rendering. This is a small leftward reposition, not a redesign of the scene.
```

### 竖版最终编辑提示词

```text
Use case: precise-object-edit.
Edit target: supplied final portrait 9:16 app background.
Make ONE small adjustment: move the entire three-robot group, its footing, contact shadows and reflections about 8 percent of canvas WIDTH to the LEFT (about 75px in the 941px source), so the group's center is near x=53%, rather than noticeably right of center. Preserve their current small size and vertical position in the lower half. Preserve all armor shapes, identities, mechanical faceplates, narrow cyan optical lenses, poses and full-body framing. Do not add human facial features. Keep the sky, mountains and hangar in their current composition; naturally repair the revealed floor, maintaining the coherent platform perspective and common lighting. Same portrait 9:16 canvas.
Keep the quiet upper control area, same soft sky and ivory palette, and floor below the robots. No added items, text, buttons, UI, labels, logos, border or watermark. No change in zoom or character scale. All hands, antennae and boots stay fully visible. This is a subtle leftward composition correction only.
```

## 验证边界

当前资源哈希由静态清单检查，运行与界面验证见 [当前验收](ACCEPTANCE.md)。以下保留在用素材的完整来源提示词，供明确授权后的素材维护；修改仍须家长审核。

## 编辑输入的基础生成提示词

以下保存v5编辑之前的横竖基础生成指令，作为素材来源；当前程序不读取旧图或历史目录。

### 横版基础

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

### 竖版基础

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
