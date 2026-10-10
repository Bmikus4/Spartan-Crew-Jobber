// The feed's production reads. SELECTs only; the feed's writes live in marksDb.ts.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { allMarks, verifyStatus, addMark, claimVerify, saveVerify } from "./marksDb";
import { verify } from "./verify";
import { httpTransport } from "../engine/onsinch";
import { followupsEnabled } from "../followup/enabled";
import type { FeedDeps } from "./serve";
import type { ReplyNeed } from "./project";
import type { V2Row } from "./v2";
import type { ConversationState } from "../engine/types";

let _sql: NeonQueryFunction<false, false> | null = null;
function db(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) throw new Error("no database configured");
  _sql = neon(url);
  return _sql;
}

async function states(): Promise<ConversationState[]> {
  const rows = (await db()`SELECT state FROM conversation_state`) as { state: ConversationState }[];
  return rows.map((r) => r.state);
}

/**
 * The newest CLIENT message per thread dates a need: conversation_state.updated_at
 * moves on every hourly sweep and would make each need look minutes old. The newest
 * message of OURS says whether that client has had a reply since (drafts are never
 * stored, so an unsent draft cannot count as one). The newest message of any kind is
 * the intake's pulse.
 */
async function inbound(): Promise<{ byThread: Map<string, number>; outByThread: Map<string, number>; latest: number | null }> {
  const [rows, last] = await Promise.all([
    db()`SELECT thread_id, date_iso, first_seen_at, is_from_spartan FROM thread_messages` as unknown as Promise<{ thread_id: string; date_iso: string | null; first_seen_at: string | Date; is_from_spartan: boolean }[]>,
    db()`SELECT MAX(first_seen_at) AS last FROM thread_messages` as unknown as Promise<{ last: string | Date | null }[]>,
  ]);
  const byThread = new Map<string, number>();
  const outByThread = new Map<string, number>();
  for (const r of rows) {
    const t = Date.parse(String(r.date_iso ?? "")) || new Date(r.first_seen_at).getTime();
    const m = r.is_from_spartan ? outByThread : byThread;
    if (t > (m.get(r.thread_id) ?? 0)) m.set(r.thread_id, t);
  }
  return { byThread, outByThread, latest: last[0]?.last ? new Date(last[0].last).getTime() : null };
}

/** Only clients waiting on Spartan; "Spartan waiting for client" is nobody's reply to write. */
async function replies(): Promise<ReplyNeed[]> {
  const { followupBoard } = await import("../followup/board");
  const board = await followupBoard();
  return board.alerts
    .filter((a) => a.owed_by === "us")
    .map((a) => ({ thread_id: a.thread_id, since_iso: a.waiting_since_iso, company: a.company_name, contact: a.contact_name, subject: a.subject }));
}

/**
 * The rebuild's first build (685838f, 10-09 10:07-10:20Z) decided on each thread's OLDEST
 * email, so its rows are about mail that was dealt with weeks ago. Decisions made on a
 * workstation ("local": replays, the TEST bench) are not the intake's.
 */
const V2_FROM = "2026-10-09T10:20:00Z";

async function v2(): Promise<V2Row[]> {
  const [t] = (await db()`SELECT to_regclass('public.v2_decisions') AS t`) as { t: string | null }[];
  if (!t?.t) return [];
  const rows = (await db()`
    SELECT d.thread_id, d.message_id, d.sent_at, d.kind, d.interpretation->'grounded' AS grounded, d.decision, d.executed,
           d.company_id, d.company, d.from_address, m.subject
    FROM v2_decisions d LEFT JOIN thread_messages m ON m.message_id = d.message_id
    WHERE d.kind IN ('write', 'handoff') AND coalesce(d.code_version, '') <> 'local' AND d.created_at >= ${V2_FROM}`) as any[];
  return rows.map((r) => ({ ...r, company_id: r.company_id == null ? null : Number(r.company_id) }));
}

export function liveFeedDeps(): FeedDeps {
  return {
    states, inbound, marks: allMarks, v2,
    replies: followupsEnabled() ? replies : null,
    // verify() wraps this transport in readOnly() before its first call.
    verify: (cards, now, marks, wants) => verify(cards, now, {
      transport: httpTransport({
        baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1",
        apiKey: process.env.ONSINCH_API_KEY || "",
      }),
      claim: claimVerify, save: saveVerify, addMark,
    }, marks, undefined, wants),
    verifyStatus,
    remember: async (ms) => { for (const m of ms) await addMark(m); },
  };
}
