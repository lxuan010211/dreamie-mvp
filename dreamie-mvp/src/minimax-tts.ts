import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MiniMaxTtsConfig } from './config.js';

export const miniMaxSpeechEndpoint = 'https://api.minimaxi.com/v1/t2a_v2';

export function buildMiniMaxSpeechRequest(text: string, config: MiniMaxTtsConfig) {
  return {
    model: config.model,
    text,
    stream: false,
    voice_setting: {
      voice_id: config.voiceId,
      speed: config.speed,
      vol: 1,
      pitch: 0,
    },
    language_boost: 'Chinese',
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
    output_format: 'hex',
  };
}

export function decodeMiniMaxSpeechResponse(payload: unknown): Uint8Array {
  const response = payload as {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { audio?: string };
  };

  if (response.base_resp?.status_code !== 0) {
    throw new Error(response.base_resp?.status_msg ?? 'MiniMax TTS request failed');
  }

  const hexAudio = response.data?.audio;

  if (!hexAudio || !/^(?:[0-9a-fA-F]{2})+$/.test(hexAudio)) {
    throw new Error('MiniMax did not return valid MP3 audio data');
  }

  return Buffer.from(hexAudio, 'hex');
}

export async function generateMiniMaxSpeech(
  text: string,
  config: MiniMaxTtsConfig,
  outputDirectory: string,
): Promise<string> {
  const response = await fetch(miniMaxSpeechEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildMiniMaxSpeechRequest(text, config)),
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message = (payload as { base_resp?: { status_msg?: string } }).base_resp?.status_msg;
    throw new Error(message ?? `MiniMax TTS request failed with HTTP ${response.status}`);
  }

  const audio = decodeMiniMaxSpeechResponse(payload);
  await mkdir(outputDirectory, { recursive: true });

  const outputPath = path.join(outputDirectory, `dreamie-${Date.now()}.mp3`);
  await writeFile(outputPath, audio);

  return outputPath;
}
