// ============================================================================
// The jobs board, carried onto the TV as completed work (Ben, 2026-10-11: "port everything
// from the jobs board into the tv dashboard, mark them all as completed. that is becoming
// the new opps list").
// ----------------------------------------------------------------------------
// The board read the paused engine's tickets. Those jobs were handled in the mailbox while
// the engine was paused, so each comes across as Done, under its order's label, with no
// Confirm to press. They sit at the bottom of Done, oldest last, and never leave on the 24h
// dwell: they are the record of what was booked before the TV started (FEED_FROM).
//
// What the board laned as dismissed (not a job, ignored, not a client) is not carried: it
// was never work. A thread already on the TV keeps its live card.
// ============================================================================
import type { Job } from "../jobsDb";
import type { ConversationState } from "../engine/types";
import type { FeedCard, FeedKind } from "./project";
import { STATUS_TEXT } from "./project";

const dismissed = (j: Job) => j.classification === "not-a-job" || j.status === "ignored" || (j as { is_client_inquiry?: boolean }).is_client_inquiry === false;
const first = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "—" ? v.trim().split(/\s+/)[0] : null);

export function portedCards(jobs: Job[], states: ConversationState[], onTv: Set<string>): FeedCard[] {
  const company = new Map(states.map((s) => [s.thread_id, typeof s.facts?.company_name === "string" && s.facts.company_name.trim() ? s.facts.company_name.trim() : null]));
  const out: FeedCard[] = [];
  for (const j of jobs) {
    if (dismissed(j) || onTv.has(j.thread_id)) continue;
    const kind: FeedKind = j.classification === "update" ? "updated-check" : "created-check";
    const at = Date.parse(String((j as { updated_at?: unknown }).updated_at ?? "")) || 0;
    out.push({
      thread_id: j.thread_id,
      colour: kind === "updated-check" ? "blue" : "red",
      lane: "done",
      items: [{ item_key: `ported:${j.thread_id}`, kind, status: STATUS_TEXT[kind], at, green: { mark: "resolved", by: null, evidence: { ported: true }, at } }],
      green: true,
      at,
      order_id: j.order_id,
      company_id: j.company_id,
      company: company.get(j.thread_id) ?? null,
      contact: first(j.contact),
      dates: [...(j.dates ?? [])].map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(),
      starts_at: null,
      awaiting_reply_since: null,
      crew: j.crew_size ?? null,
      venue: j.location ?? null,
      r_number: j.order_number ? `R${String(j.order_number).replace(/^R/i, "")}` : null,
      j_number: j.job_id ? `J${j.job_id}` : null,
      subject: j.subject,
      quiet: false,
      follow_up: false,
      note: null,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}
