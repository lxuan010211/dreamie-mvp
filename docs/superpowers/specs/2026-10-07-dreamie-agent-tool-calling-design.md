# Dreamie Agent 工具调用升级设计

日期：2026-10-07

## 目标

把 Dreamie 从“DeepSeek 返回一份睡前 JSON，后端规则继续处理”升级为“DeepSeek 可以在一次任务中自主选择并调用有限工具”的 Agent，同时保留当前本地 MVP 的安全和可回退能力。

成功标准：

1. 用户只聊天时，Agent 不调用背景音工具。
2. 用户表达“我想听 BGM/雨声/轻音乐”时，Agent 可以调用背景音推荐工具，并返回待用户确认的播放意图。
3. 用户确认播放后，系统把播放指令交给浏览器；Agent 不绕过确认直接播放。
4. 用户要求故事或冥想时，Agent 可以调用 TTS 工具，浏览器播放生成的语音。
5. 用户明确喜欢或不喜欢某种声音时，Agent 可以调用记忆工具记录反馈。
6. 工具调用失败时，仍能返回文字回复，现有规则路径作为降级方案。

## 设计

### Agent 与 Runner

`createDreamieAgent` 接收工具依赖并配置 `tools`；Runner 的单次运行上限从 1 提高到 4。工具调用、工具结果和最终睡前方案在同一次运行中完成。暂不引入 handoff 或多 Agent，先验证单 Agent 工具循环。

Agent 的最终输出仍使用现有 `sleepPlanSchema`，这样前端协议不需要重写；工具产生的音频和播放元数据放入本次运行上下文/结果，不把大段音频数据塞回模型上下文。

### MVP 工具

- `recommend_background_audio`：输入当前情绪、用户偏好和排除项；只返回安全目录中的 `trackId`、标题和播放建议，不开始播放。
- `generate_tts`：输入需要朗读的文本、声音和语速；调用现有 MiniMax TTS，返回短引用或可播放音频数据。
- `save_sleep_memory`：记录用户对声音、内容类型和推荐结果的明确反馈。
- `request_background_playback`：生成待确认的播放命令；只有用户确认后，WebSession 才返回 `autoplay: true`，浏览器才真正播放。

工具由服务端依赖注入，Agent 不直接访问文件系统、浏览器或密钥。背景音目录和用户确认规则仍由服务端强制约束。

### 对话状态

现有 WebSession 继续保存短期上下文、推荐曲目和用户确认状态。模型负责提出工具调用，WebSession 负责验证工具参数、应用用户确认、写入记忆和组装前端响应。模型无法通过自然语言绕过 `recommendationCooldown` 或直接改变播放状态。

### 降级与兼容

- 当前规则推荐器保留为 fallback；模型工具调用不支持、超时或返回无效参数时，使用现有 `requestsBackgroundAudio` 和 `recommendBackgroundAudio`。
- TTS 失败时保留文字回复。
- 播放仍由前端 `audio-player.js` 执行；服务器只返回播放元数据和状态。
- 暂不做定时唤醒、跨 Agent handoff、自动睡眠报告或真正的多 Agent 协作。

## 测试

先写失败测试，再实现：

- Agent 配置暴露四个工具，并限制为最多 4 个 Runner turns。
- 背景音推荐工具只返回目录中的安全曲目，不执行播放。
- TTS 工具接收脚本并返回可播放结果。
- 用户未确认时不会返回 autoplay；确认后返回 `background` 播放状态。
- 工具失败时保留文字回复并走现有 fallback。
- 前端继续通过同一个播放/停止按钮执行音频。

## 非目标

本阶段不更换 DeepSeek，不部署线上，不把 API Key 暴露给浏览器，不实现真正的多 Agent 协作，也不允许模型无确认自动播放。
