import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostgresMemoryStore } from '../src/postgres-memory-store.js';

test('initializes parameterized tables and writes events for only its user', async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = { query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [] }; } };
  const store = await createPostgresMemoryStore(client, '11111111-1111-4111-8111-111111111111');
  const sessionId = await store.startSession();
  await store.recordEvent({ sessionId, trackId: 'spring-rain', eventType: 'played' });
  assert.match(calls[0].text, /CREATE TABLE IF NOT EXISTS user_profile/);
  assert.ok(calls.some((call) => call.text.includes('INSERT INTO listening_events') && call.values?.includes('11111111-1111-4111-8111-111111111111')));
  assert.ok(calls.every((call) => !call.text.includes('11111111-1111-4111-8111-111111111111')));
});

test('clears only the bound user with one parameterized statement at a time', async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes(';')) throw new Error('multiple statements are not supported');
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  const userId = '22222222-2222-4222-8222-222222222222';
  const store = await createPostgresMemoryStore(client, userId);

  await store.clearAll();

  const deletes = calls.filter((call) => call.text.startsWith('DELETE FROM'));
  assert.equal(deletes.length, 3);
  assert.ok(deletes.every((call) => call.values?.[0] === userId));
});
