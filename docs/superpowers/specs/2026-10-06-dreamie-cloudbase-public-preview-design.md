# Dreamie CloudBase 公网测试与匿名记忆设计

## 目标

将当前运行在 Mac 上的 Dreamie MVP 部署为腾讯云 CloudBase 云托管服务，获得可从任意网络访问的固定 HTTPS 测试地址。任何拿到链接的人无需登录即可使用；每个浏览器拥有独立匿名身份，其偏好、收听反馈和会话摘要持久化至同一 CloudBase 环境中的 PostgreSQL 数据库。

本阶段的成功标准是：手机可通过 CloudBase 默认 HTTPS 域名完成文字聊天、长按录音转文字、Agent 回复、背景音推荐与播放；同一浏览器下次访问能够使用自身的历史偏好，其他浏览器不能读取或影响其记忆。

## 已确认决策

- CloudBase 环境 ID：`dreamie-d1gakfvvs849daf19`。它可以出现在部署说明和非密钥配置中。
- 数据库：使用创建环境时选择的 PostgreSQL。
- 访问：默认公网域名公开可访问；本阶段不设置密码、登录或 CloudBase Access。
- 身份：前端生成并保存匿名浏览器 ID；不共享原有 `local-user` 记录。
- 隐私：保存结构化偏好、收听事件和最多 300 字会话摘要；不保存完整逐字对话。
- 服务：使用 CloudBase 云托管默认域名，仅作为 MVP 测试入口；暂不购买域名或承诺生产 SLA。
- 保持现有视觉、文字/语音输入、TTS、背景音逻辑和静态资源，不添加产品功能。

## 范围与非目标

本阶段包含容器化部署、PostgreSQL 记忆存储、匿名身份透传、运行端口适配和云端环境变量说明。

不包含账号体系、短信/邮箱验证、跨浏览器找回、用户数据管理页、删除/导出入口、支付、正式自定义域名、ICP备案、运维监控、数据库备份策略、对语音识别服务的网络替代或多区域高可用。

## 架构

```text
匿名浏览器
  ├─ localStorage: dreamie_user_id、dreamie_session_id
  └─ HTTPS 请求（userId、sessionId、message / audio）
        ↓
CloudBase 云托管默认域名
  ├─ Node Dreamie Web Server
  │   ├─ 页面、小羊素材、背景音文件
  │   ├─ /api/chat
  │   ├─ /api/transcribe
  │   └─ /api/audio/:trackId
  ├─ DeepSeek / MiniMax / DashScope（仅服务端调用）
  └─ CloudBase PostgreSQL
        ├─ user_profile
        ├─ sessions
        ├─ listening_events
        └─ memory_items
```

云托管通过 `PORT` 环境变量指定监听端口；本地开发缺省使用 3000。服务监听 `0.0.0.0`。根目录页面和 `dreamie-mvp` 服务代码会同时复制进容器，因此静态资源路径不能依赖开发机的绝对路径。

## 匿名身份与 API

前端在启动时执行：

1. 读取 `localStorage.dreamie_user_id`。
2. 若不存在，使用浏览器 `crypto.randomUUID()` 生成 UUID 后保存。
3. 读取/复用 `localStorage.dreamie_session_id`。
4. 所有 `/api/chat` 请求携带 `userId`；会话 ID 只在其所属用户下有效。

`POST /api/chat` 请求变为：

```json
{
  "userId": "浏览器 UUID",
  "sessionId": "可选会话 UUID",
  "message": "今天很累"
}
```

服务端只接受合法 UUID。缺失或非法 ID 返回 400，不创建共享回退用户。`/api/transcribe` 不持久化音频，仅完成转写；聊天请求再携带匿名身份进入记忆流程。

匿名 ID 是识别键而非身份认证：知道或伪造某个 UUID 的人理论上可冒充该浏览器。本阶段的公开测试接受这一限制；正式版本必须改为经过验证的账号或签名会话。

## PostgreSQL 记忆存储

新建 `PostgresMemoryStore`，实现已有 `MemoryStore` 接口，并把 `userId` 从硬编码 `local-user` 改为每个操作的显式参数或绑定到单用户 store 实例。`WebSessionService` 创建、读取和记录会话时必须使用请求用户的 store，不能仅根据 `sessionId` 跨用户复用内存会话。

数据库保留本地 SQLite 的四张表和字段含义：

