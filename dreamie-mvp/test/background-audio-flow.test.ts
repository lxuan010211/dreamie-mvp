import assert from 'node:assert/strict';
import test from 'node:test';

import { runBackgroundAudioConversation } from '../src/background-audio-flow.js';
import type { SleepPlan } from '../src/dreamie.js';

const tiredPlan: SleepPlan = {
  reply: '今天已经很辛苦了，我们慢慢放松。',
  contentType: 'white_noise',
  durationMinutes: 30,
  mood: 'tired',
  audioScript: '现在不用急着入睡，让身体慢慢沉下来，跟着平稳的呼吸感受夜晚的安静。',
  audioMode: 'voice',
  autoplay: true,
};

test('keeps chatting before playing only after a clear confirmation', async () => {
  const prompts: string[] = [];
  const shown: string[] = [];
  const played: string[] = [];
  const answers = ['我还是更想听雨声', '好'];

  await runBackgroundAudioConversation('今天很累。', {
    getSleepPlan: async (prompt) => {
      prompts.push(prompt);
      return tiredPlan;
    },
    ask: async () => answers.shift() ?? '好',
    say: (message) => shown.push(message),
    playAudio: (filePath) => played.push(filePath),
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /我还是更想听雨声/);
  assert.match(prompts[1]!, /今天已经很辛苦了/);
  assert.equal(played.length, 1);
  assert.match(played[0]!, /春日淅沥沥的小雨声\.mp3$/);
  assert.equal(shown.some((message) => message.includes('要播放吗？')), true);
});

test('changes the recommended track without playing until consent arrives', async () => {
  const shown: string[] = [];
  const played: string[] = [];
  const answers = ['换一个', '好'];

  await runBackgroundAudioConversation('今天很累。', {
    getSleepPlan: async () => tiredPlan,
    ask: async () => answers.shift() ?? '好',
    say: (message) => shown.push(message),
    playAudio: (filePath) => played.push(filePath),
  });

  assert.equal(played.length, 1);
  assert.match(played[0]!, /壁炉燃烧的木头噼里啪啦响\.mp3$/);
  assert.equal(shown.filter((message) => message.includes('要播放吗？')).length, 2);
});

test('records recommendation and play only after clear consent', async () => {
  const events: string[] = [];
  const completed: { mood: string; summary: string }[] = [];

  await runBackgroundAudioConversation('今天很累。', {
    getSleepPlan: async () => tiredPlan,
    ask: async () => '好',
    say: () => {},
    playAudio: () => {},
    memory: {
      getRecommendationMemory: () => ({ modelSummary: '已知偏好：偏好雨声。', excludedTrackIds: [], preferredKinds: ['rain'] }),
      record: (event) => events.push(event.eventType),
      complete: (session) => completed.push(session),
    },
  });

  assert.deepEqual(events, ['recommended', 'played']);
  assert.equal(completed[0]?.mood, 'tired');
  assert.equal(completed[0]?.summary.includes('用户：'), false);
});

test('records explicit dislike and recommends another track before playback', async () => {
  const events: string[] = [];
  const played: string[] = [];
  const answers = ['不喜欢', '好'];

  await runBackgroundAudioConversation('今天很累。', {
    getSleepPlan: async () => tiredPlan,
    ask: async () => answers.shift() ?? '好',
    say: () => {},
    playAudio: (filePath) => played.push(filePath),
    memory: {
      getRecommendationMemory: () => ({ modelSummary: '已知偏好：暂无稳定偏好。', excludedTrackIds: [], preferredKinds: [] }),
      record: (event) => events.push(`${event.eventType}:${event.trackId}`),
      complete: () => {},
    },
  });

  assert.equal(events.some((event) => event === 'disliked:spring-rain'), true);
  assert.match(played[0]!, /壁炉燃烧的木头噼里啪啦响\.mp3$/);
});
