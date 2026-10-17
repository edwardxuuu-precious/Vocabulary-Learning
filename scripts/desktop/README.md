# 桌面图标

桌面使用 `playroom-simple.ico`：扁平黄色机甲头像、蓝色双眼、透明背景，不含文字、渐变或人物全身细节。可编辑源文件为 `public/assets/brand/playroom-simple.svg`，包含 16、24、32、48、64、128、256 像素尺寸。

重新生成：`powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File scripts/desktop/build-icon.ps1`。脚本使用 Windows 自带 WPF 渲染源 SVG 中的纯色路径，无需额外依赖或外部服务。

生成脚本同时同步 `public/assets/brand/playroom-simple.ico`，供浏览器标签页使用；桌面与浏览器图标内容相同。修改源图并审核后运行 `npm.cmd run assets:update` 更新素材清单。旧版图标已移除，历史可从 Git 追溯。

安装：在项目根目录运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1`。快捷方式指向当前项目，不包含学习数据或密钥。项目移动后重新运行安装命令。
