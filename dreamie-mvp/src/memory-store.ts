import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type ListeningEventType = 'recommended' | 'played' | 'changed' | 'liked' | 'disliked';
export type MemoryPolarity = 'positive' | 'negative';
export type MemorySource = 'explicit' | 'behavioral';

export interface UserProfile {
  userId: 'local-user';
  timezone: string;
  voiceId: string | null;
  voiceSpeed: number | null;
}

export interface ListeningEvent {
  id: string;
  sessionId: string;
  trackId: string;
  eventType: ListeningEventType;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  polarity: MemoryPolarity;
  confidence: number;
  evidenceCount: number;
  source: MemorySource;
  lastConfirmedAt: string;
}

export interface MemoryStore {
  startSession(): string;
  endSession(sessionId: string, input: { mood: string; summary: string }): void;
  recordEvent(input: { sessionId: string; trackId: string; eventType: ListeningEventType }): void;
  listEvents(filter: { trackId?: string; since?: string }): ListeningEvent[];
  getProfile(): UserProfile;
  upsertMemory(input: Omit<MemoryItem, 'id' | 'lastConfirmedAt'>): void;
  listMemories(): MemoryItem[];
  clearAll(): void;
}

const localUserId = 'local-user' as const;
const defaultProfile: UserProfile = {
  userId: localUserId,
  timezone: 'Asia/Shanghai',
  voiceId: null,
  voiceSpeed: null,
};

export function openMemoryStore(databasePath: string): MemoryStore {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  initializeDatabase(database);
  return new SqliteMemoryStore(database);
}

export function openMemoryStoreOrNull(databasePath: string, onUnavailable: () => void): MemoryStore {
  try {
    return openMemoryStore(databasePath);
  } catch {
    onUnavailable();
    return new NullMemoryStore();
  }
}

class SqliteMemoryStore implements MemoryStore {
  constructor(private readonly database: DatabaseSync) {}

  startSession(): string {
    const id = randomUUID();
    this.database
      .prepare('INSERT INTO sessions (id, user_id, started_at) VALUES (?, ?, ?)')
      .run(id, localUserId, now());
    return id;
  }

  endSession(sessionId: string, input: { mood: string; summary: string }): void {
    this.database
      .prepare('UPDATE sessions SET ended_at = ?, mood = ?, summary = ? WHERE id = ?')
      .run(now(), input.mood, input.summary.slice(0, 300), sessionId);
  }

  recordEvent(input: { sessionId: string; trackId: string; eventType: ListeningEventType }): void {
    this.database
      .prepare(
        'INSERT INTO listening_events (id, session_id, user_id, track_id, event_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), input.sessionId, localUserId, input.trackId, input.eventType, now());
  }

  listEvents(filter: { trackId?: string; since?: string }): ListeningEvent[] {
    let statement = 'SELECT id, session_id, track_id, event_type, created_at FROM listening_events WHERE user_id = ?';
    const parameters: string[] = [localUserId];

    if (filter.trackId) {
      statement += ' AND track_id = ?';
      parameters.push(filter.trackId);
    }
    if (filter.since) {
      statement += ' AND created_at >= ?';
      parameters.push(filter.since);
    }
    statement += ' ORDER BY created_at ASC';

    return this.database.prepare(statement).all(...parameters).map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      trackId: String(row.track_id),
      eventType: row.event_type as ListeningEventType,
      createdAt: String(row.created_at),
    }));
  }

  getProfile(): UserProfile {
    const row = this.database
      .prepare('SELECT user_id, timezone, voice_id, voice_speed FROM user_profile WHERE user_id = ?')
      .get(localUserId);

    if (!row) {
      return defaultProfile;
    }

    return {
      userId: localUserId,
      timezone: String(row.timezone),
      voiceId: row.voice_id === null ? null : String(row.voice_id),
      voiceSpeed: row.voice_speed === null ? null : Number(row.voice_speed),
    };
  }

  upsertMemory(input: Omit<MemoryItem, 'id' | 'lastConfirmedAt'>): void {
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO memory_items (
          id, user_id, memory_key, value, polarity, confidence, evidence_count, source, last_confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, memory_key, value) DO UPDATE SET
          polarity = excluded.polarity,
          confidence = excluded.confidence,
          evidence_count = excluded.evidence_count,
          source = excluded.source,
          last_confirmed_at = excluded.last_confirmed_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        localUserId,
        input.key,
        input.value,
        input.polarity,
        input.confidence,
        input.evidenceCount,
        input.source,
        timestamp,
        timestamp,
        timestamp,
      );
  }

  listMemories(): MemoryItem[] {
    return this.database
      .prepare(
        'SELECT id, memory_key, value, polarity, confidence, evidence_count, source, last_confirmed_at FROM memory_items WHERE user_id = ? ORDER BY updated_at ASC',
      )
      .all(localUserId)
      .map((row) => ({
        id: String(row.id),
        key: String(row.memory_key),
        value: String(row.value),
        polarity: row.polarity as MemoryPolarity,
        confidence: Number(row.confidence),
        evidenceCount: Number(row.evidence_count),
        source: row.source as MemorySource,
        lastConfirmedAt: String(row.last_confirmed_at),
      }));
  }

  clearAll(): void {
    this.database.exec('DELETE FROM listening_events; DELETE FROM memory_items; DELETE FROM sessions;');
  }
}

class NullMemoryStore implements MemoryStore {
  startSession(): string {
    return 'local';
  }

  endSession(): void {}

  recordEvent(): void {}

  listEvents(): ListeningEvent[] {
    return [];
  }

  getProfile(): UserProfile {
    return defaultProfile;
  }

  upsertMemory(): void {}

  listMemories(): MemoryItem[] {
    return [];
  }

  clearAll(): void {}
}

function initializeDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      user_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      voice_id TEXT,
      voice_speed REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      mood TEXT,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS listening_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      memory_key TEXT NOT NULL,
      value TEXT NOT NULL,
      polarity TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_count INTEGER NOT NULL,
      source TEXT NOT NULL,
      last_confirmed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, memory_key, value)
    );
  `);

  const timestamp = now();
  database
    .prepare(
      'INSERT OR IGNORE INTO user_profile (user_id, timezone, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(localUserId, defaultProfile.timezone, timestamp, timestamp);
}

function now(): string {
  return new Date().toISOString();
}
