import assert from 'node:assert/strict';
import test from 'node:test';

import { RunContext } from '@openai/agents';

import {
  createDreamieToolContext,
  createDreamieTools,
  type DreamieToolContext,
  type DreamieToolTrack,
} from '../src/dreamie-tools.js';
import { sleepAudioCatalog } from '../src/audio-catalog.js';

const springRain: DreamieToolTrack = {
  id: 'spring-rain',
  title: '春日淅沥沥的小雨声',
  kind: 'rain',
};

function createContext(overrides: Partial<DreamieToolContext> = {}): DreamieToolContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    mood: 'stressed',
    preferredKinds: ['rain'],
    excludedTrackIds: ['ocean-waves'],
    playbackAllowed: false,
    effects: {},
    recommendTrack: async () => springRain,
    synthesizeSpeech: async () => 'data:audio/mpeg;base64,AAE=',
    saveMemory: async () => undefined,
    ...overrides,
  };
}

async function invoke(
  context: DreamieToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool = createDreamieTools().find((candidate) => candidate.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool.invoke(new RunContext(context), JSON.stringify(input));
}

test('exposes only Dreamie’s four approved service tools', () => {
  const names = createDreamieTools().map((candidate) => candidate.name).sort();

  assert.deepEqual(names, [
    'generate_tts',
    'recommend_background_audio',
    'request_background_playback',
    'save_sleep_memory',
  ]);
});

test('returns a safe background recommendation without playback metadata', async () => {
  const context = createContext();
  const result = await invoke(context, 'recommend_background_audio', { intent: 'background' }) as Record<string, unknown>;

  assert.deepEqual(result, {
    status: 'recommended',
    trackId: 'spring-rain',
    title: '春日淅沥沥的小雨声',
    kind: 'rain',
    recommendation: '可以试试「春日淅沥沥的小雨声」。如果你愿意，我再为你播放。',
  });
  assert.equal(context.effects.recommendedTrack?.id, 'spring-rain');
  assert.equal('url' in result, false);
  assert.equal('filePath' in result, false);
  assert.equal('dataUrl' in result, false);
  assert.equal('autoplay' in result, false);
});

test('keeps a playback request pending until the session confirms consent', async () => {
  const context = createContext({ effects: { recommendedTrack: springRain } });
  const result = await invoke(context, 'request_background_playback', { trackId: 'spring-rain' });

  assert.deepEqual(result, {
    status: 'pending_confirmation',
    trackId: 'spring-rain',
    message: '等待用户确认后再播放。',
  });
  assert.deepEqual(context.effects.playback, {
    trackId: 'spring-rain',
    status: 'pending_confirmation',
  });
});

test('allows playing only the server-selected track after confirmation', async () => {
  const context = createContext({
    playbackAllowed: true,
    effects: { recommendedTrack: springRain },
  });
  const result = await invoke(context, 'request_background_playback', { trackId: 'spring-rain' });

  assert.deepEqual(result, {
    status: 'playing',
    trackId: 'spring-rain',
    message: '已准备好由浏览器播放。',
  });
  assert.deepEqual(context.effects.playback, { trackId: 'spring-rain', status: 'playing' });
});

test('rejects an unselected track without creating a playback effect', async () => {
  const context = createContext({
    playbackAllowed: true,
    effects: { recommendedTrack: springRain },
  });

  const result = await invoke(context, 'request_background_playback', { trackId: 'not-in-catalog' });

  assert.match(String(result), /server-selected track/i);
  assert.equal(context.effects.playback, undefined);
});

test('stores generated TTS data in server-only effects without exposing voice configuration to the model', async () => {
  const calls: Array<{ text: string }> = [];
  const context = createContext({
    synthesizeSpeech: async (input) => {
      calls.push(input);
      return 'data:audio/mpeg;base64,AAE=';
    },
  });
  const result = await invoke(context, 'generate_tts', {
    text: '现在让肩膀轻轻放松，呼吸慢一点。',
  });

  assert.deepEqual(result, { status: 'ready', format: 'mp3' });
  assert.deepEqual(calls, [{
    text: '现在让肩膀轻轻放松，呼吸慢一点。',
  }]);
  assert.equal(context.effects.ttsDataUrl, 'data:audio/mpeg;base64,AAE=');
});

test('writes only explicit listening feedback to memory', async () => {
  const saved: Array<{ event: 'liked' | 'disliked'; target: 'background' | 'voice' | 'content' }> = [];
  const context = createContext({
    allowedMemoryFeedback: { event: 'liked', target: 'background' },
    saveMemory: async (input) => { saved.push(input); },
  });
  const result = await invoke(context, 'save_sleep_memory', {
    event: 'liked',
    target: 'background',
  });

  assert.deepEqual(result, { status: 'saved' });
  assert.deepEqual(saved, [{ event: 'liked', target: 'background' }]);
});

test('does not persist inferred or replayed memory feedback', async () => {
  const saved: Array<{ event: 'liked' | 'disliked'; target: 'background' | 'voice' | 'content' }> = [];
  const context = createContext({
    allowedMemoryFeedback: { event: 'liked', target: 'background' },
    saveMemory: async (input) => { saved.push(input); },
  });

  const result = await invoke(context, 'save_sleep_memory', { event: 'disliked', target: 'background' });

  assert.deepEqual(result, { status: 'ignored', message: '只有当前消息中明确表达的偏好才会保存。' });
  assert.deepEqual(saved, []);
});

test('uses the configured MiniMax voice and speed through the TTS adapter', async () => {
  let requestBody = '';
  const context = createDreamieToolContext({
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    mood: 'tired',
    preferredKinds: [],
    excludedTrackIds: [],
    playbackAllowed: false,
    ttsConfig: {
      apiKey: 'test-key',
      model: 'speech-2.6-hd',
      voiceId: 'female-test',
      speed: 0.8,
    },
    saveMemory: async () => undefined,
    fetchImpl: async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({
        base_resp: { status_code: 0, status_msg: 'success' },
        data: { audio: '000102ff' },
      }), { status: 200 });
    },
  });

  const result = await invoke(context, 'generate_tts', {
    text: '让呼吸慢一点，肩膀也轻轻放松。',
  });

  assert.deepEqual(result, { status: 'ready', format: 'mp3' });
  assert.match(requestBody, /"model":"speech-2.6-hd"/);
  assert.match(requestBody, /"voice_id":"female-test"/);
  assert.match(requestBody, /"speed":0.8/);
  assert.equal(context.effects.ttsDataUrl, 'data:audio/mpeg;base64,AAEC/w==');
});

