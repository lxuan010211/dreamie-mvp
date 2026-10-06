# Dreamie CloudBase 测试发布

目标环境：`dreamie-d1gakfvvs849daf19`。

在 CloudBase 控制台打开该环境的“云托管”，新建服务：

1. 部署方式选择从代码仓库或上传代码包，并选择项目根目录中的 `Dockerfile`。
2. 服务端口填 `8080`，开启公网访问。
3. 在环境变量中直接粘贴（不要发到聊天或提交 Git）：
   - `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`
   - `MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`
   - `DASHSCOPE_API_KEY`、`DASHSCOPE_ASR_MODEL`
   - `DATABASE_URL`
   - `MEMORY_STORE=postgres`
4. 等待版本状态为健康，复制控制台显示的默认 HTTPS 域名；不要使用本机 IP 或本地 HTTPS 证书。

服务发布后，用手机蜂窝网络或任意非本机网络打开默认 HTTPS 域名。验证：页面加载、文字聊天、长按录音、背景音播放，以及刷新后匿名用户的偏好是否仍存在。

本机没有 Docker，因此镜像构建验证以 CloudBase 的构建日志为准。若构建失败，请复制不含密钥的错误摘要。
