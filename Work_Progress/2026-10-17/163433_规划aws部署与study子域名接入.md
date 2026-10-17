# 任务记录

## 任务名称
- 规划AWS部署与study子域名接入

## 执行时间
- 开始时间：2026-10-17 16:34:33 +0800
- 结束时间：2026-10-17 16:49:49 +0800

## 仓库根目录
- C:\Users\edwar\Documents\ChatGPT\英语学习

## 任务背景
- 用户要求通过AWS创建study.iteready.com并部署现有学习应用。

## 任务目标
- 核验AWS与DNS访问、应用云端运行约束，明确部署方案和必要配置。

## 已执行动作
1. [16:38:41] 已通过AWS CLI核验irai配置和Route53的iteready.com公共区域，study子域名无记录；us-east-1未发现EC2或Lightsail实例。应用仅允许回环Host，现有PIN不覆盖整站API。已请求使用范围、数据迁移范围与服务器预算选择。
2. [16:43:46] 用户选择仅家人整站保护、迁移原音、优先复用现有服务器。已查明iteready.com由us-east-1的Amplify应用IRai/main托管；扫描启用区域未查到EC2实例，受支持Lightsail区域亦为空，另3个非Lightsail区域端点失败。已告知运行应用需要持久磁盘，并请求是否新建12美元/月实例。整站登录回归与477项完整测试、构建通过。
3. [16:49:48] 已实现整站家庭Cookie登录、30天有效期、失败限制、原家长Bearer授权兼容、私有缓存控制及WebSocket保护；新增Ubuntu/systemd/Caddy部署文件、只读日常备份与完整迁移工具。为保留其他聊天的认听读修改，建立独立codex/deploy-study工作区；该工作区npm ci、check、478项测试、build通过，源码ZIP278文件哈希校验通过。迁移快照65文件30733085字节，2词书17词3学习会话14练习1测试，原音文件0；全部哈希核验通过。

## 结果
- 部署代码、家庭登录、私有迁移快照及可校验源码包已准备；已确认AWS账号和DNS权限，现有主站为Amplify托管。尚未创建计费资源、变更DNS或公开上线。

## 状态
- 部分成功

## 相关文件
- docs/AWS_DEPLOY.md
- server/family-access.ts
- tests/family-access.test.ts
- scripts/deploy/
- README.md
- docs/MVP.md
- docs/TASK_TREE.md

## 验证
- 独立工作区npm ci/check/test/build通过，478项测试、44静态素材；278文件ZIP与65文件迁移快照哈希通过。IAM模拟显示必要Lightsail和Route53动作允许，未实际创建资源。

## 遗留问题/下一步
- 待用户确认新建约12美元/月Lightsail实例，或提供其他已有持久服务器；随后执行远端安装、完整数据迁移、HTTPS与重启验收。云端Codex需官方独立登录。