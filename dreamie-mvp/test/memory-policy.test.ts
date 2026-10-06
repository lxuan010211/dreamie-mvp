import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyListeningFeedback } from '../src/memory-policy.js';
import { openMemoryStore } from '../src/memory-store.js';
import { buildRecommendationMemory } from '../src/recommendation-context.js';

function createStore(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'dreamie-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return openMemoryStore(join(directory, 'dreamie.db'));
}

test('creates a behavioral preference after three rain plays', (t) => {
  const store = createStore(t);
  const sessionId = store.startSession();

  applyListeningFeedback(store, { sessionId, trackId: 'spring-rain', trackKind: 'rain', eventType: 'played' });
  applyListeningFeedback(store, { sessionId, trackId: 'jungle-rain', trackKind: 'rain', eventType: 'played' });
  applyListeningFeedback(store, { sessionId, trackId: 'spring-rain', trackKind: 'rain', eventType: 'played' });

  assert.equal(buildRecommendationMemory(store).preferredKinds.includes('rain'), true);
});

test('does not create a negative memory from one changed track', (t) => {
  const store = createStore(t);
  const sessionId = store.startSession();

  applyListeningFeedback(store, { sessionId, trackId: 'spring-rain', trackKind: 'rain', eventType: 'changed' });

  assert.equal(buildRecommendationMemory(store).excludedTrackIds.includes('spring-rain'), false);
});

test('excludes a track after an explicit dislike', (t) => {
  const store = createStore(t);
  const sessionId = store.startSession();

  applyListeningFeedback(store, {
    sessionId,
    trackId: 'asmr-microphone-biting',
    trackKind: 'asmr',
    eventType: 'disliked',
  });

  assert.equal(buildRecommendationMemory(store).excludedTrackIds.includes('asmr-microphone-biting'), true);
});
