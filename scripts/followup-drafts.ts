// ============================================================================
// Compose follow-up drafts for BOTH directions and put them in the mailbox to read.
// ----------------------------------------------------------------------------
// Ben, 2026-09-29: "ai drafts already exist, but I need to look at them before they
// go out" — replies_enabled is flipped only after twelve have been read in a browser.
//
// SO THIS DOES NOT TOUCH THAT SETTING. Drafts are driven straight at the reply-draft
// webhook, the same path scripts/verify-reply-draft.ts probed, so the live pipeline
// stays exactly as off as it is now. Draft generation is not permission to send, and
// nothing here sends.
//
// ONE MODEL CALL PER DRAFT. The classification is read from conversation_state rather
// than re-derived, and the booking situation is built from what that row actually
// holds — an order id, a desired order, needs_human — so the reply is told the truth
// about the thread instead of a convenient default. A draft composed against
// "there is nothing to book here" would read fine and prove nothing.
//
// WHICH MESSAGE IT REPLIES TO. Always the last CLIENT message, in both directions.
// The n8n workflow addresses the draft to the parent's Reply-To or From, so replying
// to one of our own messages would produce a draft addressed to bookings@ — fine for
// a connectivity probe, useless for judging what a client would receive.
//
// EVERY DRAFT ID IS WRITTEN TO DISK before this exits, so the whole set can be
// deleted in one go once it has been read. Twelve real drafts on twelve real client
// threads is not a thing to leave lying around on trust.
//
//   npx tsx scripts/followup-drafts.ts                 # compose only, write to disk
//   npx tsx scripts/followup-drafts.ts --post          # compose AND draft into Gmail
//   npx tsx scripts/followup-drafts.ts --post -n 12
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { loadEnv, requireEnv } from "./_env.mjs";
import { sql } from "./_q.mjs";
import { reasoner } from "../app/lib/deps";
import { waitingPeriod } from "../app/lib/followup/clock";
import { outstandingAsk } from "../app/lib/followup/compose";
import type { ThreadMessage, Classification } from "../app/lib/engine/types";
import type { ReplyResult } from "../app/lib/engine/reason";

loadEnv();

const POST = process.argv.includes("--post");
const N = process.argv.includes("-n")
  ? Math.min(24, Number(process.argv[process.argv.indexOf("-n") + 1] || 12))
  : 12;

type MsgRow = {
  thread_id: string; message_id: string; from_address: string; to_addresses: unknown;
  date_iso: string; subject: string; body: string | null; is_from_spartan: boolean;
};
type StateRow = { thread_id: string; state: Record<string, unknown> };

/**
 * The booking situation, from what the row actually holds.
 *
 * Deliberately conservative in the middle case: a thread with a desired order that
 * was never written is "blocked", because that is what stopped it, and telling the
 * reply writer otherwise is how a draft ends up promising a booking that does not
 * exist. That failure is already recorded in prompts.ts and is not worth repeating.
 */
function orderState(s: Record<string, unknown>): "staged" | "updating-existing" | "blocked" | "not-a-job" {
  if (s.onsinch_order_id) return s.last_ordered_hash ? "updating-existing" : "staged";
  if (s.desired_order) return "blocked";
  return "not-a-job";
}

