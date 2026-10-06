import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryStore } from '../src/memory-store.js';
import { createMemoryStoreFactory } from '../src/memory-store-factory.js';
import { createWebSessionService } from '../src/web-session.js';

const voicePlan = { reply: '辛苦了，慢慢放松就好。', contentType: 'white_noise' as const, durationMinutes: 30, mood: 'tired' as const, audioScript: '现在让身体慢慢放松下来。', audioMode: 'voice' as const, autoplay: true };
const backgroundPlan = { ...voicePlan, audioMode: 'background' as const, backgroundTrackId: 'spring-rain' };
const unsolicitedMixedPlan = { ...voicePlan, audioMode: 'voice_with_background' as const, backgroundTrackId: 'spring-rain' };
type TestPlan = typeof voicePlan | typeof backgroundPlan | typeof unsolicitedMixedPlan;

const firstUserId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';

function createService(t: test.TestContext, plan: TestPlan = voicePlan) {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-web-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return createWebSessionService({
    memoryStores: createMemoryStoreFactory({ kind: 'sqlite', databasePath: join(directory, 'dreamie.db') }),
    getSleepPlan: async () => plan,
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
