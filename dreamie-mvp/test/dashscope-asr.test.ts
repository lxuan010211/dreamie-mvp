import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashScopeAsr } from '../src/dashscope-asr.js';

test('sends browser audio to DashScope and returns recognized text', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const asr = createDashScopeAsr({
    apiKey: 'test-key',
    model: 'fun-asr-flash-2026-06-15',
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({ output: { text: '我想听雨声。' } }), { status: 200 });
    },
  });

  const text = await asr.transcribe({ dataUrl: 'data:audio/webm;base64,AAE=', format: 'webm' });

  assert.equal(text, '我想听雨声。');
  assert.equal(requestUrl, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    model: 'fun-asr-flash-2026-06-15',
    input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/webm;base64,AAE=' } }] }] },
    parameters: { format: 'webm', language_hints: ['zh'] },
  });
});
