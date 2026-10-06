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
  requestsNarrationWithBackground,
  shouldSoftRecommendBackgroundAudio,
} from './background-audio-session.js';
import type { DreamieAgentRunResult, SleepPlan } from './dreamie.js';
import type { DreamieToolContext, DreamieToolEffects } from './dreamie-tools.js';
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
  audioScript?: string;
  audioMode: SleepPlan['audioMode'];
  backgroundTrackId?: string;
  recommendation?: string;
  autoplay: boolean;
  /** Server-only: removed by buildWebAudioResponse before JSON serialization. */
  ttsDataUrl?: string;
  /** Server-only: surfaced by buildWebAudioResponse as a safe browser message. */
  ttsError?: string;
  audio?: {
    trackId: string;
    title: string;
    url: string;
    state: 'pending' | 'playing';
  };
}

export interface WebToolContextInput {
  userId: string;
  sessionId: string;
  mood: SleepPlan['mood'];
  preferredKinds: DreamieToolContext['preferredKinds'];
  excludedTrackIds: string[];
  playbackAllowed: boolean;
  saveMemory: DreamieToolContext['saveMemory'];
}

export interface WebSleepPlanRequest {
  prompt: string;
  context?: DreamieToolContext;
}

type WebSleepPlanResult = SleepPlan | DreamieAgentRunResult;

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
  getSleepPlan(request: WebSleepPlanRequest): Promise<WebSleepPlanResult>;
  createToolContext?(input: WebToolContextInput): DreamieToolContext;
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
    audioPlan?: Partial<Pick<SleepPlan, 'audioScript' | 'audioMode' | 'backgroundTrackId' | 'recommendation' | 'autoplay'>>,
    effects?: DreamieToolEffects,
  ): WebChatResponse {
    return {
      sessionId: session.id,
      reply,
      audioScript: audioPlan?.audioScript,
      audioMode: audioPlan?.audioMode ?? 'voice',
      backgroundTrackId: audioPlan?.backgroundTrackId,
      recommendation: audioPlan?.recommendation,
      autoplay: audioPlan?.autoplay ?? state === 'playing',
      ttsDataUrl: audioPlan?.audioMode === 'background' ? undefined : effects?.ttsDataUrl,
      ttsError: effects?.toolErrors?.find((message) => message.includes('语音')),
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

  function getPlanAndEffects(result: WebSleepPlanResult): { plan: SleepPlan; effects: DreamieToolEffects } {
    if ('plan' in result) return { plan: result.plan, effects: result.effects };
    return { plan: result, effects: {} };
  }

  function createToolContext(session: WebSession): DreamieToolContext | undefined {
    return dependencies.createToolContext?.({
      userId: session.userId,
      sessionId: session.id,
      mood: session.mood,
      preferredKinds: [...session.memory.preferredKinds],
      excludedTrackIds: [...session.memory.excludedTrackIds, ...session.excluded],
      playbackAllowed: false,
      saveMemory: async (feedback) => {
        if (feedback.target !== 'background' || !session.track) return;
        await record(session, session.track, feedback.event);
      },
    });
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
      const run = await dependencies.getSleepPlan({
        prompt: `${getConversationPrompt(session.dialogue)}\n${session.memory.modelSummary}`,
        context: createToolContext(session),
      });
      const { plan, effects } = getPlanAndEffects(run);
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
        session.track = (effects.recommendedTrack ? findSleepAudioById(effects.recommendedTrack.id) : undefined)
          ?? (plan.backgroundTrackId ? findSleepAudioById(plan.backgroundTrackId) : undefined)
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
        ? { ...plan, audioMode: 'voice' as const, backgroundTrackId: session.track?.id, recommendation: plan.recommendation ?? getBackgroundRecommendationText(session.track!), autoplay: false }
        : shouldAttachAudio
          ? { ...plan, audioMode: requestsNarrationWithBackground(input.message) ? 'voice_with_background' as const : 'background' as const, backgroundTrackId: session.track?.id, autoplay: false }
          : { ...plan, audioMode: 'voice' as const, backgroundTrackId: undefined, recommendation: undefined };
      const responseText = shouldSuggest || shouldAttachAudio
        ? `${plan.reply}\n${getBackgroundRecommendationText(session.track!)}`
        : plan.reply;
      return responseFor(
        session,
        responseText,
        'pending',
        responsePlan,
        effects,
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
