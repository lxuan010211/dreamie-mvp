import assert from 'node:assert/strict';
import test from 'node:test';

import { createDreamieAgent, parseSleepPlan, sleepPlanSchema } from '../src/dreamie.js';

test('accepts a complete playable sleep plan', () => {
  const plan = sleepPlanSchema.parse({
    reply: '我们先慢慢呼吸一会儿。',
    contentType: 'breathing',
    durationMinutes: 10,
    mood: 'overthinking',
    audioScript: '现在不用急着入睡。跟着我慢慢呼吸，吸气时感受空气进入身体，呼气时让肩膀轻轻放松下来。',
  });

  assert.equal(plan.contentType, 'breathing');
  assert.equal(plan.durationMinutes, 10);
  assert.equal(plan.audioMode, 'voice');
  assert.equal(plan.autoplay, true);
});

test('accepts natural conversation without an unsolicited relaxation script', () => {
  const plan = sleepPlanSchema.parse({
    reply: '那个项目后来怎么样了？你说的同事今天有帮忙吗？',
    contentType: 'breathing', durationMinutes: 10, mood: 'unknown',
    audioScript: '', backgroundRequested: false,
  });
  assert.equal(plan.audioScript, '');
  assert.equal(plan.backgroundRequested, false);
});

test('accepts a story plan with a background track', () => {
  const plan = sleepPlanSchema.parse({
    reply: '我给你讲一个很短的故事。',
    contentType: 'sleep_story',
    durationMinutes: 15,
    mood: 'tired',
    audioScript: '现在让身体慢慢放松下来，听一段安静的小故事，让思绪像月光一样轻轻落在窗边。',
    audioMode: 'voice_with_background',
    backgroundTrackId: 'rain-gentle',
    recommendation: '如果你愿意，可以让一点雨声陪着这个故事。',
    autoplay: false,
  });

  assert.equal(plan.audioMode, 'voice_with_background');
  assert.equal(plan.backgroundTrackId, 'rain-gentle');
  assert.equal(plan.autoplay, false);
});

test('rejects content outside the MVP sleep modes', () => {
  assert.throws(
    () => sleepPlanSchema.parse({
      reply: '来一起看一部动作电影。',
        contentType: 'action_movie',
        durationMinutes: 20,
        mood: 'excited',
        audioScript: '来一起看一部动作电影。',
    }),
  );
});

test('builds Dreamie with the configured DeepSeek model', () => {
  const agent = createDreamieAgent('example-model');

  assert.equal(agent.name, 'Dreamie');
  assert.equal(agent.model, 'example-model');
});

test('gives Dreamie only the four approved service tools', () => {
  const agent = createDreamieAgent('example-model');

  assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), [
    'generate_tts',
    'recommend_background_audio',
    'request_background_playback',
    'save_sleep_memory',
  ]);
  assert.ok(agent.tools.every((tool) => tool.type === 'function'));
});

test('parses a model response into a sleep plan', () => {
  const plan = parseSleepPlan(
    '{"reply":"我们先慢慢呼吸一会儿。","contentType":"breathing","durationMinutes":10,"mood":"overthinking","audioScript":"现在不用急着入睡。跟着我慢慢呼吸，吸气时感受空气进入身体，呼气时让肩膀轻轻放松下来。"}',
  );

  assert.equal(plan.mood, 'overthinking');
  assert.equal(plan.audioScript, '现在不用急着入睡。跟着我慢慢呼吸，吸气时感受空气进入身体，呼气时让肩膀轻轻放松下来。');
});

test('normalizes nullable optional audio fields from model JSON', () => {
  const plan = parseSleepPlan(
    '{"reply":"先慢慢放松。","contentType":"breathing","durationMinutes":10,"mood":"tired","audioScript":"现在不用急着入睡，让呼吸慢下来，肩膀也跟着放松，身体会一点点安静下来。","backgroundTrackId":null,"recommendation":null}',
  );

  assert.equal(plan.backgroundTrackId, undefined);
  assert.equal(plan.recommendation, undefined);

  const empty = parseSleepPlan(
    '{"reply":"先慢慢放松。","contentType":"breathing","durationMinutes":10,"mood":"tired","audioScript":"现在不用急着入睡，让呼吸慢下来，肩膀也跟着放松，身体会一点点安静下来。","backgroundTrackId":"","recommendation":""}',
  );
  assert.equal(empty.backgroundTrackId, undefined);
  assert.equal(empty.recommendation, undefined);
});
