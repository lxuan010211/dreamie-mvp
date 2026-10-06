# Dreamie Agent Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Dreamie 从“模型返回 JSON、后端规则处理”升级为一个能在受控范围内自主选择并调用工具的单 Agent，同时保留现有前端协议、播放确认、安全约束和降级路径。

**Architecture:** 通过 OpenAI Agents SDK 的 `tool()` 注册四个服务端工具，并把一次请求的 `DreamieRunContext` 传给 Runner。工具只做受控业务动作并返回小型 JSON；音频二进制、浏览器播放和密钥留在服务端。Runner 最多运行 4 turns，模型完成工具调用后仍输出现有 `SleepPlan`。`WebSession` 继续拥有会话状态和用户确认权，负责把工具副作用转换成现有 `WebChatResponse`；模型无法直接播放或绕过确认。

**Tech Stack:** TypeScript, `@openai/agents` (`tool`, `Agent`, `Runner`), Zod, Node test runner, MiniMax TTS, 现有本地音频目录与记忆存储。

**Spec:** `docs/superpowers/specs/2026-10-07-dreamie-agent-tool-calling-design.md`

## Global Constraints

- 继续使用当前 DeepSeek 配置，不更换模型、不把 API Key 或本地文件路径交给浏览器。
- 不引入 handoff、多 Agent、定时唤醒、睡眠报告或新的前端页面；本阶段只验证单 Agent 工具循环。
- 前端继续消费 `/api/chat` 的现有字段、`audio-player.js` 的播放/停止行为；新增字段必须向后兼容。
- `recommend_background_audio` 只能从 `sleepAudioCatalog` 返回安全曲目，不能播放；`request_background_playback` 只能生成播放意图。
- 未得到用户明确确认时，任何路径都不得返回 `autoplay: true` 的背景音；确认逻辑由 `WebSession` 服务端强制执行。
- TTS 工具只返回短引用/状态给模型；音频 data URL 通过本次运行的服务端副作用传递给 HTTP 层，不能塞进模型上下文。
- 先写失败测试，再写实现；每个任务完成后运行对应测试、`tsc --noEmit`，并提交一个小而完整的 commit。
- 保留当前规则推荐、`getBackgroundAudioAction`、TTS 后处理和文字回复兜底，以便 DeepSeek 不支持工具调用、工具超时或参数无效时仍能工作。

## Review Focus

- 工具是否真正进入 Agent 配置，而不是只在后端写死调用。
- 模型能否在普通聊天、明确背景音请求、故事/冥想、喜欢/不喜欢反馈之间选择正确工具。
- 播放确认是否始终由服务端状态控制，是否存在模型直接触发播放的旁路。
- TTS data URL、API Key、文件路径是否不会进入模型消息或浏览器异常日志。
- 工具失败后是否保留文字回复并走现有 fallback，且现有前端/语音输入/背景音回归测试不受影响。
- 本地真实 DeepSeek smoke test 是否能观察到“工具调用 → 工具结果 → 最终 SleepPlan”，并记录不支持工具调用时的降级行为。

---

## Task 1: Define the run context and tool contracts

**Files:**
- Create: `dreamie-mvp/src/dreamie-tools.ts`
- Create: `dreamie-mvp/test/dreamie-tools.test.ts`
- Modify: `dreamie-mvp/src/dreamie.ts` only if shared `SleepPlan`/context types need to be exported

### Step 1: Write the failing contract tests

