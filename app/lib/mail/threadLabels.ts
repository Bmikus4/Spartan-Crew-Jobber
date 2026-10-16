// ============================================================================
// Gmail labels from the TV's own state (Ben, 10-15). One minute workflow in n8n asks this for
// every thread's labels and applies them; the app decides, n8n only carries it out.
// ----------------------------------------------------------------------------
// Four order labels, exclusive (CLAUDE.md: a thread wearing done and outstanding at once says
// both), plus Needs Follow Up on its own axis. All of them come off when a person ticks the card
// or the system sees the item resolved: a green card wears nothing.
//
// Why it matters, measured 10-15: since 10-12, 7 of 8 real bot orders were keyed again by staff
// 10 to 30 minutes later, 2 of them identical. The order was right and nobody saw it. Staff
// work from Gmail, so the inbox is where "Order Created R11xxx" has to be.
// ============================================================================
import type { FeedCard } from "../feed/project";

export const ORDER_LABELS = ["Order Created", "Order Updated", "Order Needs Created", "Order Needs Updated"] as const;
export const FOLLOW_UP = "Needs Follow Up";
export type OrderLabel = (typeof ORDER_LABELS)[number];

/** Same colours the old four wore, so the inbox reads as it did. */
export const COLOURS: Record<string, { backgroundColor: string; textColor: string }> = {
  "Order Created": { backgroundColor: "#16a766", textColor: "#ffffff" },
  "Order Updated": { backgroundColor: "#4a86e8", textColor: "#ffffff" },
  "Order Needs Created": { backgroundColor: "#cc3a21", textColor: "#ffffff" },
  "Order Needs Updated": { backgroundColor: "#eaa041", textColor: "#ffffff" },
  "Needs Follow Up": { backgroundColor: "#a479e2", textColor: "#ffffff" },
};

/** The old names, renamed in place so threads that wear them keep them under the new name. */
export const RENAMES: Array<{ from: string; to: OrderLabel }> = [
  { from: "Order Built", to: "Order Created" },
  { from: "Order Needs Built", to: "Order Needs Created" },
];

/** Labels earlier systems put on bookings threads; they come off every thread (Ben, 10-15). */
export const STRIP = ["HIGH", "MEDIUM", "LOW", "SamurAI", "TEST"];

export type ThreadLabels = { thread_id: string; order: OrderLabel | null; follow_up: boolean; r_number: string | null };

/** A failure outranks a success, as the TV leads with it. */
const RANK: Record<string, OrderLabel> = {
  "needs-created": "Order Needs Created",
  "needs-updated": "Order Needs Updated",
  "created-check": "Order Created",
  "updated-check": "Order Updated",
};
const ORDER_OF: OrderLabel[] = ["Order Needs Created", "Order Needs Updated", "Order Created", "Order Updated"];

export function labelsFor(card: FeedCard): ThreadLabels {
  if (card.green) return { thread_id: card.thread_id, order: null, follow_up: false, r_number: card.r_number };
  const open = card.items.filter((i) => !i.green).map((i) => RANK[i.kind]).filter(Boolean);
  const order = ORDER_OF.find((l) => open.includes(l)) ?? null;
  return { thread_id: card.thread_id, order, follow_up: !!card.follow_up, r_number: card.r_number };
}

/** What changes on Gmail: threads whose labels differ from what was last applied, and threads that left the TV. */
export function changes(now: ThreadLabels[], last: Map<string, { order: string | null; follow_up: boolean }>): Array<ThreadLabels & { add: string[]; remove: string[] }> {
  const out: Array<ThreadLabels & { add: string[]; remove: string[] }> = [];
  const seen = new Set<string>();
  const all = [...ORDER_LABELS, FOLLOW_UP];
  for (const t of now) {
    seen.add(t.thread_id);
    const was = last.get(t.thread_id);
    if (was && was.order === t.order && was.follow_up === t.follow_up) continue;
    const add = [...(t.order ? [t.order] : []), ...(t.follow_up ? [FOLLOW_UP] : [])];
    out.push({ ...t, add, remove: all.filter((l) => !add.includes(l)) });
  }
  for (const [thread_id, was] of last) {
    if (seen.has(thread_id) || (!was.order && !was.follow_up)) continue;
    out.push({ thread_id, order: null, follow_up: false, r_number: null, add: [], remove: all });
  }
  return out;
}
