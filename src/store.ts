// ============================================================================
// store — the Save State Table. One row per Gmail thread, keyed by thread_id.
// This IS the dedup mechanism and the dashboard's data source. The interface
// is tiny on purpose; back it with Vercel Postgres/KV in production (an
// in-memory impl is provided for the prototype + tests).
// ============================================================================
import type { ConversationState } from "./types.js";

export interface StateStore {
  get(thread_id: string): Promise<ConversationState | undefined>;
  put(state: ConversationState): Promise<void>;
  all(): Promise<ConversationState[]>;
}

export class InMemoryStore implements StateStore {
  private m = new Map<string, ConversationState>();
  async get(id: string) {
    return this.m.get(id);
  }
  async put(s: ConversationState) {
    this.m.set(s.thread_id, s);
  }
  async all() {
    return [...this.m.values()];
  }
}