- Add tests that import a `createDreamieTools` factory and assert it creates exactly these names: `recommend_background_audio`, `generate_tts`, `save_sleep_memory`, `request_background_playback`.
- Add a test context fixture containing a mood, preferred kinds, excluded track IDs, an unconfirmed playback state, a fake MiniMax synthesizer, and a fake memory writer.
- Invoke the recommendation tool through the SDK tool executor or its exposed `execute` function and assert the result contains only `trackId`, `title`, `kind`, and a short recommendation; it must never contain a URL, file path, data URL, or `autoplay`.
- Assert the playback tool returns `pending_confirmation` when `playbackAllowed` is false and does not mutate a playing state.
- Assert the same tool returns `playing` only when `playbackAllowed` is true and the requested track is the server-selected safe track.
- Assert TTS and memory tools call their injected dependencies with bounded arguments.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/dreamie-tools.test.ts`

Expected: tests fail because the module and contracts do not exist yet.

### Step 2: Implement the smallest typed contract

- Define `DreamieToolContext` with request/session identity, current mood, preferred/excluded track IDs, the selected/pending track, `playbackAllowed`, and an `effects` object for server-only artifacts (`ttsDataUrl`, selected track, pending/playing playback state, tool errors).
- Define injected callbacks for `recommendTrack`, `synthesizeSpeech`, and `saveMemory`; callbacks are the only way tools reach catalog, MiniMax, or persistence code.
- Define Zod input/output schemas with bounded lengths and enums. Reject unknown track IDs, unsupported voice/speed values, empty scripts, and oversized text before side effects.
- Implement `createDreamieTools(context)` with SDK `tool()` and strict Zod schemas. Each tool returns a compact serializable result suitable for another model turn and catches expected dependency errors into a safe `{status:'unavailable', message:'...'}` result.
- Keep `request_background_playback` consent-aware and make it set only server-side effects; the returned model-visible result must state whether confirmation is still needed.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/dreamie-tools.test.ts`

Expected: contract tests pass; no network calls are made.

### Step 3: Type-check and commit

Run: `cd dreamie-mvp && ./node_modules/.bin/tsc --noEmit`

Commit: `git add dreamie-mvp/src/dreamie-tools.ts dreamie-mvp/test/dreamie-tools.test.ts dreamie-mvp/src/dreamie.ts && git commit -m "feat: define Dreamie agent tool contracts"`

## Task 2: Add safe adapters for catalog, MiniMax TTS, and memory

**Files:**
- Modify: `dreamie-mvp/src/dreamie-tools.ts`
- Modify: `dreamie-mvp/src/minimax-tts.ts` only for an injectable, short-result adapter if needed
- Modify: `dreamie-mvp/src/audio-catalog.ts` only for a typed safe-track helper if needed
- Create/Modify: `dreamie-mvp/test/minimax-tts.test.ts`, `dreamie-mvp/test/dreamie-tools.test.ts`

### Step 1: Add red tests around real adapters

- Add a fake-fetch test proving `generate_tts` uses the existing MiniMax request builder/config (model, voice ID, speed) and stores the generated data URL in `effects.ttsDataUrl` while returning only `{status:'ready', format:'mp3'}` plus bounded metadata.
- Add failure tests for MiniMax non-2xx/invalid hex responses. The tool must return an unavailable result, record the error for the HTTP layer, and not throw out the whole conversation.
- Add catalog tests proving mood/preference/exclusion selection never returns a non-catalog track and excludes previously rejected IDs.
- Add memory tests proving explicit `liked`/`disliked` events call the existing memory policy/store exactly once and non-feedback messages do not write memory.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/minimax-tts.test.ts test/dreamie-tools.test.ts`

Expected: new tests fail for missing effect plumbing/adapter behavior.

### Step 2: Implement adapters without widening the tool surface

- Reuse `synthesizeMiniMaxSpeech` with dependency injection for `fetch`; do not duplicate MiniMax protocol parsing.
- Use `recommendBackgroundAudio`/`findSleepAudioById` and the existing memory policy/store APIs. The tool layer must not read files or construct browser URLs directly.
- Store TTS data in the run context effects and expose a stable short artifact ID/ready status to the model. The HTTP layer will later turn the stored data URL into the existing `tts` response.
- Normalize dependency failures to safe model-visible text and structured effects so the final `SleepPlan.reply` can still be shown and spoken if fallback synthesis succeeds.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/minimax-tts.test.ts test/dreamie-tools.test.ts`

Expected: adapter and failure tests pass.

### Step 3: Type-check and commit

Run: `cd dreamie-mvp && ./node_modules/.bin/tsc --noEmit`

