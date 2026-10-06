import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createMemoryStoreFactory } from '../src/memory-store-factory.js';

test('creates separately scoped SQLite stores for different anonymous users', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-memory-factory-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const factory = createMemoryStoreFactory({ kind: 'sqlite', databasePath: join(directory, 'dreamie.db') });
  const first = await factory.forUser('11111111-1111-4111-8111-111111111111');
  const second = await factory.forUser('22222222-2222-4222-8222-222222222222');
  const sessionId = await first.startSession();

  await first.recordEvent({ sessionId, trackId: 'spring-rain', eventType: 'played' });

  assert.equal((await first.listEvents({})).length, 1);
  assert.equal((await second.listEvents({})).length, 0);
  await factory.close();
});