- `user_profile`：每个匿名用户一行稳定设置。
- `sessions`：一次会话的开始/结束、最终情绪和短摘要。
- `listening_events`：推荐、播放、换歌、喜欢和不喜欢。
- `memory_items`：用于推荐的结构化长期偏好。

迁移使用幂等 `CREATE TABLE IF NOT EXISTS` 和唯一约束，首次部署自动初始化。查询必须使用参数化 SQL。连接串只从 `DATABASE_URL` 环境变量读取；它不得写入代码、日志、测试快照、Docker 镜像层或 Git。

原有 SQLite 存储继续用于本地开发。配置明确选择 `MEMORY_STORE=sqlite`（默认）或 `MEMORY_STORE=postgres`。PostgreSQL 初始化或写入失败时，云端请求返回友好的临时错误，不回退到所有用户共享的内存或 SQLite 文件。

## 云端密钥与配置

CloudBase 控制台中配置以下环境变量：

- `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`
- `MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_SPEED`、`MINIMAX_TTS_VOICE_ID`
- `DASHSCOPE_API_KEY`、`DASHSCOPE_ASR_MODEL`
- `DATABASE_URL`
- `MEMORY_STORE=postgres`
- `PORT`：由 CloudBase 提供时优先使用；本机无需设置。

`TCB_ENV_ID=dreamie-d1gakfvvs849daf19` 只用于 CloudBase 部署目标，不是运行时密钥。`.env.local`、证书目录、本地 SQLite 数据库、云端数据库 URL 和任何密钥一律不进入镜像或版本控制。

## 部署包

容器使用项目锁文件安装依赖，编译或运行 Node 服务，复制：

- 根目录的 `index.html`、`app.js`、`styles.css`；
- `assets/mascots/`；
- `dreamie-mvp/src/`、`package.json`、锁文件和运行所需配置；
- `dreamie-mvp/assets/audio/background/`。

容器不能复制 `.env.local`、`.local-https/`、`data/`、`generated-audio/` 或开发缓存。云端只开放 CloudBase 指定端口，不使用本地 HTTPS 证书；公网 HTTPS 由 CloudBase 默认域名终止。

CloudBase 控制台部署后生成固定默认公网域名。此地址和部署日志不得打印密钥或数据库 URL。背景音接口继续只按目录中登记的 `trackId` 读取文件，拒绝任意路径。

## 错误处理与可观测性

- 缺少运行时配置：服务启动失败并输出变量名，不输出值。
- PostgreSQL 连接失败：`/api/chat` 返回中文错误；不会把请求转为其它用户或共享存储。
- 模型、TTS、ASR 失败：沿用现有用户可见中文错误；日志不记录 API Key、音频原始 base64 或完整用户消息。
- 语音上传仍限制为 8 MB；未知静态路径、音频 ID 和跨用户会话返回 404/400。
- CloudBase 默认域名仅用于测试；公开链接意味着任何持有链接的人可创建自己的匿名记录，需在控制台关注流量与成本。

## 测试与验收

1. 配置解析能区分 `sqlite` 与 `postgres`，并在 postgres 模式缺少 `DATABASE_URL` 时失败。
2. PostgreSQL store 与 SQLite store 对相同 `MemoryStore` 行为产生等价的档案、事件和偏好结果。
3. 两个不同匿名用户的事件、推荐上下文和会话摘要完全隔离。
4. 非 UUID 用户 ID、缺失用户 ID、跨用户 sessionId 均返回安全错误。
5. 本地已有前端交互、语音 MIME、Web API、音频目录、记忆策略、ASR 测试继续通过，TypeScript 检查通过。
6. 构建的容器不含 `.env.local`、本地数据库和本地 HTTPS 私钥；以 CloudBase `PORT` 启动后可返回页面和健康检查响应。
7. CloudBase 部署成功后，手机通过默认 HTTPS 域名完成匿名文字会话；同一浏览器刷新后仍读取自己的记忆，另一浏览器不读取该记忆。

## 风险与后续

- 默认 CloudBase 域名有测试用途限制；正式发布前需要购买和绑定域名，并按部署地区处理备案和证书。
- CloudBase 云托管容器文件系统不持久化，因此只使用 PostgreSQL 保存用户状态；不把 SQLite 文件当作云端存储。
- DashScope 可用性取决于云端网络和 API 权限；若失败，后续单独替换 ASR 提供商，避免影响记忆和部署架构。
- 无认证匿名 ID 不适合敏感或高风险数据。正式版必须提供删除、导出、同意提示和认证机制。
