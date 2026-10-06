# Dreamie 本地用户与记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Dreamie 在本机安全地记录背景音互动，并在下一次对话中利用稳定偏好和近期行为优化推荐。

**Architecture:** 用 Node 内置 `node:sqlite` 在 `data/dreamie.db` 存储一位 `local-user` 的档案、会话、收听事件和经过规则确认的记忆。将数据库访问、记忆写入规则、推荐上下文分别放进独立模块；终端对话流程只通过一个小型记忆接口记录事件和获取推荐输入。

**Tech Stack:** TypeScript、Node.js `node:sqlite`、Node Test Runner、现有 `tsx` 与 Zod。

**Spec:** `dreamie-mvp/docs/superpowers/specs/2026-10-06-user-memory-design.md`

## Global Constraints

- 只支持本机单用户，用户 ID 固定为 `local-user`。
- 使用 Node 内置 `node:sqlite`；不得新增第三方数据库依赖。
- 数据库存放在 `data/dreamie.db`，并写入 `.gitignore`。
- 不持久化完整聊天原文；模型仅接收记忆摘要和当前会话最近六轮。
- 数据库失败不能阻止本轮对话或播放，必须显示“本次偏好未保存”。
- 不发送数据库原始记录、绝对音频路径或完整历史对话给模型。

## Review Focus

- 数据库文件所在目录不可写时，应退化为当晚可播放、但不保存偏好的模式。
- 仅一次“换一个”不得产生长期负向记忆。
- “不喜欢 / 不要再推荐”必须在下一次会话排除该音频，即使它仍符合当前情绪。
- 连续三次播放同一音频类型才形成行为型正向偏好，不能被不同类型事件合并计数。
- 上下文组装不得泄漏原始会话文本、数据库 ID 或本地绝对路径。

## File Structure

- Create: `src/memory-store.ts` — SQLite 初始化、查询、事务、事件写入、清除本地数据及无存储降级实现。
- Create: `src/memory-policy.ts` — 将显式反馈和重复收听事件转换为长期记忆。
- Create: `src/recommendation-context.ts` — 将记忆压缩为模型文本摘要与音频排序输入。
- Modify: `src/background-audio-session.ts` — 支持偏好排序及“喜欢 / 不喜欢”操作识别。
- Modify: `src/background-audio-flow.ts` — 创建会话、记录推荐/播放/换歌/反馈，并将记忆摘要带入模型上下文。
- Modify: `src/cli.ts` — 打开本地记忆库；出错时使用无存储模式并显示一次提示。
- Modify: `.gitignore` — 忽略 `data/dreamie.db` 与 SQLite 伴随日志文件。
- Create: `test/memory-store.test.ts` — 数据库与事件持久化测试。
- Create: `test/memory-policy.test.ts` — 记忆升级和显式负反馈测试。
- Create: `test/recommendation-context.test.ts` — 隐私安全的上下文与排序输入测试。
- Modify: `test/background-audio-session.test.ts` — 新反馈动作和偏好排序测试。
- Modify: `test/background-audio-flow.test.ts` — 对话流程的存储调用与无存储降级测试。

### Task 1: SQLite 存储与安全降级

**Files:**
- Create: `src/memory-store.ts`
- Create: `test/memory-store.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces `openMemoryStore(databasePath: string): MemoryStore`。
- Produces `openMemoryStoreOrNull(databasePath: string, onUnavailable: () => void): MemoryStore`。
- Produces `MemoryStore`，包含 `startSession()`, `endSession()`, `recordEvent()`, `listEvents()`, `getProfile()`, `upsertMemory()`, `listMemories()` 与 `clearAll()`。
- Uses Node `DatabaseSync` from `node:sqlite`。

- [ ] **Step 1: Write failing storage tests**

```ts
test('initializes local-user and persists a played event', () => {
  const store = openMemoryStore(tempDatabasePath);
  const sessionId = store.startSession();
  store.recordEvent({ sessionId, trackId: 'spring-rain', eventType: 'played' });
  assert.equal(store.listEvents({ trackId: 'spring-rain' }).length, 1);
  assert.equal(store.getProfile().userId, 'local-user');
  assert.equal(store.getProfile().timezone, 'Asia/Shanghai');
});

test('uses a no-op store when the database cannot be opened', () => {
  const store = openMemoryStoreOrNull(unwritableDatabasePath, onUnavailable);
  assert.doesNotThrow(() => store.recordEvent({ sessionId: 'local', trackId: 'spring-rain', eventType: 'played' }));
  assert.equal(wasUnavailableNotified, true);
});

test('clears all persisted local memory without touching audio files', () => {
  store.clearAll();
  assert.equal(store.listMemories().length, 0);
  assert.equal(store.listEvents({}).length, 0);
});
```

- [ ] **Step 2: Run the storage tests and verify they fail**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/memory-store.test.ts`

Expected: FAIL because `memory-store.js` does not exist.

