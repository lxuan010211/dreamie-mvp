import { OpenAIProvider, Runner, setTracingDisabled } from '@openai/agents';
import dotenv from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { runBackgroundAudioConversation } from './background-audio-flow.js';
import { loadConfig, loadMiniMaxTtsConfig } from './config.js';
import { createDreamieAgent, parseSleepPlan } from './dreamie.js';
import { applyListeningFeedback } from './memory-policy.js';
import { openMemoryStoreOrNull } from './memory-store.js';
import { generateMiniMaxSpeech } from './minimax-tts.js';
import { playAudioOnMac } from './player.js';
import { buildRecommendationMemory } from './recommendation-context.js';

dotenv.config({ path: '.env.local', quiet: true });

async function main() {
  const argumentsFromTerminal = process.argv.slice(2);
  const shouldPlayAudio = !argumentsFromTerminal.includes('--no-play');
  const isBackgroundAudioMode = argumentsFromTerminal.includes('--background');
  const userMessage = argumentsFromTerminal
    .filter((argument) => argument !== '--no-play' && argument !== '--background')
    .join(' ')
    .trim();

  if (!userMessage) {
    throw new Error('请输入睡前状态，例如：--background "我脑子停不下来，想放松"');
  }

  const config = loadConfig(process.env);
  setTracingDisabled(true);

  const provider = new OpenAIProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    useResponses: false,
    strictFeatureValidation: true,
  });
  const runner = new Runner({ modelProvider: provider });

  try {
    const getSleepPlan = async (prompt: string) => {
      // The CLI keeps its original one-turn JSON flow; web sessions own the tool loop.
      const result = await runner.run(createDreamieAgent(config.model, []), prompt, { maxTurns: 1 });
      if (!result.finalOutput) {
        throw new Error('模型没有返回睡前方案，请再试一次。');
      }

      return parseSleepPlan(result.finalOutput);
    };

    if (isBackgroundAudioMode) {
      let memoryWarningShown = false;
      const showMemoryWarning = () => {
        if (!memoryWarningShown) {
          memoryWarningShown = true;
          console.log('提示：本次偏好未保存。');
        }
      };
      const memoryStore = openMemoryStoreOrNull(`${process.cwd()}/data/dreamie.db`, showMemoryWarning);
      const memorySessionId = memoryStore.startSession();
      const readline = createInterface({ input, output });
      try {
        await runBackgroundAudioConversation(userMessage, {
          getSleepPlan,
          ask: () => readline.question('你：'),
          say: (message) => console.log(message),
          playAudio: shouldPlayAudio
            ? playAudioOnMac
            : () => console.log('提示：已确认播放；--no-play 模式不会实际播放音频。'),
          memory: {
            getRecommendationMemory: () => {
              try {
                return buildRecommendationMemory(memoryStore);
              } catch {
                showMemoryWarning();
                return { modelSummary: '已知偏好：暂无稳定偏好。', excludedTrackIds: [], preferredKinds: [] };
              }
            },
            record: (event) => {
              try {
                applyListeningFeedback(memoryStore, { ...event, sessionId: memorySessionId });
              } catch {
                showMemoryWarning();
              }
            },
            complete: (session) => {
              try {
                memoryStore.endSession(memorySessionId, session);
              } catch {
                showMemoryWarning();
              }
            },
          },
        });
      } finally {
        readline.close();
      }
      return;
    }

    const ttsConfig = loadMiniMaxTtsConfig(process.env);
    const plan = await getSleepPlan(userMessage);
    const audioPath = await generateMiniMaxSpeech(
      plan.audioScript,
      ttsConfig,
      `${process.cwd()}/generated-audio`,
    );

    console.log(JSON.stringify({ ...plan, audioPath }, null, 2));
    console.log('提示：正在播放 AI 生成的语音。');

    if (shouldPlayAudio) {
      playAudioOnMac(audioPath);
    }
  } finally {
    await provider.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '发生了未知错误。';
  console.error(`Dreamie 暂时无法生成方案：${message}`);
  process.exitCode = 1;
});
