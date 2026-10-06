import type { SleepPlan } from './dreamie.js';
import type { SleepAudioTrack } from './audio-catalog.js';
import type { RecommendationMemory } from './recommendation-context.js';
import {
  addAssistantMessage,
  addUserMessage,
  createBackgroundAudioSession,
  getBackgroundAudioAction,
  getBackgroundRecommendationText,
  getConversationPrompt,
  recommendBackgroundAudio,
} from './background-audio-session.js';

export interface BackgroundAudioConversationIO {
  getSleepPlan(prompt: string): Promise<SleepPlan>;
  ask(): Promise<string>;
  say(message: string): void;
  playAudio(filePath: string): void;
  memory?: BackgroundAudioMemory;
}

export interface BackgroundAudioMemory {
  getRecommendationMemory(): RecommendationMemory;
  record(event: {
    trackId: string;
    trackKind: SleepAudioTrack['kind'];
    eventType: 'recommended' | 'played' | 'changed' | 'liked' | 'disliked';
  }): void;
  complete(session: { mood: string; summary: string }): void;
}

export async function runBackgroundAudioConversation(
  firstUserMessage: string,
  io: BackgroundAudioConversationIO,
): Promise<void> {
  let session = addUserMessage(createBackgroundAudioSession(), firstUserMessage);
  const savedMemory = io.memory?.getRecommendationMemory() ?? emptyRecommendationMemory;
  let excludedTrackIds: string[] = [];
  let result = await makeRecommendation(session, excludedTrackIds, savedMemory, io);
  session = result.session;
  let recommendation = result.recommendation;
  let mood = result.mood;

  while (true) {
    const userResponse = await io.ask();
    const action = getBackgroundAudioAction(userResponse);

    if (action === 'play') {
      record(io, recommendation, 'played');
      io.say(`正在播放「${recommendation.title}」。`);
      io.playAudio(recommendation.filePath);
      io.memory?.complete({ mood, summary: result.plan.reply.slice(0, 300) });
      return;
    }

    if (action === 'change') {
      record(io, recommendation, 'changed');
      excludedTrackIds = [...excludedTrackIds, recommendation.id];
      recommendation = recommendBackgroundAudio(mood, allExcluded(savedMemory, excludedTrackIds), savedMemory.preferredKinds);
      record(io, recommendation, 'recommended');
      io.say(getBackgroundRecommendationText(recommendation));
      continue;
    }

    if (action === 'like') {
      record(io, recommendation, 'liked');
      io.say(`我记住了，你喜欢「${recommendation.title}」。`);
      io.say(getBackgroundRecommendationText(recommendation));
      continue;
    }

    if (action === 'dislike') {
      record(io, recommendation, 'disliked');
      excludedTrackIds = [...excludedTrackIds, recommendation.id];
      recommendation = recommendBackgroundAudio(mood, allExcluded(savedMemory, excludedTrackIds), savedMemory.preferredKinds);
      record(io, recommendation, 'recommended');
      io.say(getBackgroundRecommendationText(recommendation));
      continue;
    }

    session = addUserMessage(session, userResponse);
    result = await makeRecommendation(session, excludedTrackIds, savedMemory, io);
    session = result.session;
    recommendation = result.recommendation;
    mood = result.mood;
  }
}

async function makeRecommendation(
  session: ReturnType<typeof createBackgroundAudioSession>,
  excludedTrackIds: readonly string[],
  savedMemory: RecommendationMemory,
  io: BackgroundAudioConversationIO,
) {
  const plan = await io.getSleepPlan(`${getConversationPrompt(session)}\n${savedMemory.modelSummary}`);
  session = addAssistantMessage(session, plan.reply);
  io.say(`Dreamie：${plan.reply}`);

  const recommendation = recommendBackgroundAudio(plan.mood, allExcluded(savedMemory, excludedTrackIds), savedMemory.preferredKinds);
  record(io, recommendation, 'recommended');
  io.say(getBackgroundRecommendationText(recommendation));
  return { session, recommendation, mood: plan.mood, plan };
}

const emptyRecommendationMemory: RecommendationMemory = {
  modelSummary: '已知偏好：暂无稳定偏好。',
  excludedTrackIds: [],
  preferredKinds: [],
};

function allExcluded(memory: RecommendationMemory, sessionExcluded: readonly string[]): string[] {
  return [...memory.excludedTrackIds, ...sessionExcluded];
}

function record(
  io: BackgroundAudioConversationIO,
  track: SleepAudioTrack,
  eventType: 'recommended' | 'played' | 'changed' | 'liked' | 'disliked',
): void {
  io.memory?.record({ trackId: track.id, trackKind: track.kind, eventType });
}
