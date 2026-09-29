// ============================================================================
// The "Needs Follow-Up" list the dashboard reads.
// ----------------------------------------------------------------------------
// ONE DEFINITION OF "NEEDS FOLLOW-UP", and it is clock.ts's. This file does not get
// to have an opinion: it runs waitingPeriod over the stored messages and reports what
// comes back. A board that decided for itself which threads look overdue would drift
// from the labeller within a fortnight, and then the red count on the dashboard and
// the label in Gmail would disagree with nobody able to say which was right.
//
// TWO LISTS, NOT ONE, because they need different answers from a person:
//
//   alerts   overdue and inside the dormancy horizon. Somebody should act today.
//   dormant  overdue but waiting longer than the horizon. NOT chased automatically,
//            and not hidden either — 329 of these exist as at 2026-09-29, and a
//            dashboard that silently dropped them would be lying by omission. They
//            are reported as a count with a plain explanation, not as red alarm.
//
// Showing the second list in red would make the dashboard permanently alarming about
// threads that ended by phone two months ago, which is the fastest way to teach a team
// to ignore a red panel.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { waitingPeriod, isOverdue, isDormant, DORMANT_AFTER_DAYS, type Owed } from "./clock";
import type { ThreadMessage } from "../engine/types";

// Each *Db module here keeps its own lazy accessor rather than sharing one. Following
// that rather than inventing a shared module for one new reader.
let _sql: NeonQueryFunction<false, false> | null = null;
function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

export interface FollowupAlert {
  thread_id: string;
  owed_by: Owed;
  /** "client waiting for Spartan" reads plainly; the raw enum does not. */
  direction_label: string;
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
  subject: string;
  preview: string;
  last_activity_iso: string;
  waiting_since_iso: string;
  due_iso: string;
  overdue_hours: number;
  /** A real Gmail thread link, or null when the id is not one Gmail would accept. */
  thread_url: string | null;
  /** Always set: what the button should say, given whether thread_url exists. */
  link_label: string;
  fallback_url: string;
}

export interface FollowupBoard {
  alerts: FollowupAlert[];
  dormant_count: number;
  dormant_days: number;
  generated_iso: string;
}

/**
 * Gmail's own thread ids are 16 hex characters and open at #all/<id>. Threads minted
 * by the webhook intake from RFC headers are not, and guessing a URL for one produces
 * a button that looks like it works and lands on an empty mailbox. So the id is
 * CHECKED, and anything else gets an honestly-labelled search instead.
 */
const GMAIL_THREAD_ID = /^[0-9a-f]{16}$/i;

export function threadLink(thread_id: string, subject: string): Pick<FollowupAlert, "thread_url" | "link_label" | "fallback_url"> {
  const bare = thread_id.replace(/^gmail:/, "");
  const search = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(subject.slice(0, 120) || bare)}`;
  if (GMAIL_THREAD_ID.test(bare)) {
    return {
      thread_url: `https://mail.google.com/mail/u/0/#all/${bare}`,
      link_label: "Open email thread",
      fallback_url: search,
    };
  }
  return { thread_url: null, link_label: "Search inbox for this subject", fallback_url: search };
}

type MsgRow = {
  thread_id: string; message_id: string; from_address: string; to_addresses: unknown;
  date_iso: string; subject: string; body: string | null; is_from_spartan: boolean;
};
type StateRow = { thread_id: string; state: Record<string, unknown> | null };

export async function followupBoard(now: Date = new Date()): Promise<FollowupBoard> {
  const q = db();
  if (!q) return { alerts: [], dormant_count: 0, dormant_days: DORMANT_AFTER_DAYS, generated_iso: now.toISOString() };

  const [msgRows, stateRows] = await Promise.all([
    q`SELECT thread_id, message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
       FROM thread_messages ORDER BY thread_id, date_iso ASC` as unknown as Promise<MsgRow[]>,
    q`SELECT thread_id, state FROM conversation_state` as unknown as Promise<StateRow[]>,
  ]);

  const states = new Map(stateRows.map((r) => [r.thread_id, (r.state ?? {}) as Record<string, unknown>]));
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

  const alerts: FollowupAlert[] = [];
  let dormant = 0;

  for (const [thread_id, msgs] of threads) {
    const w = waitingPeriod(msgs);
    if (!w || !isOverdue(w, now)) continue;
    if (isDormant(w, now)) { dormant++; continue; }

    const facts = (states.get(thread_id)?.facts ?? {}) as Record<string, unknown>;
    const last = msgs[msgs.length - 1];
    const lastClient = [...msgs].reverse().find((m) => !m.is_from_spartan);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    alerts.push({
      thread_id,
      owed_by: w.owed_by,
      direction_label: w.owed_by === "us" ? "Client waiting for Spartan" : "Spartan waiting for client",
      contact_name: str(facts.contact_name),
      contact_email: str(facts.contact_email) ?? lastClient?.from ?? null,
      company_name: str(facts.company_name),
      subject: last.subject || "(no subject)",
      preview: (msgs.find((m) => m.message_id === w.since_message_id)?.body ?? "")
        .replace(/\s+/g, " ").trim().slice(0, 160),
      last_activity_iso: last.date_iso,
      waiting_since_iso: w.since_iso,
      due_iso: w.due_iso,
      overdue_hours: Math.floor((now.getTime() - Date.parse(w.due_iso)) / 3_600_000),
      ...threadLink(thread_id, last.subject || ""),
    });
  }

  // Most overdue first: the oldest deadline is the one somebody should open now.
  alerts.sort((a, b) => a.due_iso.localeCompare(b.due_iso));

  return { alerts, dormant_count: dormant, dormant_days: DORMANT_AFTER_DAYS, generated_iso: now.toISOString() };
}
