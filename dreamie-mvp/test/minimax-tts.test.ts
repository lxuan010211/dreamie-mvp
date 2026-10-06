import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMiniMaxSpeechRequest,
  decodeMiniMaxSpeechResponse,
  miniMaxSpeechEndpoint,
} from '../src/minimax-tts.js';

test('uses the MiniMax compatibility endpoint', () => {
  assert.equal(miniMaxSpeechEndpoint, 'https://api.minimaxi.com/v1/t2a_v2');
});

test('builds a MiniMax request with the chosen voice and speed', () => {
  const request = buildMiniMaxSpeechRequest('今晚慢慢放松。', {
    apiKey: 'test-key',
    model: 'speech-2.6-hd',
    speed: 0.8,
    voiceId: 'female-test',
  });

  assert.deepEqual(request, {
    audio_setting: {
      bitrate: 128000,
      channel: 1,
      format: 'mp3',
      sample_rate: 32000,
    },
    language_boost: 'Chinese',
    model: 'speech-2.6-hd',
    output_format: 'hex',
    stream: false,
    text: '今晚慢慢放松。',
    voice_setting: {
      pitch: 0,
      speed: 0.8,
      voice_id: 'female-test',
      vol: 1,
    },
  });
});

test('decodes a successful MiniMax hex audio response', () => {
  const audio = decodeMiniMaxSpeechResponse({
    base_resp: { status_code: 0, status_msg: 'success' },
    data: { audio: '000102ff', status: 2 },
  });

  assert.deepEqual([...audio], [0, 1, 2, 255]);
});
