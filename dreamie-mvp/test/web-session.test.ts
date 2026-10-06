import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryStore } from '../src/memory-store.js';
import { createWebSessionService } from '../src/web-session.js';

const plan = { reply: '辛苦了，慢慢放松就好。', contentType: 'white_noise' as const, durationMinutes: 30, mood: 'tired' as const, audioScript: '现在让身体慢慢放松下来。' };

function createService(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-web-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return createWebSessionService({ memoryStore: openMemoryStore(join(directory, 'dreamie.db')), getSleepPlan: async () => plan });
}

test('returns a text recommendation and pending audio for a first message', async (t) => {
  const response = await createService(t).handleMessage({ message: '今天脑子停不下来' });
  assert.equal(response.audio?.state, 'pending');
  assert.match(response.reply, /要播放吗/);
});

test('records play only after clear consent', async (t) => {
  const service = createService(t);
  const first = await service.handleMessage({ message: '今天很累' });
  const second = await service.handleMessage({ sessionId: first.sessionId, message: '好' });
  assert.equal(second.audio?.state, 'playing');
  assert.deepEqual(service.getEventTypes(first.sessionId), ['recommended', 'played']);
});

test('changes the recommendation after an explicit dislike', async (t) => {
  const service = createService(t);
  const first = await service.handleMessage({ message: '今天很累' });
  const second = await service.handleMessage({ sessionId: first.sessionId, message: '不喜欢' });
  assert.notEqual(second.audio?.trackId, first.audio?.trackId);
});
