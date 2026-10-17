# 家庭云端部署核验记录（已暂缓）

2026-10-17用户决定暂时只在本地运行，不部署云端。未创建AWS资源、变更DNS或上传数据。以下方案与已验证代码草案仅保留于独立工作区`C:/Users/edwar/Documents/ChatGPT/英语学习-study-deploy`、分支`codex/deploy-study`，不属于当前本机功能；文中的部署脚本路径均相对于该工作区。

## 范围与入口

仅一个家庭、一个孩子档案。`study.iteready.com` 是计划入口；域名和应用就绪状态以本页的实际部署记录为准。`iteready.com` 现有 Amplify 主站、邮件与DNS记录保持原状。

当前版本将SQLite、素材和原音存为本地文件，原样部署需要持久磁盘；也可以改成Amplify加云端持久存储。已准备的实例方案位于 `scripts/deploy/`，使用Ubuntu/Caddy与回环Node服务；该方案尚未创建实例。用户已提出优先核验Amplify，未批准固定月费服务器。

## Amplify方案核验（尚未实现）

Amplify支持React静态前端，也支持通过部署规范运行Node.js HTTP后端。当前官方规范允许512MB临时存储，仅`/tmp`可写，实例之间不共享文件，实例运行期最长15分钟。不能将该目录里的SQLite或录音当作长期事实层；“必须买独立服务器”并非唯一方案。

可行改造方向：

- Amplify提供`study.iteready.com`的网页、HTTPS及请求入口，独立学习应用不替换现有IRai主站。
- 学习状态、进行中轮次、幂等启动、日额度与核验版本写入DynamoDB等持久数据库；登录失败计数及家长授权也需跨实例保存，不能仅保留进程内Map。
- 图片、发音缓存与原音存入私有S3，原音继续独立授权访问、核验后删除；常规备份不复制原音，不因对象版本保留而悄悄留下应删除的录音。
- Codex补词、生图和AI初判继续使用现有电脑上的官方登录，需设计受限任务队列及本机执行端；电脑关闭时这些任务等待，孩子已备好的学习、云端录音和进度保存可独立运行。不得复制OAuth认证文件或默认切换付费API。此项属于拟实现流程，尚无云端端到端验证。
- Amplify SSR Compute角色可使用短期IAM凭证访问指定数据库和存储，不上传当前电脑的AWS访问密钥。云端临时存储、并发写入、后台任务及删除原音须单独回归。

Amplify按构建、流量、存储和SSR使用量计费，后端服务另计；复用账号或已有主站不代表新应用免费。单家庭是否更便宜取决于实际流量、构建频率和免费额度，当前未核验账户剩余额度，也未承诺零费用。

核验来源：[部署规范](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html)、[SSR Compute角色](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html)、[Amplify价格](https://aws.amazon.com/amplify/pricing/)。

## 整站访问

`PLAYROOM_PUBLIC_ORIGIN=https://study.iteready.com` 与 `PLAYROOM_ACCESS_FILE=/etc/playroom/access.json` 必须同时设置。配置无效时启动失败。Caddy代理固定内部Host并覆盖转发IP，应用校验精确来源；所有页面、API、媒体及WebSocket均要求家庭登录，家长核验仍额外要求原PIN授权。

维护者在受限本地目录运行 `node --import tsx scripts/create-family-access.ts` 生成随机家庭密码与加盐哈希。密码文件仅交给家长保存；`access.json`经SSH传输，属主root、属组playroom、权限0640。应用只读取哈希和签名密钥，不存明文密码。

`GET /login`显示家庭登录；`POST /api/access/login {password}`验证后设置30天的Secure/HttpOnly/SameSite=Strict Cookie；五次失败后暂停15分钟。`POST /api/access/logout`退出当前设备。云端`AppState.familyAccess=true`，家长空间设置页提供退出按钮，授权过期返回登录页。`Authorization: Bearer`继续专用于原有家长测评授权。轮换整站密码时在新目录重新生成配置并更换服务端文件，重启服务，所有旧设备登录失效。

## 数据与配置

- 程序：`/opt/playroom/releases/<版本>`，`/opt/playroom/current`指向当前版本。更新不覆盖数据；回滚只更换程序指向。
- 数据与原音：`/var/lib/playroom/data`，playroom属主、0700目录；`/media`仍不能读取两类原音，家长回听仍需PIN授权。云端新录音保存在这台服务器的私有目录。
- 配置：`/etc/playroom/app.env`，root属主、0640权限；仅包含必要的ElevenLabs配置、精确公开来源与访问配置路径。AWS凭据、Windows路径和本机Codex OAuth不上传。
- 日常学习备份：`/var/lib/playroom/backups`，每日保留14份，不含PIN、密钥、家庭访问配置与原始录音。备份以只读连接导出，不触发活跃任务的启动恢复。备份在同一实例磁盘，仍需定期下载到家庭另一设备；不启用会包含原音的全盘自动快照。

完整迁移由 `node --import tsx scripts/deploy/stage-migration.ts` 创建SQLite在线一致快照，仅复制PIN、images、speech、practice-recordings、assessment-recordings及哈希清单。迁移工具拒绝链接和OAuth认证文件，原本机数据保留。目标为空实例时直接放入快照，保留原音状态；普通学习备份恢复仍沿用缺音标记，不能代替这次完整迁移。

现有图片和发音缓存可直接学习。ElevenLabs继续沿用原来的免费/包含额度护栏。Codex需在服务器使用官方客户端单独登录；不能复制本机`auth.json`，也不自动切换付费API。未登录时词义补全、生图和挑战AI初判如实不可用，已有词书可学，家长仍可核验。云端“连接/检查Codex”只检查服务器状态，避免生成指向用户电脑回环地址的无效授权。

## 安装与更新

1. 核对AWS账号、资源名、区域、费用与现有站点，创建或明确指定持久实例和静态IP。
2. 使用专用SSH密钥；执行`bootstrap-ubuntu.sh`安装校验过哈希的Node24.14.0和系统包Caddy，建立独立playroom用户与目录。
3. 上传已检查的源码包，在新版本目录执行`npm ci`、`npm run check`、`npm test`、`npm run build`。包含dev依赖，因为运行时使用tsx。上传访问配置、环境文件、已核对的私有迁移数据，限制权限。
4. 安装`playroom.service`和备份service/timer。配置好家庭登录后启动Node，使用实际家庭登录验证回环接口；未经登录应全部拒绝。检查数据、图片、发音、PIN与会话恢复。
5. 添加`study` A记录到专用静态IP，安装Caddyfile并验证配置，启用Caddy取得证书。确认HTTP跳HTTPS、有效证书、未登录拒绝与登录后的真实页面/API/素材访问。
6. 复核systemd自动启动、备份排程、远端数据哈希与重启持久化；记录AWS资源、版本、成本和真实云服务限制。更新版本保留旧目录用于回滚。

## 实际部署记录

- 2026-10-17：已核验`iteready.com`的Route53区域及Amplify主站，`study`记录尚不存在；当前账号未查到EC2/Lightsail运行实例。尚未创建计费资源、修改DNS或上线。
- 家庭登录代码、迁移工具和部署配置已准备；完整迁移快照65个文件、约30.7MB，两类原音目录当前无文件。待用户确认新建实例或提供其他已有服务器后继续部署。
- 部署版本固定在独立工作区`英语学习-study-deploy`、分支`codex/deploy-study`，使用已完成的学习版本与本轮云端改动；另一聊天进行中的认听读目标修改未纳入。已独立安装、检查、完整测试、构建和校验源码包；尚未执行远端安装与HTTPS验收。
