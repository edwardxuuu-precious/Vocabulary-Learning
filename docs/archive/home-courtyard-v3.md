# 首页一体场景 v3（2026-10-17）

本文件保留v3素材与历史实现记录。当前首页已改用[小机甲场景 v4](home-courtyard-v4.md)，以v4文档和当前代码为准。

## 当前实现

- 内置 image_gen 生成，未使用付费 API 回退，未充值或升级。角色和基地在同一画面重新绘制，共享相机、地面、光照、接触阴影及反射；不再用 CSS 叠放三个角色贴图。
- 桌面图：`public/assets/brand/autobot-courtyard-desktop-v3.png`，1536×1024（3:2）。
- 竖屏图：`public/assets/brand/autobot-courtyard-portrait-v3.png`，1086×1448（3:4），按桌面图重新构图，不直接裁切角色。
- 首页场景铺满视口，取消固定比例卡片外框、四周边距、圆角和阴影；导航绝对定位悬浮于场景，不再单独占用顶部高度。宽屏图按视口高度等比展示，右侧对齐、左缘与同色底柔和衔接，避免拉伸或上下裁切机甲；较窄横屏将标题/按钮上移。820px 以下或宽高比不超过6:5时使用竖版，标题与按钮悬浮于上/下，人物保持完整比例。
- 右上角家长入口保留，移除“汽车人小队”、闪光粒子与独立人物阴影。没有新增生图或语音请求。
- 头像和单词生图规则仍为 `transformers-mecha-v2`，本次未改变词书、批准状态或发音功能。

## 生成方式和输入

方式：内置 imagegen 工具。桌面场景以三张 `*-mecha-v2.png` 为角色身份参考；竖版以本次桌面场景为参考。以下为最终完整提示词，未再做程序拼图或图片处理。

### 桌面提示词

```text
Use case: stylized-concept. Asset type: ONE unified landscape 3:2 hero scene for a private children's English vocabulary game, not a UI mockup. Input images 1, 2 and 3 are CHARACTER IDENTITY REFERENCES ONLY: mechanical-face chibi Optimus Prime, Bumblebee and Arcee. Re-stage and re-render them as actual occupants of ONE continuous world, never paste the reference cutouts over a background. Preserve their recognisable red/blue truck, yellow/black car and pink/white vehicle armor, Q-version big helmet proportions, rigid silver faceplates/respirator masks and narrow glowing cyan optical lenses. NO human eyeballs, round pupils, eyelashes, lips, smiling mouths or human faces. Compose a premium animated 3D toy-mecha adventure key visual. Scene is a beautifully designed bright AUTOBOT EXPLORATION GARAGE / futuristic launch courtyard in warm ivory, powder blue and brushed silver, with a tasteful curved architectural hangar arch, a circular inlaid landing deck, tiny cyan illuminated seams, just a few mechanical background details. Soft blue sky and distant pale mountains through the arch. Cheerful, not military, not a battle, no fantasy floating islands, no bushes, waterfall or giant space moons. Crucial composition: LEFT 40 percent is genuinely uncluttered softly lit warm off-white negative space, blending naturally into the architecture on the right, to receive separate HTML headline/button. ALL THREE characters and entire deck are contained in RIGHT 60 percent, with safe margins so nothing is cut off. Optimus stands center-right as group leader, Bumblebee on his left and Arcee on his right. All three are similar physical toy size, side characters about 85 percent of leader height, not tiny children beside a giant. All SIX FEET are physically planted on the SAME deck plane, boots in contact with floor, properly converging ground perspective, natural overlaps, weight-bearing poses, visible physically accurate contact shadows and ambient occlusion. Camera is one consistent 50mm three-quarter view from slightly above waist height; no independent character perspective. One shared broad key light from upper left, cool soft fill from right, coherent reflections on armor and floor. Welcoming calm poses rather than exaggerated wave line-up, all face slightly toward the viewer. The whole architecture, platform and characters must look like a single professionally art-directed rendered scene with matching scale, depth, lighting and color grade. Main group occupies x=52–94 percent and y=20–87 percent. Plain off-white margins top/bottom with a gentle atmosphere so scene fits an app cleanly. No text, lettering, numbers, badges, logos, interface, buttons, title, labels, watermark, weapons, blades, damage or violence. Keep full helmet antennae, hands and feet in frame.
```

### 竖屏提示词

```text
Use case: stylized-concept. Asset type: ONE portrait 3:4 responsive hero illustration of a unified chibi Transformers launch courtyard. The provided landscape scene is the reference for exact character identity, hard mechanical faces, material quality, palette, shared lighting, environment and physical grounding. RECOMPOSE it as a portrait scene, not a crop and not a UI. Keep Optimus Prime, Bumblebee and Arcee full-body together in the same bright ivory and pale-blue futuristic exploration garage with the same circular illuminated deck and tasteful arch. Leader Optimus centered slightly forward; yellow Bumblebee to viewer's left, pink-white Arcee to right, side characters about 85 percent of leader's physical height, Q-version big-helmet compact bodies. Three clearly mechanical robot faces: angular cyan optical slits/visor, opaque silver mask/respirator, no human eyes or lashes or lips. Camera, floor perspective and scale must be shared. All six boots firmly planted on the same deck plane, proper contact shadows, ambient occlusion and subtle floor reflections. Shared soft warm key light from upper-left and cool fill, matching color temperature across all characters and architecture. Character group fills most of frame, x=8–94 percent, y=9–86 percent, with comfortable safe space around antennae, hands, feet and deck edge. Give enough visible floor below the boots that their grounding is clear. Do NOT add large empty copy zones: HTML heading and button will be outside this portrait illustration. Balanced triangular group, friendly confident stances with subtle natural overlaps, no large waving hands. Architectural details fade softly into pale off-white at image edges for a clean app background. Bright calm premium 3D toy-mecha adventure, no battle, weapons, plants, floating islands, moon collage, gimmicky particles, letters, text, badges, logo, watermark, UI controls or buttons.
```

## 验证范围

- 人工目视两张实际生成图：三机甲完整可见，机械面罩和青色窄光学镜，同平台接触阴影和反射；没有烘焙界面文字。
- `npm.cmd run build`（含类型检查）通过。离线 React SSR 核对2按钮、1 picture、两个版本资源、忙碌时仅禁用儿童入口；本机8787当前JS/CSS与两张PNG均HTTP200。
- 证据：忽略目录 `artifacts/home-courtyard-v3-qa/` 的 `home-ssr.html` 与 `result.json`。
- Work仍返回 `Local browser use is disabled in Work settings`，没有本轮真实页面截图或移动端现场验收。SSR不等于浏览器交互/布局验证。
