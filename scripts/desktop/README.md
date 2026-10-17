# 桌面图标

`playroom.ico` 由已批准的 `public/assets/brand/bumblebee-mecha-v2.png` 转为 Windows 多尺寸图标，保留原图内容和透明背景，包含 16、24、32、48、64、128、256 像素尺寸。

重新转换：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/desktop/build-icon.ps1`。

安装：在项目根目录运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1`。快捷方式指向当前项目，不包含学习数据或密钥。项目移动后重新运行安装命令。
