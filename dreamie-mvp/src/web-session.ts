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
} from './background-audio-session.js';
import type { DreamieAgentRunResult, SleepPlan } from './dreamie.js';
import type { DreamieToolContext, DreamieToolEffects } from './dreamie-tools.js';
import { profileInstructions, type CompanionProfile } from './companion-profile.js';
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
  voiceId?: string;
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
    profile?: CompanionProfile;
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
  userTurns: number;
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
      userTurns: 0,
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
    session.dialogue = addAssistantMessage(session.dialogue, reply);
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

  function createToolContext(session: WebSession, profile?: CompanionProfile): DreamieToolContext | undefined {
    return dependencies.createToolContext?.({
      voiceId: profile?.voiceId,
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
      session.userTurns += 1;
      session.dialogue = addUserMessage(session.dialogue, input.message);
      if (/(不要|不想|不用|别).*(背景音|音乐|bgm|雨声)|只想聊天|只陪.*聊/i.test(input.message)) {
        session.dialogue = markRecommendationDeclined(session.dialogue);
      }
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
          session.dialogue = markRecommendationDeclined(session.dialogue);
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

      const canSuggest = session.userTurns >= 3
        && !session.recommendationShown
        && !session.dialogue.recommendationCooldown
        && /(非常累|很累|好累|太累|特别累|累坏|累死|疲惫|状态.{0,3}(不好|很差|糟)|心情.{0,3}(不好|很差|低落)|难受|撑不住|压力.{0,3}(大|重)|很焦虑|睡不着|停不下来)/.test(input.message)
        && !/(不累|不太累|状态很好|心情很好)/.test(input.message);
      const run = await dependencies.getSleepPlan({
        prompt: `${profileInstructions(input.profile)}\n${getConversationPrompt(session.dialogue)}\n${session.memory.modelSummary}\n当前已选背景音：${session.track?.title ?? '无'}。请只判断最新用户消息的需求；之前的音频请求不代表现在还要推荐。\n${canSuggest ? '允许情绪关怀推荐：请结合当前用户的疲惫或低落，自然推荐一个可拒绝的背景音，等待确认。' : '本轮不允许主动推荐背景音；仅响应用户明确的播放需求。'}`,
        context: createToolContext(session, input.profile),
      });
      const { plan, effects } = getPlanAndEffects(run);
      if (session.track && plan.backgroundConfirmed === true && !requestsNarrationWithBackground(input.message)
        && !/(不要|不用|不想|先别|别放|不放|换一个|换一种|等一下|等会)/.test(input.message)) {
        await record(session, session.track, 'played');
        return responseFor(session, `好，给你放「${session.track.title}」。`, 'playing', {
          audioMode: 'background', backgroundTrackId: session.track.id, autoplay: true,
        });
      }
      session.mood = plan.mood;
      const explicitBackground = requestsBackgroundAudio(input.message);
      // Interpret implicit wording through the model's explicit intent field;
      // mood and stable preferences alone never trigger a recommendation.
      const shouldAttachAudio = explicitBackground || plan.backgroundRequested === true;
      const mixedPlayback = shouldAttachAudio
        && (requestsNarrationWithBackground(input.message) || plan.audioMode === 'voice_with_background');
      const shouldSuggest = !shouldAttachAudio && canSuggest
        && ['tired', 'stressed', 'sad', 'restless', 'overthinking'].includes(plan.mood);
      if (shouldAttachAudio || shouldSuggest) {
        session.track = (effects.recommendedTrack ? findSleepAudioById(effects.recommendedTrack.id) : undefined)
          ?? (plan.backgroundTrackId ? findSleepAudioById(plan.backgroundTrackId) : undefined)
          ?? recommendBackgroundAudio(
            plan.mood,
            [...session.memory.excludedTrackIds, ...session.excluded],
            session.memory.preferredKinds,
          );
        await record(session, session.track, 'recommended');
        if (mixedPlayback) await record(session, session.track, 'played');
        session.recommendationShown = true;
      } else {
        session.track = undefined;
      }
      const responsePlan = shouldAttachAudio
          ? { ...plan, audioMode: mixedPlayback ? 'voice_with_background' as const : 'background' as const, backgroundTrackId: session.track?.id, autoplay: mixedPlayback }
          : shouldSuggest
            ? { ...plan, audioMode: 'voice' as const, backgroundTrackId: session.track?.id, autoplay: false }
          : { ...plan, audioMode: 'voice' as const, backgroundTrackId: undefined, recommendation: undefined, autoplay: true };
      const hasNaturalSuggestion = shouldSuggest && /(雨声|海浪|背景音|轻音乐|bgm|音乐|壁炉)/i.test(plan.reply);
      const responseText = !mixedPlayback && (shouldAttachAudio || shouldSuggest) && !hasNaturalSuggestion && !plan.reply.includes(session.track!.title)
        ? `${plan.reply}\n${getBackgroundRecommendationText(session.track!)}`
        : plan.reply;
      return responseFor(
        session,
        responseText,
        mixedPlayback ? 'playing' : 'pending',
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
