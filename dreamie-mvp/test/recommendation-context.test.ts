import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryStore } from '../src/memory-store.js';
import { buildRecommendationMemory } from '../src/recommendation-context.js';

test('returns a compact summary without raw paths or event identifiers', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-context-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = openMemoryStore(join(directory, 'dreamie.db'));
  store.upsertMemory({
    key: 'preferred_audio_kind',
    value: 'rain',
    polarity: 'positive',
    confidence: 0.8,
    evidenceCount: 3,
    source: 'behavioral',
  });

  const memory = buildRecommendationMemory(store);

  assert.match(memory.modelSummary, /偏好/);
  assert.doesNotMatch(memory.modelSummary, /\/Users\//);
  assert.doesNotMatch(memory.modelSummary, /session_id/i);
});
