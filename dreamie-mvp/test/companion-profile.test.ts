import assert from 'node:assert/strict';
import test from 'node:test';
import { companionProfileSchema, profileInstructions } from '../src/companion-profile.js';

test('validates approved companion settings and rejects unsupported voices', () => {
  assert.equal(companionProfileSchema.parse({}).persona, 'gentle');
  assert.equal(companionProfileSchema.parse({ username: ' 小宝 ', persona: 'friend', voiceId: 'male-qn-qingse' }).username, '小宝');
  assert.equal(companionProfileSchema.safeParse({ voiceId: 'unknown' }).success, false);
  assert.equal(companionProfileSchema.safeParse({ username: 'x'.repeat(21) }).success, false);
});

test('applies the selected persona without replacing playback consent rules', () => {
  const instructions = profileInstructions(companionProfileSchema.parse({ persona: 'friend' }));
  assert.match(instructions, /轻松朋友型/);
  assert.match(instructions, /自然、真诚/);
  assert.match(instructions, /仍遵守原有工具和播放规则/);
});

test('accepts story, elite, radio and news voices in API requests', () => {
  for (const voiceId of ['audiobook_female_1', 'male-qn-jingying', 'Chinese (Mandarin)_Radio_Host', 'Chinese (Mandarin)_News_Anchor']) {
    assert.equal(companionProfileSchema.safeParse({ voiceId }).success, true, voiceId);
  }
});
