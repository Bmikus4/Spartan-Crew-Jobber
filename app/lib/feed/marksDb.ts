// ============================================================================
// The live feed's own records: who ticked what, and what the verifier found.
// ----------------------------------------------------------------------------
// The ONLY tables the feed writes. It never writes conversation_state, OnSinch or Gmail
// (test/feedReadsOnly.ts pins that), so everything here can be dropped without the
// engine noticing.
//
// The key is (item_key, mark), not item_key alone: a tick and a staff edit are separate
// evidence about the same item, and undoing the tick must not erase the edit.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { FeedMark, MarkKind } from "./project";
import { ensureSchema } from "../migrations";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}
async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await ensureSchema(sql);
  _ready = true;
}
function need(): NeonQueryFunction<false, false> {
  const sql = db();
  if (!sql) throw new Error("no database configured");
  return sql;
}

type Row = { item_key: string; thread_id: string; mark: MarkKind; by: string | null; evidence: Record<string, unknown> | null; at: string | Date };

export async function allMarks(): Promise<FeedMark[]> {
  const sql = need();
  await ensure(sql);
  const rows = (await sql`SELECT item_key, thread_id, mark, by, evidence, at FROM feed_marks`) as Row[];
  return rows.map((r) => ({ ...r, at: new Date(r.at).getTime() }));
}

/** Insert once; a later sighting of the same evidence never moves when it went green. */
export async function addMark(m: Omit<FeedMark, "at"> & { at?: number }): Promise<void> {
  const sql = need();
  await ensure(sql);
  await sql`
    INSERT INTO feed_marks (item_key, thread_id, mark, by, evidence, at)
    VALUES (${m.item_key}, ${m.thread_id}, ${m.mark}, ${m.by}, ${m.evidence ? JSON.stringify(m.evidence) : null}, ${new Date(m.at ?? Date.now()).toISOString()})
    ON CONFLICT (item_key, mark) DO NOTHING`;
}

/** Only ever the tick. Automatic evidence is not a person's to delete. */
export async function removeCheck(item_key: string): Promise<void> {
  const sql = need();
  await ensure(sql);
  await sql`DELETE FROM feed_marks WHERE item_key = ${item_key} AND mark = 'checked'`;
}
