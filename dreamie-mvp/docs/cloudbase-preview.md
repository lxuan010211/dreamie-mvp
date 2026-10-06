# Dreamie CloudBase 测试发布

目标环境：`dreamie-d1gakfvvs849daf19`。

在 CloudBase 控制台打开该环境的“云托管”，新建服务：

1. 部署方式选择从代码仓库或上传代码包，并选择项目根目录中的 `Dockerfile`。
2. 服务端口填 `8080`，开启公网访问。
3. 在环境变量中直接粘贴（不要发到聊天或提交 Git）：
   - `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`
   - `MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`
   - `DASHSCOPE_API_KEY`、`DASHSCOPE_ASR_MODEL`
   - 从 PostgreSQL「配置 / 连接信息」填入 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`。这是推荐方式，不需要手动拼接连接字符串。
   - 如控制台提供完整 URI，也可仅填写 `DATABASE_URL`，不必同时填写 `PG*` 字段。
   - `MEMORY_STORE=postgres`
4. 等待版本状态为健康，复制控制台显示的默认 HTTPS 域名；不要使用本机 IP 或本地 HTTPS 证书。

服务发布后，用手机蜂窝网络或任意非本机网络打开默认 HTTPS 域名。验证：页面加载、文字聊天、长按录音、背景音播放，以及刷新后匿名用户的偏好是否仍存在。

本机没有 Docker，因此镜像构建验证以 CloudBase 的构建日志为准。若构建失败，请复制不含密钥的错误摘要。

## 本地 Agent 工具调用验证

Dreamie 现在会先让主脑判断是否需要调用工具，而不是每次都按固定规则播放音频。可在项目目录中启动本地服务后，依次发送以下消息验证：

1. `今天有点累，陪我聊聊天`：应得到文字/语音陪伴，不应自动附加背景音。
2. `我想听一点雨声` 或 `我想听一点 BGM`：应给出一段自然的背景音推荐，返回 `autoplay: false`，等待确认。
3. `好，播放吧`：只会播放上一步已推荐的同一条音频，返回 `autoplay: true`。
4. `讲一个很短的睡前故事` 或 `带我做一段呼吸引导`：应生成可播放的 TTS 语音；页面的播放键可停止它。
5. `我喜欢这个` / `我不喜欢这个`：会记录明确反馈，用于下一次推荐。

当前单 Agent 可调用四个受控工具：背景音推荐、TTS 生成、偏好保存和播放请求。工具永远不能直接读本地文件、访问密钥或绕过“先推荐、再确认播放”的规则。若 DeepSeek 端拒绝工具调用、工具超时或 TTS 失败，服务会回退到原有文字/规则路径，文字回复仍可使用。
