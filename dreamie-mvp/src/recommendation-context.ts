import { findSleepAudioById, type SleepAudioKind } from './audio-catalog.js';
import type { MemoryStore } from './memory-store.js';
import type { AsyncMemoryStore } from './postgres-memory-store.js';

export interface RecommendationMemory {
  modelSummary: string;
  excludedTrackIds: string[];
  preferredKinds: SleepAudioKind[];
}

const kindLabels: Record<SleepAudioKind, string> = {
  ocean: '海浪声',
  rain: '雨声',
  meditation: '冥想颂钵',
  fireplace: '壁炉声',
  'cat-purr': '猫咪呼噜声',
  nature: '自然环境声',
  birds: '鸟鸣',
  'wind-chimes': '风铃声',
  asmr: 'ASMR',
};

export function buildRecommendationMemory(store: MemoryStore): RecommendationMemory {
  const memories = store.listMemories();
  const excludedTrackIds = memories
    .filter((memory) => memory.key === 'disliked_track_id' && memory.polarity === 'negative')
    .map((memory) => memory.value);
  const preferredKinds = memories
    .filter((memory) => memory.key === 'preferred_audio_kind' && memory.polarity === 'positive')
    .map((memory) => memory.value)
    .filter(isSleepAudioKind);
  const recentTrackKinds = recentKinds(store);
  const preferenceText = preferredKinds.map((kind) => kindLabels[kind]).join('、');
  const recentText = recentTrackKinds.map((kind) => kindLabels[kind]).join('、');
  const modelSummary = [
    preferenceText ? `已知偏好：偏好${preferenceText}。` : '已知偏好：暂无稳定偏好。',
    recentText ? `近 14 天常播放：${recentText}。` : '',
    excludedTrackIds.length > 0 ? '有明确不喜欢的背景音，推荐时应避免。' : '',
  ]
    .filter(Boolean)
    .join('');

  return { modelSummary, excludedTrackIds, preferredKinds };
}

export async function buildRecommendationMemoryAsync(
  store: AsyncMemoryStore,
): Promise<RecommendationMemory> {
  const memories = await store.listMemories();
  const excludedTrackIds = memories
    .filter((memory) => memory.key === 'disliked_track_id' && memory.polarity === 'negative')
    .map((memory) => memory.value);
  const preferredKinds = memories
    .filter((memory) => memory.key === 'preferred_audio_kind' && memory.polarity === 'positive')
    .map((memory) => memory.value)
    .filter(isSleepAudioKind);
  const recentTrackKinds = await recentKindsAsync(store);
  const preferenceText = preferredKinds.map((kind) => kindLabels[kind]).join('、');
  const recentText = recentTrackKinds.map((kind) => kindLabels[kind]).join('、');
  const modelSummary = [
    preferenceText ? `已知偏好：偏好${preferenceText}。` : '已知偏好：暂无稳定偏好。',
    recentText ? `近 14 天常播放：${recentText}。` : '',
    excludedTrackIds.length > 0 ? '有明确不喜欢的背景音，推荐时应避免。' : '',
  ]
    .filter(Boolean)
    .join('');

  return { modelSummary, excludedTrackIds, preferredKinds };
}

function recentKinds(store: MemoryStore): SleepAudioKind[] {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const kinds = store
    .listEvents({ since })
    .filter((event) => event.eventType === 'played' || event.eventType === 'liked')
    .map((event) => findSleepAudioById(event.trackId)?.kind)
    .filter((kind): kind is SleepAudioKind => kind !== undefined);

  return [...new Set(kinds)];
}

async function recentKindsAsync(store: AsyncMemoryStore): Promise<SleepAudioKind[]> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const kinds = (await store.listEvents({ since }))
    .filter((event) => event.eventType === 'played' || event.eventType === 'liked')
    .map((event) => findSleepAudioById(event.trackId)?.kind)
    .filter((kind): kind is SleepAudioKind => kind !== undefined);

  return [...new Set(kinds)];
}

function isSleepAudioKind(value: string): value is SleepAudioKind {
  return value in kindLabels;
}
