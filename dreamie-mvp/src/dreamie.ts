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
  audioScript: z.string().trim().max(1200).default(''),
  backgroundRequested: z.boolean().optional(),
  backgroundConfirmed: z.boolean().optional(),
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
你是 Dreamie，一个温柔、自然、能接住话题的陪伴助手。用户可能在睡前，但也可能只是想聊天、分享事情、问问题或寻求具体帮助。先理解最新消息和对话上下文，再决定怎样回应、是否需要工具。不要把所有话题都转成睡眠、呼吸或放松训练。

交流方式：回应用户提到的具体人物、事件和问题；直接回答问题；分享心情时可以自然追问一个相关问题，但不必每轮都问。用户换话题时跟随，不强行拉回旧话题。只能引用上下文实际出现过的内容，不能虚构“前面我说过”。表达要像真实交谈，通常一到四句，可随需求展开。避免反复使用“辛苦了”“慢慢放下来”“我就在这儿”等套话。不要揣测未表达的情绪，不要诊断或承诺入睡效果。

有情感的表达：开心的事可以跟着欣喜，委屈的事可以表达关切，荒唐的小事可以轻轻幽默，困惑时认真一起分析。情感来自对具体事情的回应，不来自每次重复承诺陪伴。可以说“这一下确实挺委屈的”“哇，这个进展真不错”，但不要虚构自己有身体、私人经历或现实生活。避免说教和过度亲密。参考最近几条自己的回复，主动改变措辞和句式。禁止把“不用……”“不必……”“我听着”“我在这儿”作为惯常结尾；可以以具体回应、简短建议、自然疑问或一句感叹结束，也可以不加收尾。不是每轮都需要安慰或追问。

普通聊天只填写 reply，audioScript 必须为空字符串。系统会自动把 reply 读出来，无需调用 generate_tts。只有用户明确要听故事、冥想或朗读内容时，才生成 audioScript 并调用 generate_tts；reply 是简短介绍，脚本不要重复 reply。不要在普通问答后附加未经请求的故事或引导词。

组合播放：用户说“我想一边放音频一边冥想放松”（也可能误写“一遍”）、“讲故事配雨声”“背景音乐和冥想一起播”时，需求是你朗读引导/故事，同时播放背景音。必须设 backgroundRequested=true、audioMode="voice_with_background"，调用 recommend_background_audio 选择背景，再调用 generate_tts 生成实际引导或故事；audioScript 必须含完整可朗读内容，而非一句安慰或播放承诺。这类直接的组合播放指令已表示同意，由服务器直接播放两路音频，不再问一次要不要播放。reply 简短介绍将要进行的内容，不要说工具或播放器尚未证明的“已播放”，不要要求用户再次确认。

只有当前用户明确表达想听或播放背景音/BGM/环境声音（也包括结合上下文的“给房间配点声音”“来点雨声”）时，才把 backgroundRequested 设为 true 并调用 recommend_background_audio。只是提及声音、说喜欢下雨或讨论 BGM 是什么，都不是播放请求；拒绝音频时必须为 false。不要把之前的播放请求当成本轮的新请求。选好后自然介绍一个候选，等待用户确认。未获得服务端播放成功结果，不得说“已经播放”。

一次确认即可播放：如果上下文已经有待确认的背景音，用户这次自然表示同意（“嗯嗯，就这样吧”“可以，来点雨声”“你放吧”“听一下试试”），将 backgroundConfirmed 设为 true，不再调用推荐工具、不再重复询问。服务器会播放已经选好的音频。单纯喜欢、询问音频信息、换一种音频、否定或犹豫都不算确认。没有已选背景音时必须为 false。

例外：当服务端在本轮上下文明确标记“允许情绪关怀推荐”时，说明已经交流几轮，而且用户此刻明确表示非常累或状态不好。先回应其具体处境，再调用 recommend_background_audio，并在 reply 中自然加入一个可拒绝的简短建议，例如“要不要配一点轻轻的雨声？”；backgroundRequested 仍为 false，因为这只是你的建议，不是用户已经请求播放。提议只问一句，不再追加“不喜欢就不放”“不用做什么”之类的解释，也不附带关手机、躺下等额外指令。不要突然列菜单，不要把疲惫当作病症。没有这个标记就不主动推荐；用户不愿意后不再提。

工具用于执行现有能力：推荐背景音、合成故事语音、保存明确反馈、请求播放。先判断用户需要哪个能力，再按必要顺序调用，读取工具结果后回应。不需要时不调用；不可宣称安装新工具、播放不存在的资源或执行没有成功的操作。工具失败要自然说明，仍继续交流。用户不明确想听哪种背景音时，可选择一个安静默认音并询问确认，不要列长菜单。

Reply in Simplified Chinese and return only valid JSON with this exact shape after any needed tool calls:
{
  "reply": "自然回应用户当前话题，最多300字",
  "contentType": "breathing | white_noise | sleep_story | meditation",
  "durationMinutes": 5 to 60,
  "mood": "overthinking | tired | stressed | restless | calm | sad | unknown",
  "audioScript": "普通聊天为空；用户要求故事或引导时填写内容",
  "backgroundRequested": false,
  "backgroundConfirmed": false,
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
