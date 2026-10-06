import { Agent, type Tool } from '@openai/agents';
import { z } from 'zod';

import { createDreamieTools, type DreamieToolContext, type DreamieToolEffects } from './dreamie-tools.js';

const optionalText = () => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value == null ? undefined : value,
  z.string().trim().min(1).optional(),
);

export const sleepPlanSchema = z.object({
  reply: z.string().trim().min(1).max(300),
  contentType: z.enum(['breathing', 'white_noise', 'sleep_story', 'meditation']),
  durationMinutes: z.number().int().min(5).max(60),
  mood: z.enum(['overthinking', 'tired', 'stressed', 'restless', 'calm', 'sad', 'unknown']),
  audioScript: z.string().trim().min(30).max(1200),
  audioMode: z.enum(['voice', 'background', 'voice_with_background']).default('voice'),
  backgroundTrackId: optionalText(),
  recommendation: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value == null ? undefined : value,
    z.string().trim().min(1).max(160).optional(),
  ),
  autoplay: z.boolean().default(true),
});

export type SleepPlan = z.infer<typeof sleepPlanSchema>;

const instructions = `
You are Dreamie, a gentle bedtime companion. The user is preparing for sleep. Your goal is to reduce their choices and help them ease into rest; do not promise sleep, diagnose emotions or sleep disorders, offer medical treatment, or recommend stimulating activities.

Infer the user's immediate sleep-related state. First respond with one warm, low-stimulation sentence. Then create one spoken sleep script, 80 to 240 Chinese characters, that can be read aloud slowly. It must be gentle, simple, and free of Markdown, lists, medical claims, frightening content, or pressure to fall asleep.

Use tools only when they genuinely help: ordinary conversation needs no tool; when the user explicitly asks for background sound, call recommend_background_audio before suggesting playback; for a story or meditation, call generate_tts; when the user explicitly says they like or dislike something, call save_sleep_memory. Never claim background audio is playing unless request_background_playback reports it is ready, and never bypass a pending confirmation.

Reply in Simplified Chinese and return only valid JSON with this exact shape after any needed tool calls:
{
  "reply": "a warm, calming sentence of at most 80 Chinese characters",
  "contentType": "breathing | white_noise | sleep_story | meditation",
  "durationMinutes": 5 to 60,
  "mood": "overthinking | tired | stressed | restless | calm | sad | unknown",
  "audioScript": "a short spoken sleep script",
  "audioMode": "voice | background | voice_with_background",
  "backgroundTrackId": "an optional safe audio catalog ID",
  "recommendation": "an optional natural, non-pushy suggestion",
  "autoplay": true or false
}
`;

export const dreamieMaxTurns = 4;

export interface DreamieRunnerOptions {
  context: DreamieToolContext;
  maxTurns: typeof dreamieMaxTurns;
}

export interface DreamieAgentRunInput {
  model: string;
  prompt: string;
  context: DreamieToolContext;
  tools?: Tool<DreamieToolContext>[];
  run(
    agent: Agent<DreamieToolContext>,
    prompt: string,
    options: DreamieRunnerOptions,
  ): Promise<{ finalOutput?: string | null }>;
}

export interface DreamieAgentRunResult {
  plan: SleepPlan;
  effects: DreamieToolEffects;
}

export function createDreamieAgent(
  model: string,
  tools: Tool<DreamieToolContext>[] = createDreamieTools(),
) {
  return new Agent<DreamieToolContext>({
    name: 'Dreamie',
    model,
    instructions,
    modelSettings: { temperature: 0.4 },
    tools,
  });
}

export async function runDreamieAgent(input: DreamieAgentRunInput): Promise<DreamieAgentRunResult> {
  const result = await input.run(
    createDreamieAgent(input.model, input.tools),
    input.prompt,
    { context: input.context, maxTurns: dreamieMaxTurns },
  );
  if (!result.finalOutput) throw new Error('Dreamie 暂时没有回应。');
  return { plan: parseSleepPlan(result.finalOutput), effects: input.context.effects };
}

export function parseSleepPlan(output: string): SleepPlan {
  return sleepPlanSchema.parse(JSON.parse(output));
}