- [ ] **Step 3: Implement `MemoryStore` and `openMemoryStore()` in `src/memory-store.ts`**

Create all four tables from the spec in an initialization transaction. Use parameterized SQL and ISO timestamps. `openMemoryStoreOrNull()` catches open/init failures, calls `onUnavailable` once, and returns a no-op implementation that provides empty reads and accepts writes without throwing.

- [ ] **Step 4: Add database files to `.gitignore`**

Ignore `data/dreamie.db`, `data/dreamie.db-shm`, and `data/dreamie.db-wal` without changing existing ignore rules.

- [ ] **Step 5: Run the storage tests and type check**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/memory-store.test.ts && /Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit`

Expected: storage tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add dreamie-mvp/src/memory-store.ts dreamie-mvp/test/memory-store.test.ts dreamie-mvp/.gitignore
git commit -m "feat: add local memory storage"
```

### Task 2: 记忆策略与安全推荐上下文

**Files:**
- Create: `src/memory-policy.ts`
- Create: `src/recommendation-context.ts`
- Create: `test/memory-policy.test.ts`
- Create: `test/recommendation-context.test.ts`

**Interfaces:**
- Consumes `MemoryStore` from Task 1 and `SleepAudioTrack` from `src/audio-catalog.ts`.
- Produces `applyListeningFeedback(store: MemoryStore, input: ListeningFeedback): void`.
- Produces `buildRecommendationMemory(store: MemoryStore): RecommendationMemory`, with `modelSummary`, `excludedTrackIds`, and `preferredKinds`.

- [ ] **Step 1: Write failing policy tests**

```ts
test('creates a behavioral preference after three plays of rain tracks', () => {
  applyListeningFeedback(store, { trackId: 'spring-rain', trackKind: 'rain', eventType: 'played' });
  applyListeningFeedback(store, { trackId: 'jungle-rain', trackKind: 'rain', eventType: 'played' });
  applyListeningFeedback(store, { trackId: 'spring-rain', trackKind: 'rain', eventType: 'played' });
  assert.equal(buildRecommendationMemory(store).preferredKinds.includes('rain'), true);
});

test('does not create a negative memory from one changed track', () => {
  applyListeningFeedback(store, { trackId: 'spring-rain', trackKind: 'rain', eventType: 'changed' });
  assert.equal(buildRecommendationMemory(store).excludedTrackIds.includes('spring-rain'), false);
});

test('excludes a track after an explicit dislike', () => {
  applyListeningFeedback(store, { trackId: 'asmr-microphone-biting', trackKind: 'asmr', eventType: 'disliked' });
  assert.equal(buildRecommendationMemory(store).excludedTrackIds.includes('asmr-microphone-biting'), true);
});
```

- [ ] **Step 2: Write failing privacy/context tests**

```ts
test('returns a compact summary without raw paths or event identifiers', () => {
  const memory = buildRecommendationMemory(store);
  assert.match(memory.modelSummary, /偏好/);
  assert.doesNotMatch(memory.modelSummary, /\/Users\//);
  assert.doesNotMatch(memory.modelSummary, /session_id/i);
});
```

- [ ] **Step 3: Run the new tests and verify they fail**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/memory-policy.test.ts test/recommendation-context.test.ts`

Expected: FAIL because the policy and context modules do not exist.

- [ ] **Step 4: Implement `applyListeningFeedback()` in `src/memory-policy.ts`**

Always record the event. For `liked`, create or increase a positive memory; for `disliked`, create a high-confidence negative memory for that `trackId`; for `changed`, only record an event; for three `played` or `liked` events with the same `trackKind`, create or increase a behavioral positive memory for that kind.

- [ ] **Step 5: Implement `buildRecommendationMemory()` in `src/recommendation-context.ts`**

Read positive/negative memories plus 14 days of events. Emit a short Chinese `modelSummary` containing only preference facts, and structured `excludedTrackIds`/`preferredKinds`. Do not query or serialize raw conversation text, IDs, timestamps, file paths, or database paths.

- [ ] **Step 6: Run the Task 2 tests and type check**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/memory-policy.test.ts test/recommendation-context.test.ts && /Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit`

Expected: all Task 2 tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

```bash
git add dreamie-mvp/src/memory-policy.ts dreamie-mvp/src/recommendation-context.ts dreamie-mvp/test/memory-policy.test.ts dreamie-mvp/test/recommendation-context.test.ts
git commit -m "feat: derive sleep audio preferences"
```

### Task 3: 将记忆接入背景音对话与排序

**Files:**
- Modify: `src/background-audio-session.ts`
- Modify: `src/background-audio-flow.ts`
- Modify: `test/background-audio-session.test.ts`
- Modify: `test/background-audio-flow.test.ts`