Commit: `git add dreamie-mvp/src/dreamie-tools.ts dreamie-mvp/src/minimax-tts.ts dreamie-mvp/src/audio-catalog.ts dreamie-mvp/test/dreamie-tools.test.ts dreamie-mvp/test/minimax-tts.test.ts && git commit -m "feat: connect Dreamie tools to safe services"`

## Task 3: Turn `createDreamieAgent` into a tool-using agent

**Files:**
- Modify: `dreamie-mvp/src/dreamie.ts`
- Modify: `dreamie-mvp/test/dreamie.test.ts`
- Create/Modify: `dreamie-mvp/test/agent-runner.test.ts`

### Step 1: Write failing agent configuration tests

- Assert `createDreamieAgent(model, tools)` exposes the four tool names and no filesystem/browser tool.
- Assert the agent output contract still parses into `SleepPlan`; keep the existing JSON fields and audio modes.
- Add a deterministic fake-model/runner test (no live DeepSeek) that simulates a recommendation tool call followed by a final SleepPlan and verifies the tool is actually invoked.
- Add a test that a tool failure produces a final text plan rather than an uncaught exception.
- Add a configuration assertion that the production runner call uses `maxTurns: 4`, while ordinary no-tool replies finish in one turn.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/dreamie.test.ts test/agent-runner.test.ts`

Expected: tests fail because `createDreamieAgent` currently accepts only a model and the runner is capped at one turn.

### Step 2: Implement the agent policy and Runner integration

- Change `createDreamieAgent` to accept a typed tool bundle/context factory and configure `tools` plus the existing `sleepPlanSchema` output contract where supported. Keep the JSON parser as a compatibility boundary for DeepSeek Chat Completions.
- Rewrite the system instructions around tool policy: ordinary conversation uses no tools; explicit background requests call recommendation first; story/meditation may call TTS; explicit feedback calls memory; never claim playback before the playback tool/server consent says it is allowed.
- Preserve low-stimulation language, Simplified Chinese, sleep-safety restrictions, bounded script length, and the “do not recommend audio every time” rule.
- Pass `DreamieRunContext` via Runner `context`; run with `maxTurns: 4` and preserve `finalOutput` parsing. Return both the parsed plan and server-only effects from the agent runner callback.
- Keep a narrow fallback wrapper: if tool schema/provider support fails, rerun or use the existing one-turn JSON path rather than making the request fail.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/dreamie.test.ts test/agent-runner.test.ts && ./node_modules/.bin/tsc --noEmit`

Expected: agent configuration and fake-runner tests pass; type-check remains clean.

### Step 3: Commit

Commit: `git add dreamie-mvp/src/dreamie.ts dreamie-mvp/test/dreamie.test.ts dreamie-mvp/test/agent-runner.test.ts && git commit -m "feat: enable Dreamie agent tool loop"`

## Task 4: Integrate tool effects with WebSession consent and HTTP audio output

**Files:**
- Modify: `dreamie-mvp/src/web-session.ts`
- Modify: `dreamie-mvp/src/web-server.ts`
- Modify: `dreamie-mvp/test/web-session.test.ts`
- Modify: `dreamie-mvp/test/web-server.test.ts`

### Step 1: Add failing service-level tests

- Extend the fake `getSleepPlan` dependency to return `{ plan, effects }` and add tests for:
  - ordinary chat: no background recommendation/tool effect unless the bounded soft-recommendation policy permits it;
  - explicit “我想听雨声/BGM”: selected catalog track is returned as `pending`, `autoplay:false`;
  - confirmation: server returns `playing`, `autoplay:true`, and the same safe track only after the user confirms;
  - story/meditation with TTS effect: response keeps text and carries the generated audio to the HTTP serializer;
  - TTS/tool failure: response contains text and a safe `ttsError`, with deterministic fallback still available;
  - like/dislike: existing memory event recording remains exactly once.