async function main() {
  requireEnv("GMAIL_DRAFT_WEBHOOK");
  requireEnv("N8N_WEBHOOK_SECRET");

  const [msgRows, stateRows] = await Promise.all([
    sql`SELECT thread_id, message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
        FROM thread_messages ORDER BY thread_id, date_iso ASC` as unknown as Promise<MsgRow[]>,
    sql`SELECT thread_id, state FROM conversation_state` as unknown as Promise<StateRow[]>,
  ]);

  const states = new Map(stateRows.map((r) => [r.thread_id, r.state ?? {}]));
  const threads = new Map<string, ThreadMessage[]>();
  for (const r of msgRows) {
    const m: ThreadMessage = {
      message_id: r.message_id, from: r.from_address,
      to: Array.isArray(r.to_addresses) ? (r.to_addresses as string[]) : [],
      date_iso: r.date_iso, subject: r.subject ?? "", body: r.body ?? "",
      is_from_spartan: r.is_from_spartan,
    };
    const list = threads.get(r.thread_id);
    if (list) list.push(m); else threads.set(r.thread_id, [m]);
  }

  type Cand = { thread_id: string; msgs: ThreadMessage[]; owed: "us" | "them"; since: string };
  const cands: Cand[] = [];
  for (const [thread_id, msgs] of threads) {
    if (!states.has(thread_id)) continue;             // no engine state: nothing truthful to tell the writer
    const w = waitingPeriod(msgs);
    if (!w) continue;
    if (!msgs.some((m) => !m.is_from_spartan)) continue; // nobody to address
    cands.push({ thread_id, msgs, owed: w.owed_by, since: w.since_iso });
  }

  const newest = (a: Cand, b: Cand) => b.since.localeCompare(a.since);
  const half = Math.ceil(N / 2);
  const picked = [
    ...cands.filter((c) => c.owed === "us").sort(newest).slice(0, half),
    ...cands.filter((c) => c.owed === "them").sort(newest).slice(0, N - half),
  ];

  console.log(`${cands.length} threads carry an open wait; composing ${picked.length}\n`);

  const out: Array<Record<string, unknown>> = [];
  for (const c of picked) {
    const lastClient = [...c.msgs].reverse().find((m) => !m.is_from_spartan)!;
    const history = c.msgs.filter((m) => m.message_id !== lastClient.message_id);
    const state = states.get(c.thread_id)!;
    const label = c.owed === "us" ? "client waiting for Spartan" : "Spartan waiting for client";

    let composed: ReplyResult | null = null;
    let why = "";
    try {
      if (c.owed === "us") {
        composed = await reasoner().composeReply(
          lastClient, history,
          (state.classification as Classification) ?? "other",
          { order_state: orderState(state), ask_for: [] }
        );
        why = `reply, booking situation: ${orderState(state)}`;
      } else {
        const lastSpartan = [...c.msgs].reverse().find((m) => m.is_from_spartan)!;
        const ask = outstandingAsk(lastSpartan.body);
        if (!ask) {
          // An honest refusal beats "just checking in", which is the single most
          // deletable email there is. Counted and reported, never faked.
          console.log(`  SKIP  ${c.thread_id}  ${label} — nothing identifiable is outstanding`);
          out.push({ thread_id: c.thread_id, direction: label, skipped: "no identifiable ask" });
          continue;
        }
        composed = await reasoner().composeChase!(lastClient, history, ask);
        why = `chase, waiting on: ${ask}`;
      }
    } catch (e) {
      console.log(`  FAIL  ${c.thread_id}  ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      out.push({ thread_id: c.thread_id, direction: label, error: String((e as Error)?.message ?? e) });
      continue;
    }

    let draftId: string | null = null;
    if (POST) {
      const res = await fetch(requireEnv("GMAIL_DRAFT_WEBHOOK"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": requireEnv("N8N_WEBHOOK_SECRET") },
        body: JSON.stringify({ subject: composed.subject, html: composed.html, in_reply_to: lastClient.message_id }),
      });
      const j = (await res.json().catch(() => ({}))) as { draftId?: unknown };
      draftId = j.draftId ? String(j.draftId) : null;
      if (!draftId) console.log(`  WARN  ${c.thread_id}  webhook returned no draft id (HTTP ${res.status})`);
    }

    console.log(`  ${draftId ? "DRAFTED" : "composed"}  ${c.thread_id}  ${label}`);
    console.log(`      ${why}`);
    console.log(`      subject: ${composed.subject}`);
    out.push({
      thread_id: c.thread_id, direction: label, why,
      in_reply_to: lastClient.message_id, to: lastClient.from,
      subject: composed.subject, priority: composed.priority, html: composed.html,
      draft_id: draftId,
    });
  }

  mkdirSync(".tmp-data", { recursive: true });
  const file = `.tmp-data/followup-drafts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), posted: POST, drafts: out }, null, 1));
  const ids = out.map((o) => o.draft_id).filter(Boolean);
  console.log(`\nwritten to ${file}`);
  console.log(`${ids.length} draft(s) created in the bookings mailbox. Their ids are in that file — delete them together once read.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