**Interfaces:**
- Consumes `RecommendationMemory` from Task 2.
- Extends `recommendBackgroundAudio(mood, excludedTrackIds, preferredKinds?)`.
- Extends `BackgroundAudioConversationIO` with optional `memory?: BackgroundAudioMemory` that supplies one `RecommendationMemory`, records events, and completes the session.
- Produces the existing `runBackgroundAudioConversation()` behavior plus `liked` and `disliked` commands.

- [ ] **Step 1: Write failing session and flow tests**

```ts
test('prefers rain when it matches the user memory and current mood', () => {
  const track = recommendBackgroundAudio('stressed', [], ['rain']);
  assert.equal(track.kind, 'rain');
});

test('records recommendation and play but does not record play before consent', async () => {
  await runBackgroundAudioConversation('今天很累', fakeIoWithAnswers(['好']));
  assert.deepEqual(recordedEvents.map((event) => event.eventType), ['recommended', 'played']);
});

test('records an explicit dislike and recommends another track', async () => {
  await runBackgroundAudioConversation('今天很累', fakeIoWithAnswers(['不喜欢', '好']));
  assert.equal(recordedEvents.some((event) => event.eventType === 'disliked'), true);
  assert.equal(playedTrackId, 'fireplace');
});

test('stores a short session summary instead of raw conversation turns', async () => {
  await runBackgroundAudioConversation('今天很累', fakeIoWithAnswers(['好']));
  assert.equal(savedSession.summary.length <= 300, true);
  assert.equal(savedSession.summary.includes('用户：'), false);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/background-audio-session.test.ts test/background-audio-flow.test.ts`

Expected: FAIL because preference input and feedback actions are not implemented.

- [ ] **Step 3: Extend `getBackgroundAudioAction()` and `recommendBackgroundAudio()`**

Recognize explicit `喜欢` as `like` and `不喜欢`/`不要再推荐` as `dislike`. Recommendation ordering must exclude stable negative tracks first, then current-session exclusions, then prefer tracks whose kind is in `preferredKinds`, then use mood matching and the catalog order.

- [ ] **Step 4: Extend `runBackgroundAudioConversation()`**

At conversation start, obtain one memory snapshot and append only `modelSummary` to the prompt. Record `recommended` before displaying each recommendation; record `changed`, `liked`, `disliked`, and `played` for the currently recommended track. A `dislike` both saves feedback and immediately switches recommendation; `like` saves feedback but still requires a separate explicit play confirmation. Complete the session with the last mood and a maximum-300-character generated summary.

- [ ] **Step 5: Run focused tests and type check**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/background-audio-session.test.ts test/background-audio-flow.test.ts && /Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit`

Expected: focused tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add dreamie-mvp/src/background-audio-session.ts dreamie-mvp/src/background-audio-flow.ts dreamie-mvp/test/background-audio-session.test.ts dreamie-mvp/test/background-audio-flow.test.ts
git commit -m "feat: personalize background audio recommendations"
```

### Task 4: 终端装配、失败提示和完整验证

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/background-audio-flow.test.ts`

**Interfaces:**
- Consumes `openMemoryStoreOrNull()` from Task 1 and the optional memory adapter from Task 3.
- Preserves `--background` and existing TTS-only CLI behavior.

- [ ] **Step 1: Write a failing CLI-adapter test**

```ts
test('continues background audio conversation when memory storage is unavailable', async () => {
  await runWithUnavailableMemory();
  assert.equal(shownMessages.includes('提示：本次偏好未保存。'), true);
  assert.equal(played.length, 1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/background-audio-flow.test.ts`

Expected: FAIL because CLI memory initialization and availability messaging are absent.

- [ ] **Step 3: Initialize memory in `src/cli.ts` only for `--background` mode**

Use `${process.cwd()}/data/dreamie.db`. Create the adapter passed to `runBackgroundAudioConversation()`. On open failure, use the no-op store and show `提示：本次偏好未保存。` exactly once. Leave the current TTS path and MiniMax configuration requirements unchanged.

- [ ] **Step 4: Run the full test suite and type check**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/**/*.test.ts && /Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit`

Expected: all existing and new tests pass; TypeScript exits 0.

- [ ] **Step 5: Run a manual no-play smoke test**

Run: `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs src/cli.ts -- --background --no-play "今天很累，想听雨声"`

At the prompt, enter `好`. Expected: a recommendation appears, confirmation is required, and the output says audio was confirmed but not actually played.

- [ ] **Step 6: Commit**

```bash
git add dreamie-mvp/src/cli.ts dreamie-mvp/test/background-audio-flow.test.ts
git commit -m "feat: persist Dreamie memory in background mode"
```

## Final Verification

- [ ] Read the spec’s seven acceptance items and map each to a passing test or manual smoke check.
- [ ] Run the full test suite and TypeScript check from Task 4.
- [ ] Confirm `data/` is ignored with `git check-ignore data/dreamie.db`.
- [ ] Confirm no test or log prints an API key, database path, raw conversation history, or absolute audio path in model context.
