import { Pool } from 'pg';
import type { MemoryStore } from './memory-store.js';
import { openMemoryStore } from './memory-store.js';
import type { MemoryStoreConfig } from './config.js';
import { createPostgresMemoryStore, type AsyncMemoryStore } from './postgres-memory-store.js';

export interface MemoryStoreFactory { forUser(userId: string): Promise<AsyncMemoryStore>; close(): Promise<void> }

function asyncLocal(store: MemoryStore): AsyncMemoryStore {
  return {
    startSession: async () => store.startSession(), endSession: async (id, input) => store.endSession(id, input), recordEvent: async (input) => store.recordEvent(input),
    listEvents: async (filter) => store.listEvents(filter), getProfile: async () => store.getProfile(), upsertMemory: async (input) => store.upsertMemory(input), listMemories: async () => store.listMemories(), clearAll: async () => store.clearAll(),
  };
}
export function createMemoryStoreFactory(config: MemoryStoreConfig): MemoryStoreFactory {
  if (config.kind === 'sqlite') return { forUser: async (userId) => asyncLocal(openMemoryStore(config.databasePath, userId)), close: async () => {} };
  const pool = new Pool({ connectionString: config.databaseUrl });
  return { forUser: (userId) => createPostgresMemoryStore(pool, userId), close: async () => { await pool.end(); } };
}
