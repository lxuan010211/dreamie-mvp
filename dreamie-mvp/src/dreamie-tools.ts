import { tool, type FunctionTool, type RunContext } from '@openai/agents';
import { z } from 'zod';

import type { SleepAudioKind, SleepAudioTrack } from './audio-catalog.js';
import { recommendBackgroundAudio } from './background-audio-session.js';
import type { MiniMaxTtsConfig } from './config.js';
import type { SleepPlan } from './dreamie.js';
import { synthesizeMiniMaxSpeech } from './minimax-tts.js';

export interface DreamieToolTrack {
  id: string;
  title: string;
  kind: SleepAudioKind;
}

export interface DreamieToolEffects {
  recommendedTrack?: DreamieToolTrack;
  playback?: {
    trackId: string;
    status: 'pending_confirmation' | 'playing';
  };
  ttsDataUrl?: string;
  toolErrors?: string[];
}

export interface DreamieToolContext {
  userId: string;
  sessionId: string;
  mood: SleepPlan['mood'];
  preferredKinds: SleepAudioKind[];
  excludedTrackIds: string[];
  playbackAllowed: boolean;
  allowedVoiceIds: string[];
  allowedSpeeds: number[];
  effects: DreamieToolEffects;
  recommendTrack(input: {
    mood: SleepPlan['mood'];
    preferredKinds: SleepAudioKind[];
    excludedTrackIds: string[];
    intent: 'background' | 'story' | 'meditation';
  }): Promise<DreamieToolTrack>;
  synthesizeSpeech(input: {
    text: string;
    voiceId: string;
    speed: number;
  }): Promise<string>;
  saveMemory(input: {
    event: 'liked' | 'disliked';
    target: 'background' | 'voice' | 'content';
  }): Promise<void>;
}

export interface CreateDreamieToolContextOptions {
  userId: string;
  sessionId: string;
  mood: SleepPlan['mood'];
  preferredKinds: SleepAudioKind[];
  excludedTrackIds: string[];
  playbackAllowed: boolean;
  ttsConfig: MiniMaxTtsConfig;
  saveMemory: DreamieToolContext['saveMemory'];
  fetchImpl?: typeof fetch;
}

const recommendationInput = z.object({
  intent: z.enum(['background', 'story', 'meditation']),
});

const ttsInput = z.object({
  text: z.string().trim().min(1).max(1200),
  voiceId: z.string().trim().min(1).max(80),
  speed: z.number().min(0.5).max(1.5),
});

const memoryInput = z.object({
  event: z.enum(['liked', 'disliked']),
  target: z.enum(['background', 'voice', 'content']),
});

const playbackInput = z.object({
  trackId: z.string().trim().min(1).max(80),
});

function getContext(runContext: RunContext<DreamieToolContext> | undefined): DreamieToolContext {
  if (!runContext?.context) throw new Error('Dreamie tools require a run context.');
  return runContext.context;
}

function addToolError(context: DreamieToolContext, message: string): void {
  context.effects.toolErrors ??= [];
  context.effects.toolErrors.push(message);
}

function toToolTrack(track: SleepAudioTrack): DreamieToolTrack {
  return { id: track.id, title: track.title, kind: track.kind };
}

export function createDreamieToolContext(options: CreateDreamieToolContextOptions): DreamieToolContext {
  return {
    userId: options.userId,
    sessionId: options.sessionId,
    mood: options.mood,
    preferredKinds: options.preferredKinds,
    excludedTrackIds: options.excludedTrackIds,
    playbackAllowed: options.playbackAllowed,
    allowedVoiceIds: [options.ttsConfig.voiceId],
    allowedSpeeds: [options.ttsConfig.speed],
    effects: {},
    recommendTrack: async () => {
      const track = recommendBackgroundAudio(
        options.mood,
        options.excludedTrackIds,
        options.preferredKinds,
      );
      if (options.excludedTrackIds.includes(track.id)) {
        throw new Error('No eligible background track remains.');
      }
      return toToolTrack(track);
    },
    synthesizeSpeech: ({ text, voiceId, speed }) => synthesizeMiniMaxSpeech(
      text,
      { ...options.ttsConfig, voiceId, speed },
      options.fetchImpl,
    ),
    saveMemory: options.saveMemory,
  };
}

export function createDreamieTools(): FunctionTool<DreamieToolContext, any>[] {
  return [
    tool<typeof recommendationInput, DreamieToolContext>({
      name: 'recommend_background_audio',
      description: 'Choose one safe local background sound when the user explicitly wants ambience. This only recommends; it never plays audio.',
      parameters: recommendationInput,
      strict: true,
      execute: async (input, runContext) => {
        const context = getContext(runContext);
        try {
          const track = await context.recommendTrack({
            mood: context.mood,
            preferredKinds: context.preferredKinds,
            excludedTrackIds: context.excludedTrackIds,
            intent: input.intent,
          });
          context.effects.recommendedTrack = track;
          return {
            status: 'recommended',
            trackId: track.id,
            title: track.title,
            kind: track.kind,
            recommendation: `可以试试「${track.title}」。如果你愿意，我再为你播放。`,
          };
        } catch {
          addToolError(context, '背景音推荐暂时不可用。');
          return { status: 'unavailable', message: '背景音推荐暂时不可用。' };
        }
      },
    }),
    tool<typeof ttsInput, DreamieToolContext>({
      name: 'generate_tts',
      description: 'Generate a short, gentle spoken MP3 for a bedtime story or meditation. Never include audio bytes in your reply.',
      parameters: ttsInput,
      strict: true,
      execute: async (input, runContext) => {
        const context = getContext(runContext);
        if (!context.allowedVoiceIds.includes(input.voiceId)) throw new Error('Requested voice is not allowed.');
        if (!context.allowedSpeeds.includes(input.speed)) throw new Error('Requested speech speed is not allowed.');
        try {
          context.effects.ttsDataUrl = await context.synthesizeSpeech(input);
          return { status: 'ready', format: 'mp3' };
        } catch {
          addToolError(context, '语音暂时不可用。');
          return { status: 'unavailable', message: '语音暂时不可用。' };
        }
      },
    }),
    tool<typeof memoryInput, DreamieToolContext>({
      name: 'save_sleep_memory',
      description: 'Save explicit user feedback about what they liked or disliked. Do not infer feedback that was not expressed.',
      parameters: memoryInput,
      strict: true,
      execute: async (input, runContext) => {
        const context = getContext(runContext);
        try {
          await context.saveMemory(input);
          return { status: 'saved' };
        } catch {
          addToolError(context, '偏好暂时无法保存。');
          return { status: 'unavailable', message: '偏好暂时无法保存。' };
        }
      },
    }),
    tool<typeof playbackInput, DreamieToolContext>({
      name: 'request_background_playback',
      description: 'Request playback for the background sound that the server already selected. Never use this before user confirmation.',
      parameters: playbackInput,
      strict: true,
      execute: async (input, runContext) => {
        const context = getContext(runContext);
        if (context.effects.recommendedTrack?.id !== input.trackId) {
          throw new Error('Playback may only use the server-selected track.');
        }
        if (!context.playbackAllowed) {
          context.effects.playback = { trackId: input.trackId, status: 'pending_confirmation' };
          return {
            status: 'pending_confirmation',
            trackId: input.trackId,
            message: '等待用户确认后再播放。',
          };
        }
        context.effects.playback = { trackId: input.trackId, status: 'playing' };
        return {
          status: 'playing',
          trackId: input.trackId,
          message: '已准备好由浏览器播放。',
        };
      },
    }),
  ];
}
