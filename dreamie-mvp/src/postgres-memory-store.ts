import { randomUUID } from 'node:crypto';
import type { ListeningEvent, ListeningEventType, MemoryItem, MemoryPolarity, MemorySource, UserProfile } from './memory-store.js';

export interface PostgresQueryClient { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> }
export interface AsyncMemoryStore {
  startSession(): Promise<string>; endSession(sessionId: string, input: { mood: string; summary: string }): Promise<void>;
  recordEvent(input: { sessionId: string; trackId: string; eventType: ListeningEventType }): Promise<void>;
  listEvents(filter: { trackId?: string; since?: string }): Promise<ListeningEvent[]>;
  getProfile(): Promise<UserProfile>; upsertMemory(input: Omit<MemoryItem, 'id' | 'lastConfirmedAt'>): Promise<void>;
  listMemories(): Promise<MemoryItem[]>; clearAll(): Promise<void>;
}

export async function createPostgresMemoryStore(client: PostgresQueryClient, userId: string): Promise<AsyncMemoryStore> {
  await client.query(schema);
  await client.query('INSERT INTO user_profile (user_id, timezone, created_at, updated_at) VALUES ($1, $2, $3, $3) ON CONFLICT (user_id) DO NOTHING', [userId, 'Asia/Shanghai', now()]);
  return new PostgresMemoryStore(client, userId);
}
class PostgresMemoryStore implements AsyncMemoryStore {
  constructor(private readonly client: PostgresQueryClient, private readonly userId: string) {}
  async startSession() { const id = randomUUID(); await this.client.query('INSERT INTO sessions (id, user_id, started_at) VALUES ($1, $2, $3)', [id, this.userId, now()]); return id; }
  async endSession(id: string, input: { mood: string; summary: string }) { await this.client.query('UPDATE sessions SET ended_at=$1, mood=$2, summary=$3 WHERE id=$4 AND user_id=$5', [now(), input.mood, input.summary.slice(0, 300), id, this.userId]); }
  async recordEvent(input: { sessionId: string; trackId: string; eventType: ListeningEventType }) { await this.client.query('INSERT INTO listening_events (id, session_id, user_id, track_id, event_type, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), input.sessionId, this.userId, input.trackId, input.eventType, now()]); }
  async listEvents(filter: { trackId?: string; since?: string }) { const values: unknown[]=[this.userId]; let text='SELECT id, session_id, track_id, event_type, created_at FROM listening_events WHERE user_id=$1'; if(filter.trackId){values.push(filter.trackId); text+=' AND track_id=$'+values.length;} if(filter.since){values.push(filter.since); text+=' AND created_at >= $'+values.length;} const {rows}=await this.client.query(text+' ORDER BY created_at ASC', values); return rows.map((r)=>({id:String(r.id),sessionId:String(r.session_id),trackId:String(r.track_id),eventType:r.event_type as ListeningEventType,createdAt:String(r.created_at)})); }
  async getProfile() { const {rows}=await this.client.query('SELECT user_id, timezone, voice_id, voice_speed FROM user_profile WHERE user_id=$1',[this.userId]); const row=rows[0]; return {userId:this.userId,timezone:row?String(row.timezone):'Asia/Shanghai',voiceId:row?.voice_id===null?null:row?.voice_id?String(row.voice_id):null,voiceSpeed:row?.voice_speed===null?null:row?.voice_speed?Number(row.voice_speed):null}; }
  async upsertMemory(input: Omit<MemoryItem,'id'|'lastConfirmedAt'>) { const t=now(); await this.client.query('INSERT INTO memory_items (id,user_id,memory_key,value,polarity,confidence,evidence_count,source,last_confirmed_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9) ON CONFLICT (user_id,memory_key,value) DO UPDATE SET polarity=EXCLUDED.polarity, confidence=EXCLUDED.confidence, evidence_count=EXCLUDED.evidence_count, source=EXCLUDED.source, last_confirmed_at=EXCLUDED.last_confirmed_at, updated_at=EXCLUDED.updated_at',[randomUUID(),this.userId,input.key,input.value,input.polarity,input.confidence,input.evidenceCount,input.source,t]); }
  async listMemories() { const {rows}=await this.client.query('SELECT id,memory_key,value,polarity,confidence,evidence_count,source,last_confirmed_at FROM memory_items WHERE user_id=$1 ORDER BY updated_at ASC',[this.userId]); return rows.map((r)=>({id:String(r.id),key:String(r.memory_key),value:String(r.value),polarity:r.polarity as MemoryPolarity,confidence:Number(r.confidence),evidenceCount:Number(r.evidence_count),source:r.source as MemorySource,lastConfirmedAt:String(r.last_confirmed_at)})); }
  async clearAll() { await this.client.query('DELETE FROM listening_events WHERE user_id=$1; DELETE FROM memory_items WHERE user_id=$1; DELETE FROM sessions WHERE user_id=$1', [this.userId]); }
}
const now=()=>new Date().toISOString();
const schema=`CREATE TABLE IF NOT EXISTS user_profile (user_id TEXT PRIMARY KEY, timezone TEXT NOT NULL, voice_id TEXT, voice_speed REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,mood TEXT,summary TEXT); CREATE TABLE IF NOT EXISTS listening_events (id TEXT PRIMARY KEY,session_id TEXT NOT NULL,user_id TEXT NOT NULL,track_id TEXT NOT NULL,event_type TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memory_items (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,memory_key TEXT NOT NULL,value TEXT NOT NULL,polarity TEXT NOT NULL,confidence REAL NOT NULL,evidence_count INTEGER NOT NULL,source TEXT NOT NULL,last_confirmed_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,memory_key,value));`;
