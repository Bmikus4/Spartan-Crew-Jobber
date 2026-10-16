import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { authorizeMachineCall } from "../../../lib/apiAuth";
import { serveFeed } from "../../../lib/feed/serve";
import { liveFeedDeps } from "../../../lib/feed/live";
import type { FeedCard } from "../../../lib/feed/project";
import { changes, labelsFor, COLOURS, FOLLOW_UP, ORDER_LABELS, RENAMES, STRIP } from "../../../lib/mail/threadLabels";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Gmail calls one n8n run makes for threads; the rest wait for the next minute. */
const PER_RUN = 150;

/**
 * Which labels each bookings thread should wear, for the n8n workflow "Spartan Labels"
 * (scripts/install-label-workflow.mjs), from the same cards the TV draws. Only threads whose
 * labels changed since they were last handed out are returned, and every hour all of them, so
 * a run n8n dropped is put right within the hour. mode "dry" hands out the same answer and
 * remembers nothing. Under /api/bot, so the machine secret is its only gate.
 */
export async function POST(request: Request): Promise<Response> {
  if (!authorizeMachineCall(request).ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { mode?: string; full?: boolean };
  const live = body.mode === "live";
  const now = Date.now();
  const sql = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim());
  await sql`CREATE TABLE IF NOT EXISTS thread_labels (thread_id TEXT PRIMARY KEY, order_label TEXT, follow_up BOOLEAN NOT NULL DEFAULT false, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;

  // The TV's projection without its side work: no verifier, no jobs board, no marks written.
  const feed = await serveFeed({ ...liveFeedDeps(), verify: undefined, verifyStatus: undefined, jobs: undefined, remember: undefined }, now);
  if (feed.status !== 200) return NextResponse.json({ ok: false, error: "the feed could not be read; no labels change this minute" }, { status: 503 });
  const cards = (feed.body.everything ?? []) as FeedCard[];
  const want = [...new Map(cards.map((c) => [c.thread_id, labelsFor(c)])).values()];

  const rows = (await sql`SELECT thread_id, order_label, follow_up FROM thread_labels`) as { thread_id: string; order_label: string | null; follow_up: boolean }[];
  const last = new Map(rows.map((r) => [r.thread_id, { order: r.order_label, follow_up: !!r.follow_up }]));
  const full = body.full === true || new Date(now).getUTCMinutes() === 0;
  const against = full ? new Map([...last].map(([k, v]) => [k, { order: "(resend)", follow_up: v.follow_up }])) : last;
  const todo = changes(want, against).slice(0, PER_RUN);

  if (live) {
    for (const t of todo) {
      await sql`INSERT INTO thread_labels (thread_id, order_label, follow_up, applied_at) VALUES (${t.thread_id}, ${t.order}, ${t.follow_up}, now())
        ON CONFLICT (thread_id) DO UPDATE SET order_label = EXCLUDED.order_label, follow_up = EXCLUDED.follow_up, applied_at = now()`;
    }
  }
  return NextResponse.json({
    ok: true, mode: live ? "live" : "dry", full,
    labels: [...ORDER_LABELS, FOLLOW_UP].map((name) => ({ name, color: COLOURS[name] })),
    renames: RENAMES, strip: STRIP,
    threads: todo.map((t) => ({ thread_id: t.thread_id, r_number: t.r_number, add: t.add, remove: t.remove })),
  }, { headers: { "cache-control": "no-store" } });
}
