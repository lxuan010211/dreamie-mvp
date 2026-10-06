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

test('parses a model response into a sleep plan', () => {
  const plan = parseSleepPlan(
    '{"reply":"我们先慢慢呼吸一会儿。","contentType":"breathing","durationMinutes":10,"mood":"overthinking","audioScript":"现在不用急着入睡。跟着我慢慢呼吸，吸气时感受空气进入身体，呼气时让肩膀轻轻放松下来。"}',
  );

  assert.equal(plan.mood, 'overthinking');
  assert.equal(plan.audioScript, '现在不用急着入睡。跟着我慢慢呼吸，吸气时感受空气进入身体，呼气时让肩膀轻轻放松下来。');
});
