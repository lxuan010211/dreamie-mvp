import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig, loadDashScopeAsrConfig, loadMemoryStoreConfig, loadMiniMaxTtsConfig } from '../src/config.js';

test('rejects a missing DeepSeek API key', () => {
  assert.throws(
    () => loadConfig({ DEEPSEEK_MODEL: 'example-model' }),
    /DEEPSEEK_API_KEY/,
  );
});

test('uses the configured DeepSeek model and base URL', () => {
  const config = loadConfig({
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_MODEL: 'example-model',
  });

  assert.deepEqual(config, {
    apiKey: 'test-key',
    baseURL: 'https://api.deepseek.com',
    model: 'example-model',
  });
});

test('loads MiniMax voice and speed settings', () => {
  const config = loadMiniMaxTtsConfig({
    MINIMAX_API_KEY: 'test-key',
    MINIMAX_TTS_MODEL: 'speech-2.6-hd',
    MINIMAX_TTS_VOICE_ID: 'female-test',
    MINIMAX_TTS_SPEED: '0.8',
  });

  assert.deepEqual(config, {
    apiKey: 'test-key',
    model: 'speech-2.6-hd',
    speed: 0.8,
    voiceId: 'female-test',
  });
});

test('loads DashScope ASR settings with the default flash model', () => {
  const config = loadDashScopeAsrConfig({ DASHSCOPE_API_KEY: 'test-key' });

  assert.deepEqual(config, {
    apiKey: 'test-key',
    model: 'fun-asr-flash-2026-06-15',
  });
});

test('uses local SQLite memory storage by default', () => {
  assert.deepEqual(loadMemoryStoreConfig({}), { kind: 'sqlite', databasePath: 'data/dreamie.db' });
});

test('loads PostgreSQL memory storage without exposing its URL', () => {
  assert.deepEqual(loadMemoryStoreConfig({ MEMORY_STORE: 'postgres', DATABASE_URL: 'postgres://secret@example.test/dreamie' }), {
    kind: 'postgres',
    connection: { kind: 'connection-string', databaseUrl: 'postgres://secret@example.test/dreamie' },
  });
  assert.throws(() => loadMemoryStoreConfig({ MEMORY_STORE: 'postgres' }), /DATABASE_URL or PGHOST/);
});

test('loads CloudBase PostgreSQL connection fields without requiring a hand-built URL', () => {
  assert.deepEqual(
    loadMemoryStoreConfig({
      MEMORY_STORE: 'postgres',
      PGHOST: 'db.internal.example',
      PGPORT: '5432',
      PGDATABASE: 'dreamie',
      PGUSER: 'dreamie_app',
      PGPASSWORD: 'password-with-special-characters',
    }),
    {
      kind: 'postgres',
      connection: {
        kind: 'parameters',
        host: 'db.internal.example',
        port: 5432,
        database: 'dreamie',
        user: 'dreamie_app',
        password: 'password-with-special-characters',
      },
    },
  );
});
