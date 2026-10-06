import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWebAudioResponse, getListenPort, getLocalCertificateUrl, getLocalPreviewUrls, getSpeechText, getStaticFile, createDreamieWebServer } from '../src/web-server.js';

test('serves the browser audio controller module and prefers the generated script for TTS', () => {
  assert.equal(getStaticFile('/audio-player.js'), 'audio-player.js');
  assert.equal(getSpeechText({ reply: '简短回复', audioScript: '完整睡前故事。' }), '简短回复\n完整睡前故事。');
  assert.equal(getSpeechText({ reply: '简短回复' }), '简短回复');
});

test('lists both HTTP and local HTTPS preview addresses', () => {
  assert.deepEqual(getLocalPreviewUrls('10.194.246.209'), {
    http: 'http://10.194.246.209:3000',
    https: 'https://10.194.246.209:3443',
  });
});

test('builds a local certificate download address', () => {
  assert.equal(getLocalCertificateUrl('10.194.246.209'), 'http://10.194.246.209:3000/dreamie-local-ca.crt');
});

test('uses a CloudBase port when provided and rejects invalid ports', () => {
  assert.equal(getListenPort({}), 3000);
  assert.equal(getListenPort({ PORT: '8080' }), 8080);
  assert.throws(() => getListenPort({ PORT: 'not-a-port' }), /PORT/);
  assert.throws(() => getListenPort({ PORT: '70000' }), /PORT/);
});

test('serializes a voice-only response without a background layer', () => {
  const result = buildWebAudioResponse({
    sessionId: 'session',
    reply: '慢慢呼吸就好。',
    audioMode: 'voice',
    autoplay: true,
  }, 'data:audio/mpeg;base64,AAE=');

  assert.deepEqual(result.tts, { dataUrl: 'data:audio/mpeg;base64,AAE=' });
  assert.equal(result.background, undefined);
  assert.equal(result.reply, '慢慢呼吸就好。');
});

test('serializes a mixed response with safe background metadata', () => {
  const result = buildWebAudioResponse({
    sessionId: 'session',
    reply: '听一段小故事吧。',
    audioMode: 'voice_with_background',
    backgroundTrackId: 'spring-rain',
    autoplay: false,
    audio: { trackId: 'spring-rain', title: '春日淅沥沥的小雨声', url: '/api/audio/spring-rain', state: 'pending' },
  }, 'data:audio/mpeg;base64,AAE=');

  assert.deepEqual(result.background, {
    trackId: 'spring-rain',
    title: '春日淅沥沥的小雨声',
    url: '/api/audio/spring-rain',
    autoplay: false,
  });
});

test('keeps text when TTS synthesis fails', () => {
  const result = buildWebAudioResponse({
    sessionId: 'session',
    reply: '文字仍然可以阅读。',
    audioMode: 'voice',
    autoplay: true,
  }, undefined, '语音暂时不可用，但文字回复仍然有效。');

  assert.equal(result.reply, '文字仍然可以阅读。');
  assert.equal(result.tts, undefined);
  assert.equal(result.ttsError, '语音暂时不可用，但文字回复仍然有效。');
});

test('rejects a missing or malformed anonymous browser ID before chat handling', async (t) => {
  const restore = configureTestEnvironment();
  t.after(restore);
  const { server, close } = createDreamieWebServer();
  t.after(async () => {
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/api/chat`;

  const malformed = await postJson(endpoint, { userId: 'not-a-uuid', message: '今天很累' });
  const validButIncomplete = await postJson(endpoint, {
    userId: '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(malformed.status, 400);
  assert.match(await malformed.text(), /浏览器身份无效/);
  assert.equal(validButIncomplete.status, 400);
  assert.match(await validButIncomplete.text(), /请输入文字消息/);
});

function configureTestEnvironment(): () => void {
  const names = ['DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DASHSCOPE_API_KEY', 'DASHSCOPE_ASR_MODEL', 'MINIMAX_API_KEY', 'MINIMAX_TTS_MODEL', 'MINIMAX_TTS_SPEED', 'MINIMAX_TTS_VOICE_ID'];
  const before = new Map(names.map((name) => [name, process.env[name]]));
  process.env.DEEPSEEK_API_KEY = 'test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-flash';
  process.env.DASHSCOPE_API_KEY = 'test-key';
  process.env.DASHSCOPE_ASR_MODEL = 'fun-asr-flash-2026-06-15';
  process.env.MINIMAX_API_KEY = 'test-key';
  process.env.MINIMAX_TTS_MODEL = 'speech-2.6-hd';
  process.env.MINIMAX_TTS_SPEED = '0.8';
  process.env.MINIMAX_TTS_VOICE_ID = 'female-test';
  return () => {
    for (const name of names) {
      const value = before.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
