import assert from 'node:assert/strict';
import test from 'node:test';

import { RunContext } from '@openai/agents';

import { runDreamieAgent } from '../src/dreamie.js';
import { createDreamieToolContext } from '../src/dreamie-tools.js';

const finalPlan = JSON.stringify({
  reply: '我会陪你慢慢放松。',
  contentType: 'meditation',
  durationMinutes: 10,
  mood: 'stressed',
  audioScript: '现在让呼吸慢一点，肩膀轻轻落下，先不用解决任何事情。每一次呼气，都让身体更安静一点。',
  audioMode: 'voice',
  autoplay: true,
});

function createContext() {
  return createDreamieToolContext({
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    mood: 'stressed',
    preferredKinds: ['rain'],
    excludedTrackIds: [],
    playbackAllowed: false,
    ttsConfig: {
      apiKey: 'test-key',
      model: 'speech-2.6-hd',
      voiceId: 'female-test',
      speed: 0.8,
    },
    saveMemory: async () => undefined,
  });
}

test('runs a requested tool before returning the final sleep plan', async () => {
  const context = createContext();
  let observedMaxTurns = 0;

  const result = await runDreamieAgent({
    model: 'example-model',
    prompt: '我想听一点雨声',
    context,
    run: async (agent, _prompt, options) => {
      observedMaxTurns = options.maxTurns;
      const recommendation = agent.tools.find((tool) => tool.name === 'recommend_background_audio');
      assert.ok(recommendation && recommendation.type === 'function');
      await recommendation.invoke(new RunContext(options.context), JSON.stringify({ intent: 'background' }));
      return { finalOutput: finalPlan };
    },
  });

  assert.equal(observedMaxTurns, 4);
  assert.equal(result.plan.reply, '我会陪你慢慢放松。');
  assert.equal(result.effects.recommendedTrack?.id, 'spring-rain');
});

test('keeps a final text plan when a tool returns an unavailable result', async () => {
  const context = createContext();
  context.recommendTrack = async () => { throw new Error('catalog offline'); };

  const result = await runDreamieAgent({
    model: 'example-model',
    prompt: '我想听一点雨声',
    context,
    run: async (agent, _prompt, options) => {
      const recommendation = agent.tools.find((tool) => tool.name === 'recommend_background_audio');
      assert.ok(recommendation && recommendation.type === 'function');
      const toolResult = await recommendation.invoke(new RunContext(options.context), JSON.stringify({ intent: 'background' }));
      assert.deepEqual(toolResult, { status: 'unavailable', message: '背景音推荐暂时不可用。' });
      return { finalOutput: finalPlan };
    },
  });

  assert.equal(result.plan.reply, '我会陪你慢慢放松。');
  assert.deepEqual(result.effects.toolErrors, ['背景音推荐暂时不可用。']);
});
