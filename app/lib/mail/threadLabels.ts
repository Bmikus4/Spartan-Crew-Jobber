// ============================================================================
// Gmail labels from the TV's own state (Ben, 10-15). One minute workflow in n8n asks this for [DECISIONS V21]
// every thread's labels and applies them; the app decides, n8n only carries it out.
// ----------------------------------------------------------------------------
// Four order labels, exclusive (CLAUDE.md: a thread wearing done and outstanding at once says
// both). All of them come off when a person ticks the card or the system sees the item resolved:
// a green card wears nothing. Needs Follow Up was removed on 19 Nov (Ben).
//
// Why it matters, measured 10-15: since 10-12, 7 of 8 real bot orders were keyed again by staff
// 10 to 30 minutes later, 2 of them identical. The order was right and nobody saw it. Staff
// work from Gmail, so the inbox is where "Order Created R11xxx" has to be.
// ============================================================================
import type { FeedCard } from "../feed/project";

export const ORDER_LABELS = ["Order Created", "Order Updated", "Order Needs Created", "Order Needs Updated"] as const;
export type OrderLabel = (typeof ORDER_LABELS)[number];

/** Same colours the old four wore, so the inbox reads as it did. */
export const COLOURS: Record<string, { backgroundColor: string; textColor: string }> = {
  "Order Created": { backgroundColor: "#16a766", textColor: "#ffffff" },
  "Order Updated": { backgroundColor: "#4a86e8", textColor: "#ffffff" },
  "Order Needs Created": { backgroundColor: "#cc3a21", textColor: "#ffffff" },
  "Order Needs Updated": { backgroundColor: "#eaa041", textColor: "#ffffff" },
};

/** The old names, renamed in place so threads that wear them keep them under the new name. */
export const RENAMES: Array<{ from: string; to: OrderLabel }> = [
  { from: "Order Built", to: "Order Created" },
  { from: "Order Needs Built", to: "Order Needs Created" },
];

/** Labels earlier systems put on bookings threads; they come off every thread (Ben, 10-15). [DECISIONS V21] */
export const STRIP = ["HIGH", "MEDIUM", "LOW", "SamurAI", "TEST"];

/**
 * THE LABELS GMAIL WEARS (Ben, 19 Nov): Order Needs Updated, and Order Needs Created while its Settings toggle is on.
 * The toggle is applied before this, by serve.ts (showCreates), which leaves no needs-created item on a card when it is
 * off. The system's own Order Created and Order Updated stay off (O53). changes() removes every label of ours a thread
 * is not given, so a label leaving this set comes off every thread at the next sync.
 */
export const SHOWN_LABELS: ReadonlySet<string> = new Set<string>(["Order Needs Updated", "Order Needs Created"]);

export type ThreadLabels = { thread_id: string; order: OrderLabel | null; r_number: string | null };

/** A failure outranks a success, as the TV leads with it. */
const RANK: Record<string, OrderLabel> = {
  "needs-created": "Order Needs Created",
  "needs-updated": "Order Needs Updated",
  "created-check": "Order Created",
  "updated-check": "Order Updated",
};
const ORDER_OF: OrderLabel[] = ["Order Needs Created", "Order Needs Updated", "Order Created", "Order Updated"];

export function labelsFor(card: FeedCard): ThreadLabels {
  if (card.green) return { thread_id: card.thread_id, order: null, r_number: card.r_number };
  const open = card.items.filter((i) => !i.green).map((i) => RANK[i.kind]).filter(Boolean);
  // A failure outranks a success, and a label not worn never hides one that is.
  const order = ORDER_OF.find((l) => open.includes(l) && SHOWN_LABELS.has(l)) ?? null;
  return { thread_id: card.thread_id, order, r_number: card.r_number };
}

/** What changes on Gmail: threads whose labels differ from what was last applied, and threads that left the TV. */
export function changes(now: ThreadLabels[], last: Map<string, { order: string | null }>): Array<ThreadLabels & { add: string[]; remove: string[] }> {
  const out: Array<ThreadLabels & { add: string[]; remove: string[] }> = [];
  const seen = new Set<string>();
  const all: string[] = [...ORDER_LABELS];
  for (const t of now) {
    seen.add(t.thread_id);
    const was = last.get(t.thread_id);
    if (was && was.order === t.order) continue;
    const add: string[] = t.order ? [t.order] : [];
    out.push({ ...t, add, remove: all.filter((l) => !add.includes(l)) });
  }
  for (const [thread_id, was] of last) {
    if (seen.has(thread_id) || !was.order) continue;
    out.push({ thread_id, order: null, r_number: null, add: [], remove: all });
  }
  return out;
}

/** Threads refused in one run that mean the mailbox, not a thread: the alarm's line. */
export const LABELS_REFUSED_ALARM = 5;

/**
 * The alarm for one run in which Gmail refused many threads, or null under the line. The count lives in
 * `detail` and never in `what`: errorReport's fingerprint keeps numbers under four digits, so a count in
 * `what` turned every new count into a new error_reports row (34 rows and 12,281 occurrences for one broken
 * credential, 3-17 Nov) instead of one row whose occurrences rise.
 */
export function labelsRefusedAlarm(failed: string[]): { what: string; detail: string } | null {
  if (failed.length < LABELS_REFUSED_ALARM) return null;
  return {
    what: "Gmail refused the labels on many threads at once: the mailbox's connection in n8n is likely broken",
    detail: `${failed.length} threads refused; first ${failed.slice(0, 5).join(", ")}`,
  };
}
