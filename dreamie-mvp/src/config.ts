import { z } from 'zod';

const environmentSchema = z.object({
  DEEPSEEK_API_KEY: z.string().trim().min(1, 'DEEPSEEK_API_KEY is required'),
  DEEPSEEK_MODEL: z.string().trim().min(1, 'DEEPSEEK_MODEL is required'),
});

const miniMaxTtsEnvironmentSchema = z.object({
  MINIMAX_API_KEY: z.string().trim().min(1, 'MINIMAX_API_KEY is required'),
  MINIMAX_TTS_MODEL: z.string().trim().min(1, 'MINIMAX_TTS_MODEL is required'),
  MINIMAX_TTS_SPEED: z.coerce.number().positive('MINIMAX_TTS_SPEED must be positive'),
  MINIMAX_TTS_VOICE_ID: z.string().trim().min(1, 'MINIMAX_TTS_VOICE_ID is required'),
});

const dashScopeAsrEnvironmentSchema = z.object({
  DASHSCOPE_API_KEY: z.string().trim().min(1, 'DASHSCOPE_API_KEY is required'),
  DASHSCOPE_ASR_MODEL: z.string().trim().min(1).default('fun-asr-flash-2026-06-15'),
});

export type DreamieConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export type MiniMaxTtsConfig = {
  apiKey: string;
  model: string;
  speed: number;
  voiceId: string;
};

export type DashScopeAsrConfig = {
  apiKey: string;
  model: string;
};

export type MemoryStoreConfig =
  | { kind: 'sqlite'; databasePath: string }
  | {
      kind: 'postgres';
      connection:
        | { kind: 'connection-string'; databaseUrl: string }
        | {
            kind: 'parameters';
            host: string;
            port: number;
            database: string;
            user: string;
            password: string;
          };
    };

export function loadConfig(environment: Record<string, string | undefined>): DreamieConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    apiKey: parsed.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com',
    model: parsed.DEEPSEEK_MODEL,
  };
}

export function loadMiniMaxTtsConfig(
  environment: Record<string, string | undefined>,
): MiniMaxTtsConfig {
  const parsed = miniMaxTtsEnvironmentSchema.parse(environment);

  return {
    apiKey: parsed.MINIMAX_API_KEY,
    model: parsed.MINIMAX_TTS_MODEL,
    speed: parsed.MINIMAX_TTS_SPEED,
    voiceId: parsed.MINIMAX_TTS_VOICE_ID,
  };
}

export function loadDashScopeAsrConfig(
  environment: Record<string, string | undefined>,
): DashScopeAsrConfig {
  const parsed = dashScopeAsrEnvironmentSchema.parse(environment);

  return { apiKey: parsed.DASHSCOPE_API_KEY, model: parsed.DASHSCOPE_ASR_MODEL };
}

export function loadMemoryStoreConfig(environment: Record<string, string | undefined>): MemoryStoreConfig {
  const kind = environment.MEMORY_STORE?.trim() || 'sqlite';
  if (kind === 'sqlite') return { kind, databasePath: 'data/dreamie.db' };
  if (kind === 'postgres') {
    const databaseUrl = environment.DATABASE_URL?.trim();
    if (databaseUrl) {
      return { kind, connection: { kind: 'connection-string', databaseUrl } };
    }

    const host = environment.PGHOST?.trim();
    const database = environment.PGDATABASE?.trim();
    const user = environment.PGUSER?.trim();
    const password = environment.PGPASSWORD;
    const port = Number(environment.PGPORT?.trim() || '5432');
    if (!host || !database || !user || !password || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error('DATABASE_URL or PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD are required');
    }
    return {
      kind,
      connection: { kind: 'parameters', host, port, database, user, password },
    };
  }
  throw new Error('MEMORY_STORE must be sqlite or postgres');
}
