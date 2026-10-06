import { randomUUID } from 'node:crypto';

import { findSleepAudioById, type SleepAudioTrack } from './audio-catalog.js';
import {
  addAssistantMessage,
  addUserMessage,
  createBackgroundAudioSession,
  getBackgroundAudioAction,
  getBackgroundRecommendationText,
  getConversationPrompt,
  markRecommendationDeclined,
  recommendBackgroundAudio,
  requestsBackgroundAudio,
  shouldSoftRecommendBackgroundAudio,
} from './background-audio-session.js';
import type { SleepPlan } from './dreamie.js';
import type { MemoryStoreFactory } from './memory-store-factory.js';
import { applyListeningFeedbackAsync } from './memory-policy.js';
import type { AsyncMemoryStore } from './postgres-memory-store.js';
import {
  buildRecommendationMemoryAsync,
  type RecommendationMemory,
} from './recommendation-context.js';

export interface WebChatResponse {
  sessionId: string;
  reply: string;
  audioMode: SleepPlan['audioMode'];
  backgroundTrackId?: string;
  recommendation?: string;
  autoplay: boolean;
  audio?: {
    trackId: string;
    title: string;
    url: string;
    state: 'pending' | 'playing';
  };
}

export interface WebSessionService {
  handleMessage(input: {
    userId: string;
    sessionId?: string;
    message: string;
  }): Promise<WebChatResponse>;
  getEventTypes(sessionId: string, userId: string): string[];
}

interface WebSession {
  id: string;
  userId: string;
  memoryStore: AsyncMemoryStore;
  memorySessionId: string;
  dialogue: ReturnType<typeof createBackgroundAudioSession>;
  memory: RecommendationMemory;
  excluded: string[];
  track?: SleepAudioTrack;
  mood: SleepPlan['mood'];
  eventTypes: string[];
  recommendationShown: boolean;
}

