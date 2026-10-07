import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryStore } from '../src/memory-store.js';
import { createMemoryStoreFactory } from '../src/memory-store-factory.js';
import { createWebSessionService } from '../src/web-session.js';
import type { DreamieToolEffects } from '../src/dreamie-tools.js';

const voicePlan = { reply: '辛苦了，慢慢放松就好。', contentType: 'white_noise' as const, durationMinutes: 30, mood: 'tired' as const, audioScript: '现在让身体慢慢放松下来。', audioMode: 'voice' as const, autoplay: true };
const backgroundPlan = { ...voicePlan, audioMode: 'background' as const, backgroundTrackId: 'spring-rain' };
const unsolicitedMixedPlan = { ...voicePlan, audioMode: 'voice_with_background' as const, backgroundTrackId: 'spring-rain' };
type TestPlan = typeof voicePlan | typeof backgroundPlan | typeof unsolicitedMixedPlan;

const firstUserId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';

function createService(
  t: test.TestContext,
  plan: TestPlan & { backgroundRequested?: boolean; backgroundConfirmed?: boolean } = voicePlan,
  effects?: DreamieToolEffects,
) {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-web-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return createWebSessionService({
    memoryStores: createMemoryStoreFactory({ kind: 'sqlite', databasePath: join(directory, 'dreamie.db') }),
    getSleepPlan: async () => effects ? { plan, effects } : plan,
  });
}

test('returns a text recommendation and pending audio for a first message', async (t) => {
  const response = await createService(t).handleMessage({ userId: firstUserId, message: '今天脑子停不下来' });
  assert.equal(response.audioMode, 'voice');
  assert.equal(response.autoplay, true);
  assert.equal(response.audio, undefined);
  assert.doesNotMatch(response.reply, /要播放吗/);
});

test('ignores a model background mode when the user did not ask for audio', async (t) => {
  const response = await createService(t, unsolicitedMixedPlan).handleMessage({ userId: firstUserId, message: '今天有点累，陪我聊聊天' });
  assert.equal(response.audioMode, 'voice');
  assert.equal(response.audio, undefined);
});

test('records play only after clear consent', async (t) => {
  const service = createService(t, backgroundPlan);
  const first = await service.handleMessage({ userId: firstUserId, message: '请放一点雨声陪我' });
  const second = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '好' });
  assert.equal(second.audioMode, 'background');
  assert.equal(second.audio?.state, 'playing');
  assert.deepEqual(service.getEventTypes(first.sessionId, firstUserId), ['recommended', 'played']);
});

test('plays the pending recommendation after natural consent wording', async (t) => {
  const service = createService(t, backgroundPlan);
  const first = await service.handleMessage({ userId: firstUserId, message: '我想听一点BGM' });
  const second = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '好，播放吧' });
  assert.equal(first.audioMode, 'background');
  assert.equal(second.audioMode, 'background');
  assert.equal(second.audio?.state, 'playing');
  assert.deepEqual(service.getEventTypes(first.sessionId, firstUserId), ['recommended', 'played']);
});

test('keeps changed and liked recommendations pending until a separate play confirmation', async (t) => {
  const service = createService(t, backgroundPlan);
  const first = await service.handleMessage({ userId: firstUserId, message: '请放一点雨声陪我' });
  const changed = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '换一个' });
  const liked = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '我喜欢这个' });

  assert.equal(changed.audio?.state, 'pending');
  assert.equal(changed.autoplay, false);
  assert.equal(liked.audio?.state, 'pending');
  assert.equal(liked.autoplay, false);
});

test('preserves the generated sleep script for the web TTS layer', async (t) => {
  const response = await createService(t).handleMessage({ userId: firstUserId, message: '讲一段放松引导' });
  assert.equal(response.audioScript, voicePlan.audioScript);
});

test('keeps a background-only request as background mode', async (t) => {
  const response = await createService(t, backgroundPlan).handleMessage({ userId: firstUserId, message: '请播放雨声' });
  assert.equal(response.audioMode, 'background');
});

test('keeps narration plus ambience as a mixed response', async (t) => {
  const response = await createService(t, backgroundPlan).handleMessage({ userId: firstUserId, message: '讲一个温柔的小故事，配一点雨声' });
  assert.equal(response.audioMode, 'voice_with_background');
  assert.equal(response.audioScript, voicePlan.audioScript);
  assert.equal(response.autoplay, true);
  assert.equal(response.audio?.state, 'playing');
});

test('starts meditation and background together for the users combined audio request', async (t) => {
  const service = createService(t, voicePlan, { ttsDataUrl: 'data:audio/mpeg;base64,AAE=' });
  const response = await service.handleMessage({ userId: firstUserId, message: '我想一遍放音频一遍冥想放松' });
  assert.equal(response.audioMode, 'voice_with_background');
  assert.equal(response.autoplay, true);
  assert.ok(response.audio?.trackId);
  assert.equal(response.audio?.state, 'playing');
  assert.equal(response.ttsDataUrl, 'data:audio/mpeg;base64,AAE=');
  assert.equal(response.audioScript, voicePlan.audioScript);
  assert.doesNotMatch(response.reply, /要播放吗/);
});

test('does not attach ambience when the user explicitly declines it', async (t) => {
  const response = await createService(t, backgroundPlan).handleMessage({ userId: firstUserId, message: '不要背景音，只陪我聊聊天' });
  assert.equal(response.audioMode, 'voice');
  assert.equal(response.audio, undefined);
});

test('changes the recommendation after an explicit dislike', async (t) => {
  const service = createService(t, backgroundPlan);
  const first = await service.handleMessage({ userId: firstUserId, message: '请放一点雨声陪我' });
  const second = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '不喜欢' });
  assert.equal(second.audio, undefined);
  assert.match(second.reply, /不再推荐/);
});

