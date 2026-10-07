import assert from 'node:assert/strict';
import test from 'node:test';
import { readCompanionProfile } from '../settings.js';

test('restores saved companion preferences', () => {
  const value = { username: ' 小宝 ', persona: 'friend', voiceId: 'female-tianmei' };
  assert.deepEqual(readCompanionProfile({ getItem: () => JSON.stringify(value) }), { ...value, username: '小宝' });
});

test('uses safe defaults for broken storage and unknown choices', () => {
  const defaults = { username: '小宝', persona: 'gentle', voiceId: 'female-chengshu' };
  assert.deepEqual(readCompanionProfile({ getItem: () => '{broken' }), defaults);
  assert.deepEqual(readCompanionProfile({ getItem: () => '{"persona":"unknown","voiceId":"unknown"}' }), defaults);
  assert.deepEqual(readCompanionProfile({ getItem: () => { throw new Error('blocked'); } }), defaults);
});

test('keeps each newly selected voice after reloading preferences', () => {
  for (const voiceId of ['audiobook_female_1', 'male-qn-jingying', 'Chinese (Mandarin)_Radio_Host', 'Chinese (Mandarin)_News_Anchor']) {
    assert.equal(readCompanionProfile({ getItem: () => JSON.stringify({ voiceId }) }).voiceId, voiceId);
  }
});