export function createWebSessionService(dependencies: {
  memoryStores: MemoryStoreFactory;
  getSleepPlan(prompt: string): Promise<SleepPlan>;
}): WebSessionService {
  const sessions = new Map<string, WebSession>();

  async function getSession(userId: string, sessionId?: string): Promise<WebSession> {
    const existing = sessionId ? sessions.get(sessionKey(userId, sessionId)) : undefined;
    if (existing) return existing;

    const memoryStore = await dependencies.memoryStores.forUser(userId);
    const id = randomUUID();
    const session: WebSession = {
      id,
      userId,
      memoryStore,
      memorySessionId: await memoryStore.startSession(),
      dialogue: createBackgroundAudioSession(),
      memory: await buildRecommendationMemoryAsync(memoryStore),
      excluded: [],
      mood: 'unknown',
      eventTypes: [],
      recommendationShown: false,
    };
    sessions.set(sessionKey(userId, id), session);
    return session;
  }

  async function record(
    session: WebSession,
    track: SleepAudioTrack,
    eventType: 'recommended' | 'played' | 'changed' | 'liked' | 'disliked',
  ): Promise<void> {
    await applyListeningFeedbackAsync(session.memoryStore, {
      sessionId: session.memorySessionId,
      trackId: track.id,
      trackKind: track.kind,
      eventType,
    });
    session.eventTypes.push(eventType);
  }

  function responseFor(
    session: WebSession,
    reply: string,
    state: 'pending' | 'playing',
    audioPlan?: Pick<SleepPlan, 'audioMode' | 'backgroundTrackId' | 'recommendation' | 'autoplay'>,
  ): WebChatResponse {
    return {
      sessionId: session.id,
      reply,
      audioMode: audioPlan?.audioMode ?? 'voice',
      backgroundTrackId: audioPlan?.backgroundTrackId,
      recommendation: audioPlan?.recommendation,
      autoplay: audioPlan?.autoplay ?? true,
      audio: session.track
        ? {
            trackId: session.track.id,
            title: session.track.title,
            url: `/api/audio/${session.track.id}`,
            state,
          }
        : undefined,
    };
  }

  return {
    async handleMessage(input): Promise<WebChatResponse> {
      if (!input.message.trim()) throw new Error('请输入想对 Dreamie 说的话。');

      const session = await getSession(input.userId, input.sessionId);
      const action = getBackgroundAudioAction(input.message);

      if (session.track && action === 'play') {
        await record(session, session.track, 'played');
        return responseFor(
          session,
          `正在播放「${session.track.title}」。`,
          'playing',
          { audioMode: 'background', backgroundTrackId: session.track.id, autoplay: true },
        );
      }

      if (session.track && (action === 'change' || action === 'dislike')) {
        if (action === 'dislike') {
          await record(session, session.track, 'disliked');
          session.track = undefined;
          session.dialogue = markRecommendationDeclined(
            addAssistantMessage(session.dialogue, '好的，我记住了，今晚不再推荐背景音。'),
          );
          return responseFor(session, '好的，我记住了，今晚不再推荐背景音。', 'pending');
        }
        await record(session, session.track, action === 'change' ? 'changed' : 'disliked');
        session.excluded.push(session.track.id);
        session.track = recommendBackgroundAudio(
          session.mood,
          [...session.memory.excludedTrackIds, ...session.excluded],
          session.memory.preferredKinds,
        );
        await record(session, session.track, 'recommended');
        return responseFor(session, getBackgroundRecommendationText(session.track), 'pending');
      }

      if (session.track && action === 'like') {
        await record(session, session.track, 'liked');
        return responseFor(
          session,
          `我记住了，你喜欢「${session.track.title}」。${getBackgroundRecommendationText(session.track)}`,
          'pending',
        );
      }

      session.dialogue = addUserMessage(session.dialogue, input.message);
      const plan = await dependencies.getSleepPlan(
        `${getConversationPrompt(session.dialogue)}\n${session.memory.modelSummary}`,
      );
      session.dialogue = addAssistantMessage(session.dialogue, plan.reply);
      session.mood = plan.mood;
      const explicitBackground = requestsBackgroundAudio(input.message);
      // The model may suggest an audio mode, but only an explicit user request
      // or the bounded soft-recommendation policy may attach a background layer.
      const shouldAttachAudio = explicitBackground;
      const shouldSuggest = !shouldAttachAudio && !session.dialogue.recommendationCooldown && shouldSoftRecommendBackgroundAudio(
        plan.mood,
        session.memory.preferredKinds,
        session.recommendationShown,
        input.message,
      );
      if (shouldAttachAudio || shouldSuggest) {
        session.track = (plan.backgroundTrackId ? findSleepAudioById(plan.backgroundTrackId) : undefined)
          ?? recommendBackgroundAudio(
            plan.mood,
            [...session.memory.excludedTrackIds, ...session.excluded],
            session.memory.preferredKinds,
          );
        await record(session, session.track, 'recommended');
        session.recommendationShown = true;
      } else {
        session.track = undefined;
      }
      const responsePlan = shouldSuggest
        ? { ...plan, audioMode: 'background' as const, backgroundTrackId: session.track?.id, recommendation: plan.recommendation ?? getBackgroundRecommendationText(session.track!), autoplay: false }
        : shouldAttachAudio
          ? { ...plan, audioMode: 'voice_with_background' as const, backgroundTrackId: session.track?.id }
          : { ...plan, audioMode: 'voice' as const, backgroundTrackId: undefined, recommendation: undefined };
      const responseText = shouldSuggest || shouldAttachAudio
        ? `${plan.reply}\n${getBackgroundRecommendationText(session.track!)}`
        : plan.reply;
      return responseFor(
        session,
        responseText,
        'pending',
        responsePlan,
      );
    },

    getEventTypes(sessionId, userId): string[] {
      return sessions.get(sessionKey(userId, sessionId))?.eventTypes ?? [];
    },
  };
}

function sessionKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}
