import { listDefaultSleepAudio, type SleepAudioTrack, type SleepMood } from './audio-catalog.js';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BackgroundAudioSession {
  turns: readonly ConversationTurn[];
  recommendationCooldown: boolean;
}

export type BackgroundAudioAction = 'play' | 'change' | 'like' | 'dislike' | 'continue';

const maxStoredTurns = 6;

export function createBackgroundAudioSession(): BackgroundAudioSession {
  return { turns: [], recommendationCooldown: false };
}

export function addUserMessage(session: BackgroundAudioSession, content: string): BackgroundAudioSession {
  return addTurn(session, 'user', content);
}

export function addAssistantMessage(session: BackgroundAudioSession, content: string): BackgroundAudioSession {
  return addTurn(session, 'assistant', content);
}

function addTurn(
  session: BackgroundAudioSession,
  role: ConversationTurn['role'],
  content: string,
): BackgroundAudioSession {
  const turns = [...session.turns, { role, content: content.trim() }].filter((turn) => turn.content.length > 0);
  return { ...session, turns: turns.slice(-maxStoredTurns) };
}

export function markRecommendationDeclined(session: BackgroundAudioSession): BackgroundAudioSession {
  return { ...session, recommendationCooldown: true };
}

export function shouldSoftRecommendBackgroundAudio(
  mood: SleepMood | 'unknown',
  preferredKinds: readonly SleepAudioTrack['kind'][],
  alreadySuggested: boolean,
  userMessage: string,
): boolean {
  if (alreadySuggested || preferredKinds.length === 0) return false;
  if (!['overthinking', 'tired', 'stressed', 'restless'].includes(mood)) return false;
  return /(累|疲惫|压力|焦虑|停不下来|睡不着|失眠|烦)/.test(userMessage);
}

export function requestsBackgroundAudio(input: string): boolean {
  const normalized = input.replace(/\s/g, '');
  const ambience = '雨声|白噪音|海浪|海风|壁炉|背景音|背景音乐|bgm|轻音乐|氛围音|环境音';
  if (new RegExp(`(不要|别|不想|不用|无需|不需要|停止|关闭).{0,4}(${ambience})`, 'i').test(normalized)) return false;
  return new RegExp(`(${ambience})`, 'i').test(normalized)
    && /(请|想|要|放|播放|听|来点|配|伴着|陪我)/.test(normalized);
}

export function requestsNarrationWithBackground(input: string): boolean {
  return /(故事|冥想|引导|讲|读|播客|文章|内容)/.test(input);
}

export function getConversationPrompt(session: BackgroundAudioSession): string {
  const dialogue = session.turns
    .map((turn) => `${turn.role === 'user' ? '用户' : 'Dreamie'}：${turn.content}`)
    .join('\n');

  return `这是本轮睡前对话，请根据完整上下文判断用户当下状态：\n${dialogue}`;
}

export function recommendBackgroundAudio(
  mood: SleepMood | 'unknown',
  excludedTrackIds: readonly string[],
  preferredKinds: readonly SleepAudioTrack['kind'][] = [],
): SleepAudioTrack {
  const tracks = listDefaultSleepAudio();
  const availableTracks = tracks.filter((track) => !excludedTrackIds.includes(track.id));
  const candidates = availableTracks.length > 0 ? availableTracks : tracks;

  return [...candidates].sort((left, right) => {
    const leftScore = recommendationScore(left, mood, preferredKinds);
    const rightScore = recommendationScore(right, mood, preferredKinds);
    return rightScore - leftScore;
  })[0]!;
}

export function getBackgroundAudioAction(input: string): BackgroundAudioAction {
  const normalized = input.trim().toLowerCase().replace(/[，。！？,.!?]/g, '').replace(/\s+/g, '');

  if (/^(好|好的|好啊|可以|可以的|播放|开始|行|嗯|yes|y)(播放吧|放吧|开始吧|听吧)?$/.test(normalized)
    || /^(就这个|这个可以|我想听这个|来吧)$/.test(normalized)) {
    return 'play';
  }

  if (/(换一个|换首|换一段|换|其他|别的)/.test(normalized)) {
    return 'change';
  }

  if (/^(喜欢|我喜欢)$/.test(normalized)) {
    return 'like';
  }

  if (/(不喜欢|不要再推荐)/.test(normalized)) {
    return 'dislike';
  }

  return 'continue';
}

function recommendationScore(
  track: SleepAudioTrack,
  mood: SleepMood | 'unknown',
  preferredKinds: readonly SleepAudioTrack['kind'][],
): number {
  return Number(preferredKinds.includes(track.kind)) * 2 + Number(track.suitableMoods.includes(mood as SleepMood));
}

export function getBackgroundRecommendationText(track: SleepAudioTrack): string {
  return `我推荐「${track.title}」，可以陪你放松大约 ${track.defaultDurationMinutes} 分钟。要播放吗？`;
}
