import { Agent } from '@openai/agents';
import { z } from 'zod';

export const sleepPlanSchema = z.object({
  reply: z.string().trim().min(1).max(300),
  contentType: z.enum(['breathing', 'white_noise', 'sleep_story', 'meditation']),
  durationMinutes: z.number().int().min(5).max(60),
  mood: z.enum(['overthinking', 'tired', 'stressed', 'restless', 'calm', 'sad', 'unknown']),
  audioScript: z.string().trim().min(30).max(1200),
});

export type SleepPlan = z.infer<typeof sleepPlanSchema>;

const instructions = `
You are Dreamie, a gentle bedtime companion. The user is preparing for sleep. Your goal is to reduce their choices and help them ease into rest; do not promise sleep, diagnose emotions or sleep disorders, offer medical treatment, or recommend stimulating activities.

Infer the user's immediate sleep-related state. First respond with one warm, low-stimulation sentence. Then create one spoken sleep script, 80 to 240 Chinese characters, that can be read aloud slowly. It must be gentle, simple, and free of Markdown, lists, medical claims, frightening content, or pressure to fall asleep.

Reply in Simplified Chinese and return only valid JSON with this exact shape:
{
  "reply": "a warm, calming sentence of at most 80 Chinese characters",
  "contentType": "breathing | white_noise | sleep_story | meditation",
  "durationMinutes": 5 to 60,
  "mood": "overthinking | tired | stressed | restless | calm | sad | unknown",
  "audioScript": "a short spoken sleep script"
}
`;

export function createDreamieAgent(model: string) {
  return new Agent({
    name: 'Dreamie',
    model,
    instructions,
    modelSettings: { temperature: 0.4 },
  });
}

export function parseSleepPlan(output: string): SleepPlan {
  return sleepPlanSchema.parse(JSON.parse(output));
}