test('keeps the conversation usable when MiniMax TTS fails', async () => {
  const context = createDreamieToolContext({
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    mood: 'tired',
    preferredKinds: [],
    excludedTrackIds: [],
    playbackAllowed: false,
    ttsConfig: {
      apiKey: 'test-key',
      model: 'speech-2.6-hd',
      voiceId: 'female-test',
      speed: 0.8,
    },
    saveMemory: async () => undefined,
    fetchImpl: async () => new Response(JSON.stringify({
      base_resp: { status_code: 1001, status_msg: 'MiniMax unavailable' },
    }), { status: 503 }),
  });

  const result = await invoke(context, 'generate_tts', {
    text: '让呼吸慢一点，肩膀也轻轻放松。',
  });

  assert.deepEqual(result, { status: 'unavailable', message: '语音暂时不可用。' });
  assert.equal(context.effects.ttsDataUrl, undefined);
  assert.deepEqual(context.effects.toolErrors, ['语音暂时不可用。']);
});

test('selects only an allowed catalog track and honors exclusions', async () => {
  const context = createDreamieToolContext({
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    mood: 'stressed',
    preferredKinds: ['rain'],
    excludedTrackIds: ['spring-rain'],
    playbackAllowed: false,
    ttsConfig: {
      apiKey: 'test-key',
      model: 'speech-2.6-hd',
      voiceId: 'female-test',
      speed: 0.8,
    },
    saveMemory: async () => undefined,
  });

  const result = await invoke(context, 'recommend_background_audio', { intent: 'background' }) as Record<string, unknown>;

  assert.notEqual(result.trackId, 'spring-rain');
  assert.ok(sleepAudioCatalog.some((track) => track.id === result.trackId));
  assert.equal(context.effects.recommendedTrack?.id, result.trackId);
});
