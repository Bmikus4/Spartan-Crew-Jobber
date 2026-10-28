// ============================================================================
// How each need left the TV (ADDENDUM §12.2, "per card", P2.5).
// ----------------------------------------------------------------------------
// The Part 1 audit found 97 of 275 needs since 6 Oct with no recorded exit: nothing is written when a card's day
// passes (project.ts skips it) or when a later email takes its place, and the verifier's marks carry no person.
// Every minute this reads what the TV shows, as the TV builds it (serve.ts, with no verifier and nothing written
// back), and keeps one row per need: when it was first and last open, and how it left, with who when known:
//   - green on the card: the mark that turned it (a person's tick, staff's edit found by the verifier with the
//     OnSinch user from the timeline, the order found, resolved);
//   - gone while another need on its thread is open: superseded by a later email;
//   - gone with every day of its card past: its day passed;
//   - gone after a person dismissed the thread: dismissed;
//   - gone otherwise: "left the TV", counted, so a way out nobody named shows up in the report.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { FeedCard } from "../../feed/project";
import { utcToLondon } from "../bot/ops";
import { ensureSchema } from "../../migrations";

type Sql = NeonQueryFunction<false, false>;
const NEED = new Set(["needs-created", "needs-updated"]);
const GREEN_EXIT: Record<string, string> = { checked: "a person's tick", "staff-edit": "staff's edit found", "order-found": "the order found", resolved: "resolved by a later email", matched: "matched" };

export async function recordCardExits(sql: Sql, cards: FeedCard[], now = Date.now()): Promise<{ open: number; exited: number }> {
  await ensureSchema(sql);
  const today = utcToLondon(new Date(now).toISOString()).date;
  const at = new Date(now).toISOString();
  const open: any[] = [], green: any[] = [];
  for (const c of cards) for (const i of c.items) {
    if (!NEED.has(i.kind)) continue;
    const base = { item_key: i.item_key, thread_id: c.thread_id, kind: i.kind, days: c.dates ?? [], opened_at: new Date(i.at || now).toISOString() };
    if (!i.green) open.push(base);
    else {
      const creator = (i.green.evidence as { creator?: unknown } | null)?.creator;
      green.push({ ...base, exit: GREEN_EXIT[i.green.mark] ?? i.green.mark, exit_by: i.green.by ?? (creator ? `onsinch:${creator}` : null), exit_at: new Date(i.green.at || now).toISOString() });
    }
  }
  if (open.length) await sql`INSERT INTO v2_card_exits (item_key, thread_id, kind, days, opened_at, last_seen_at)
    SELECT item_key, thread_id, kind, days, opened_at, ${at}::timestamptz FROM jsonb_to_recordset(${JSON.stringify(open)}::jsonb)
      AS x(item_key TEXT, thread_id TEXT, kind TEXT, days JSONB, opened_at TIMESTAMPTZ)
    ON CONFLICT (item_key) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, days = EXCLUDED.days WHERE v2_card_exits.exit IS NULL`;
  // Turned green: its mark is how it left. A need first seen already green is recorded with it.
  if (green.length) await sql`INSERT INTO v2_card_exits (item_key, thread_id, kind, days, opened_at, last_seen_at, exit, exit_by, exit_at)
    SELECT item_key, thread_id, kind, days, opened_at, ${at}::timestamptz, exit, exit_by, exit_at FROM jsonb_to_recordset(${JSON.stringify(green)}::jsonb)
      AS x(item_key TEXT, thread_id TEXT, kind TEXT, days JSONB, opened_at TIMESTAMPTZ, exit TEXT, exit_by TEXT, exit_at TIMESTAMPTZ)
    ON CONFLICT (item_key) DO UPDATE SET exit = EXCLUDED.exit, exit_by = EXCLUDED.exit_by, exit_at = EXCLUDED.exit_at, last_seen_at = EXCLUDED.last_seen_at
    WHERE v2_card_exits.exit IS NULL`;
  // Gone from the TV without a mark.
  const shown = new Set([...open, ...green].map((x) => x.item_key));
  const openThreads = new Set(open.map((x) => x.thread_id));
  const gone = ((await sql`SELECT item_key, thread_id, days FROM v2_card_exits WHERE exit IS NULL`) as any[]).filter((r) => !shown.has(r.item_key));
  const dismissed = new Map(((await sql`SELECT thread_id, by, at FROM feed_marks WHERE mark = 'dismissed'`) as any[]).map((m) => [String(m.thread_id), m]));
  for (const r of gone) {
    const days = (Array.isArray(r.days) ? r.days : []) as string[];
    const d = dismissed.get(String(r.thread_id));
    const exit = d ? "dismissed" : openThreads.has(r.thread_id) ? "superseded by a later email" : days.length && days.every((x) => x < today) ? "its day passed" : "left the TV";
    await sql`UPDATE v2_card_exits SET exit = ${exit}, exit_by = ${d?.by ?? null}, exit_at = ${at}::timestamptz WHERE item_key = ${r.item_key} AND exit IS NULL`;
  }
  return { open: open.length, exited: gone.length };
}
