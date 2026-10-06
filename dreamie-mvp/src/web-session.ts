import { randomUUID } from 'node:crypto';

import { type SleepAudioTrack } from './audio-catalog.js';
import { addAssistantMessage, addUserMessage, createBackgroundAudioSession, getBackgroundAudioAction, getBackgroundRecommendationText, getConversationPrompt, recommendBackgroundAudio } from './background-audio-session.js';
import type { SleepPlan } from './dreamie.js';
import { applyListeningFeedback } from './memory-policy.js';
import type { MemoryStore } from './memory-store.js';
import { buildRecommendationMemory, type RecommendationMemory } from './recommendation-context.js';

export interface WebChatResponse { sessionId: string; reply: string; audio?: { trackId: string; title: string; url: string; state: 'pending' | 'playing' } }
export interface WebSessionService { handleMessage(input: { userId?: string; sessionId?: string; message: string }): Promise<WebChatResponse>; getEventTypes(sessionId: string, userId?: string): string[] }

interface WebSession { id: string; memorySessionId: string; dialogue: ReturnType<typeof createBackgroundAudioSession>; memory: RecommendationMemory; excluded: string[]; track?: SleepAudioTrack; mood: SleepPlan['mood']; eventTypes: string[] }

export function createWebSessionService(dependencies: { memoryStore: MemoryStore; getSleepPlan(prompt: string): Promise<SleepPlan> }): WebSessionService {
  const sessions = new Map<string, WebSession>();
  const getSession = (userId: string, sessionId?: string) => {
    const key = sessionId ? `${userId}:${sessionId}` : undefined;
    const existing = key ? sessions.get(key) : undefined;
    if (existing) return existing;
    const id = randomUUID();
    const session: WebSession = { id, memorySessionId: dependencies.memoryStore.startSession(), dialogue: createBackgroundAudioSession(), memory: buildRecommendationMemory(dependencies.memoryStore), excluded: [], mood: 'unknown', eventTypes: [] };
    sessions.set(`${userId}:${id}`, session);
    return session;
  };
  const record = (session: WebSession, track: SleepAudioTrack, eventType: 'recommended' | 'played' | 'changed' | 'liked' | 'disliked') => {
    applyListeningFeedback(dependencies.memoryStore, { sessionId: session.memorySessionId, trackId: track.id, trackKind: track.kind, eventType });
    session.eventTypes.push(eventType);
  };
  const responseFor = (session: WebSession, reply: string, state: 'pending' | 'playing') => ({ sessionId: session.id, reply, audio: session.track ? { trackId: session.track.id, title: session.track.title, url: `/api/audio/${session.track.id}`, state } : undefined });
  return {
    async handleMessage(input) {
      if (!input.message.trim()) throw new Error('请输入想对 Dreamie 说的话。');
      const userId = input.userId ?? 'local-user';
      const session = getSession(userId, input.sessionId);
      const action = getBackgroundAudioAction(input.message);
      if (session.track && action === 'play') { record(session, session.track, 'played'); return responseFor(session, `正在播放「${session.track.title}」。`, 'playing'); }
      if (session.track && (action === 'change' || action === 'dislike')) {
        record(session, session.track, action === 'change' ? 'changed' : 'disliked');
        session.excluded.push(session.track.id);
        session.track = recommendBackgroundAudio(session.mood, [...session.memory.excludedTrackIds, ...session.excluded], session.memory.preferredKinds);
        record(session, session.track, 'recommended');
        return responseFor(session, getBackgroundRecommendationText(session.track), 'pending');
      }
      if (session.track && action === 'like') { record(session, session.track, 'liked'); return responseFor(session, `我记住了，你喜欢「${session.track.title}」。${getBackgroundRecommendationText(session.track)}`, 'pending'); }
      session.dialogue = addUserMessage(session.dialogue, input.message);
      const plan = await dependencies.getSleepPlan(`${getConversationPrompt(session.dialogue)}\n${session.memory.modelSummary}`);
      session.dialogue = addAssistantMessage(session.dialogue, plan.reply);
      session.mood = plan.mood;
      session.track = recommendBackgroundAudio(plan.mood, [...session.memory.excludedTrackIds, ...session.excluded], session.memory.preferredKinds);
      record(session, session.track, 'recommended');
      return responseFor(session, `${plan.reply}\n${getBackgroundRecommendationText(session.track)}`, 'pending');
    },
    getEventTypes: (sessionId, userId = 'local-user') => sessions.get(`${userId}:${sessionId}`)?.eventTypes ?? [],
  };
}