- Add a regression test that no model-provided `backgroundTrackId` or `autoplay:true` can bypass catalog lookup or confirmation state.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/web-session.test.ts test/web-server.test.ts`

Expected: tests fail until service dependencies and response assembly understand tool effects.

### Step 2: Implement server orchestration

- Change the `getSleepPlan` dependency signature to accept the session’s run context and return a plan plus server-only effects. Keep a small compatibility adapter for existing unit fixtures that return only `SleepPlan`.
- In `WebSession`, apply recommended track/effect state through the existing `record`, cooldown, exclusion, and memory paths. Preserve deterministic handling for `play`, `change`, `like`, and `dislike` confirmations so a model cannot bypass them.
- Add a private response field or result envelope for `ttsDataUrl`; before JSON serialization, destructure it from the chat result and pass it into `buildWebAudioResponse`. Never spread raw tool effects into the browser response.
- Keep background audio metadata as `{trackId,title,url,autoplay}` and keep browser playback in `audio-player.js`.
- Keep post-processing TTS as a fallback only when the tool did not produce audio; avoid double synthesis when `generate_tts` succeeded.
- Convert expected tool errors to a calm text reply and preserve existing HTTP 200/fallback behavior; reserve HTTP 500 for unexpected server failures.

Run: `cd dreamie-mvp && ./node_modules/.bin/tsx --test test/web-session.test.ts test/web-server.test.ts && ./node_modules/.bin/tsc --noEmit`

Expected: service and HTTP tests pass, including no-autoplay-before-confirmation.

### Step 3: Commit

Commit: `git add dreamie-mvp/src/web-session.ts dreamie-mvp/src/web-server.ts dreamie-mvp/test/web-session.test.ts dreamie-mvp/test/web-server.test.ts && git commit -m "feat: orchestrate agent tool effects in web sessions"`

## Task 5: Regression verification and local Agent smoke test

**Files:**
- Modify only if verification exposes a regression: `dreamie-mvp/src/**`, `dreamie-mvp/test/**`
- Update: `dreamie-mvp/docs/cloudbase-preview.md` with the local tool-calling smoke-test instructions and fallback behavior

### Step 1: Run the complete automated suite

Run:

```bash
cd dreamie-mvp
./node_modules/.bin/tsx --test test/*.test.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all existing audio, TTS, ASR, memory, web-session, web-server, and new agent-tool tests pass; no frontend contract test changes are required.

### Step 2: Run a live local smoke test with existing environment variables

- Start the local server using the project’s existing command and do not print `.env.local` or any key.
- Send a normal text message and verify no background tool effect is returned.
- Send an explicit BGM/rain request and verify the first response is a natural recommendation with `autoplay:false`.
- Send a confirmation and verify the next response is the same track with `autoplay:true`.
- Send a short story/meditation request and verify a `tts.dataUrl` is returned to the browser; stop playback with the existing button.
- Send explicit like/dislike feedback and verify the session event/memory store records it once.
- Temporarily use a failing fake/provider only in tests (never alter production keys) and verify text fallback.

Expected: terminal logs show tool loop/fallback status without secrets; browser behavior remains the same play/stop flow.

### Step 3: Update docs and commit

- Document that DeepSeek tool calling is attempted but fallback remains active when the provider rejects tools.
- Document the four tools, confirmation rule, and safe local smoke-test messages.
- Commit: `git add dreamie-mvp/docs/cloudbase-preview.md && git commit -m "docs: document Dreamie agent tool smoke test"`

## Completion Checklist

- [ ] Four tools are exposed through `createDreamieAgent` and injected service dependencies.
- [ ] Runner allows up to 4 turns and a fake test proves tool call → tool result → final plan.
- [ ] Ordinary chat does not cause an unsolicited background tool call.
- [ ] Background recommendation is safe, pending, and requires explicit confirmation before playback.
- [ ] Story/meditation TTS is playable, bounded, and does not leak raw audio into model context.
- [ ] Explicit listening feedback writes memory once.
- [ ] Tool/provider failures preserve text and use existing fallback behavior.
- [ ] Existing frontend response and play/stop contracts remain compatible.
- [ ] Full tests, type-check, and local smoke test pass before claiming completion.
