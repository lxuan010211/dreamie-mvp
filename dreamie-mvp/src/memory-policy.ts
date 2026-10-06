import { findSleepAudioById, type SleepAudioKind } from './audio-catalog.js';
import type { ListeningEventType, MemoryStore } from './memory-store.js';

export interface ListeningFeedback {
  sessionId: string;
  trackId: string;
  trackKind: SleepAudioKind;
  eventType: ListeningEventType;
}

export function applyListeningFeedback(store: MemoryStore, input: ListeningFeedback): void {
  store.recordEvent(input);

  if (input.eventType === 'disliked') {
    store.upsertMemory({
      key: 'disliked_track_id',
      value: input.trackId,
      polarity: 'negative',
      confidence: 1,
      evidenceCount: 1,
      source: 'explicit',
    });
    return;
  }

  if (input.eventType === 'liked') {
    increasePreferredKind(store, input.trackKind, 'explicit');
    return;
  }

  if (input.eventType !== 'played') {
    return;
  }

  const matchingEvents = store
    .listEvents({})
    .filter((event) => event.eventType === 'played' || event.eventType === 'liked')
    .filter((event) => findSleepAudioById(event.trackId)?.kind === input.trackKind);

  if (matchingEvents.length >= 3) {
    increasePreferredKind(store, input.trackKind, 'behavioral', matchingEvents.length);
  }
}

function increasePreferredKind(
  store: MemoryStore,
  trackKind: SleepAudioKind,
  source: 'explicit' | 'behavioral',
  evidenceCount?: number,
): void {
  const existing = store
    .listMemories()
    .find((memory) => memory.key === 'preferred_audio_kind' && memory.value === trackKind);
  const nextEvidenceCount = evidenceCount ?? (existing?.evidenceCount ?? 0) + 1;
  store.upsertMemory({
    key: 'preferred_audio_kind',
    value: trackKind,
    polarity: 'positive',
    confidence: Math.min(1, 0.4 + nextEvidenceCount * 0.15),
    evidenceCount: nextEvidenceCount,
    source,
  });
}
