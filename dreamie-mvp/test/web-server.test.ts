import assert from 'node:assert/strict';
import test from 'node:test';

import { getListenPort, getLocalCertificateUrl, getLocalPreviewUrls, createDreamieWebServer } from '../src/web-server.js';

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
  const names = ['DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DASHSCOPE_API_KEY', 'DASHSCOPE_ASR_MODEL'];
  const before = new Map(names.map((name) => [name, process.env[name]]));
  process.env.DEEPSEEK_API_KEY = 'test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-flash';
  process.env.DASHSCOPE_API_KEY = 'test-key';
  process.env.DASHSCOPE_ASR_MODEL = 'fun-asr-flash-2026-06-15';
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