test('does not attach a copied session ID to another anonymous user', async (t) => {
  const service = createService(t);
  const first = await service.handleMessage({ userId: firstUserId, message: '今天很累' });
  const second = await service.handleMessage({
    userId: secondUserId,
    sessionId: first.sessionId,
    message: '好',
  });

  assert.notEqual(second.sessionId, first.sessionId);
  assert.deepEqual(service.getEventTypes(first.sessionId, secondUserId), []);
});

test('uses an agent-selected safe track for an explicit ambience request, then waits for consent', async (t) => {
  const service = createService(t, voicePlan, {
    recommendedTrack: { id: 'spring-rain', title: '春日淅沥沥的小雨声', kind: 'rain' },
    playback: { trackId: 'spring-rain', status: 'pending_confirmation' },
  });

  const first = await service.handleMessage({ userId: firstUserId, message: '我想听一点雨声' });
  const second = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '好，播放吧' });

  assert.equal(first.audio?.trackId, 'spring-rain');
  assert.equal(first.audio?.state, 'pending');
  assert.equal(first.autoplay, false);
  assert.equal(second.audio?.trackId, 'spring-rain');
  assert.equal(second.audio?.state, 'playing');
  assert.equal(second.autoplay, true);
});

test('does not attach a tool-selected background track to ordinary chat', async (t) => {
  const service = createService(t, voicePlan, {
    recommendedTrack: { id: 'spring-rain', title: '春日淅沥沥的小雨声', kind: 'rain' },
    playback: { trackId: 'spring-rain', status: 'playing' },
  });

  const response = await service.handleMessage({ userId: firstUserId, message: '陪我慢慢聊一下今天的心情' });

  assert.equal(response.audio, undefined);
  assert.equal(response.autoplay, true);
});

test('keeps a tool-generated TTS artifact private until the HTTP layer serializes it', async (t) => {
  const service = createService(t, voicePlan, {
    ttsDataUrl: 'data:audio/mpeg;base64,AAE=',
  });

  const response = await service.handleMessage({ userId: firstUserId, message: '带我做一段呼吸引导' });

  assert.equal(response.ttsDataUrl, 'data:audio/mpeg;base64,AAE=');
  assert.equal(response.ttsError, undefined);
});

test('honors a model-understood ambience request without a keyword match', async (t) => {
  const service = createService(t, { ...voicePlan, backgroundRequested: true });
  const response = await service.handleMessage({ userId: firstUserId, message: '给房间配点安静的声音吧' });
  assert.ok(response.audio);
  assert.equal(response.autoplay, false);
});

test('includes playback confirmation exchanges in the next conversation prompt', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-context-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let prompt = '';
  const service = createWebSessionService({
    memoryStores: createMemoryStoreFactory({ kind: 'sqlite', databasePath: join(directory, 'dreamie.db') }),
    getSleepPlan: async (request) => { prompt = request.prompt; return voicePlan; },
  });
  const first = await service.handleMessage({ userId: firstUserId, message: '请放一点雨声' });
  await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '好，就播放这个' });
  await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '我们接着聊刚才的事' });
  assert.match(prompt, /用户：好，就播放这个/);
  assert.match(prompt, /正在播放/);
});

test('offers ambience only after several turns and a current explicit poor state, once per session', async (t) => {
  const service = createService(t, voicePlan);
  const first = await service.handleMessage({ userId: firstUserId, message: '我今天很累' });
  assert.equal(first.audio, undefined);
  const second = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '下午开了好几个会' });
  assert.equal(second.audio, undefined);
  const third = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '现在非常累，状态也不好' });
  assert.ok(third.audio);
  assert.equal(third.audioMode, 'voice');
  assert.equal(third.autoplay, false);
  const fourth = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '还是很累' });
  assert.equal(fourth.audio, undefined);
});

test('respects refusal even when a later message qualifies for emotional ambience support', async (t) => {
  const service = createService(t, voicePlan);
  const first = await service.handleMessage({ userId: firstUserId, message: '今天工作很多' });
  await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '不用背景音，只陪我聊聊' });
  const third = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '现在非常累，状态很差' });
  assert.equal(third.audio, undefined);
});

test('does not offer emotional ambience for negated fatigue after several turns', async (t) => {
  const service = createService(t, voicePlan);
  const first = await service.handleMessage({ userId: firstUserId, message: '今天聊得挺开心' });
  await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '事情已经做完了' });
  const third = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '其实不太累，心情很好' });
  assert.equal(third.audio, undefined);
});

test('plays the selected track after one semantically understood confirmation without recommending again', async (t) => {
  const service = createService(t, { ...voicePlan, backgroundConfirmed: true });
  const first = await service.handleMessage({ userId: firstUserId, message: '我想听一点雨声' });
  assert.equal(first.autoplay, false);
  const confirmed = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '嗯嗯，就这样吧' });
  assert.equal(confirmed.autoplay, true);
  assert.equal(confirmed.audio?.trackId, first.audio?.trackId);
  assert.deepEqual(service.getEventTypes(first.sessionId, firstUserId), ['recommended', 'played']);
});

test('does not use semantic confirmation to bypass an explicit refusal', async (t) => {
  const service = createService(t, { ...voicePlan, backgroundConfirmed: true });
  const first = await service.handleMessage({ userId: firstUserId, message: '我想听一点雨声' });
  const refused = await service.handleMessage({ userId: firstUserId, sessionId: first.sessionId, message: '先别放，等一下' });
  assert.deepEqual(service.getEventTypes(first.sessionId, firstUserId), ['recommended']);
  assert.notEqual(refused.audio?.state, 'playing');
});
