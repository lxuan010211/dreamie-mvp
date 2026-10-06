import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryStore, openMemoryStoreOrNull } from '../src/memory-store.js';

function makeTestDatabasePath(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-memory-'));
  return { directory, databasePath: join(directory, 'dreamie.db') };
}

test('initializes local-user and persists a played event', (t) => {
  const { directory, databasePath } = makeTestDatabasePath();
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = openMemoryStore(databasePath);
  const sessionId = store.startSession();
  store.recordEvent({ sessionId, trackId: 'spring-rain', eventType: 'played' });

  assert.equal(store.listEvents({ trackId: 'spring-rain' }).length, 1);
  assert.equal(store.getProfile().userId, 'local-user');
  assert.equal(store.getProfile().timezone, 'Asia/Shanghai');
});

test('uses a no-op store when the database cannot be opened', () => {
  let wasUnavailableNotified = false;
  const unwritableDatabasePath = '/dev/null/dreamie.db';
  const store = openMemoryStoreOrNull(unwritableDatabasePath, () => {
    wasUnavailableNotified = true;
  });

  assert.doesNotThrow(() => {
    store.recordEvent({ sessionId: 'local', trackId: 'spring-rain', eventType: 'played' });
  });
  assert.equal(wasUnavailableNotified, true);
});

test('clears persisted local memory without touching audio files', (t) => {
  const { directory, databasePath } = makeTestDatabasePath();
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = openMemoryStore(databasePath);
  const sessionId = store.startSession();
  store.recordEvent({ sessionId, trackId: 'spring-rain', eventType: 'played' });
  store.upsertMemory({
    key: 'preferred_audio_kind',
    value: 'rain',
    polarity: 'positive',
    confidence: 0.6,
    evidenceCount: 1,
    source: 'behavioral',
  });

  store.clearAll();

  assert.equal(store.listMemories().length, 0);
  assert.equal(store.listEvents({}).length, 0);
});
