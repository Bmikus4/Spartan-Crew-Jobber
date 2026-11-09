// ============================================================================
// The fold: a conversation's standing state, computed as a pure function of its stored events.
// ----------------------------------------------------------------------------
// state = f(state, event) over the thread's events oldest first: readings (ask-v1), mail direction,
// and staff acts on linked orders. The state answers, at any moment: which asks are open, which side
// is waited on, what settled or withdrew each, with proof (timeline row ids). Nothing here reads the
// database or the clock — the caller supplies events and asks for expiry at a stated time — so the
// same events always give the same state, chunked or whole (test/fold.ts pins both), and the stored
// copy (fold_state, scripts/refold.mts) can be thrown away and refolded at any time. Owner's ruling
// 9 Nov: accuracy is tested against behavior (staff rework, client chases), never against labels.
// ============================================================================
import type { CanonicalAsk } from "../ask";

export const FOLD_VERSION = "fold-v1";

export type FoldEvent =
  | { t: string; kind: "mail"; id: string; from: "client" | "spartan" }
  | { t: string; kind: "reading"; id: string; ask: CanonicalAsk }
  | { t: string; kind: "act"; id: string; order_id: number; row_id: number; creator: number };

export type AskState = {
  key: string;            // the first ask_key that opened it
  akind: string;          // the reading's action
  date?: string;
  order_id?: number;
  values: Record<string, unknown>;
  status: "open" | "acted" | "withdrawn";
  opened_at: string;
  acted_at?: string;
  proof: number[];        // timeline row ids of the acts that touched it
  merged: string[];       // later ask_keys folded into this one
};

export type FoldState = {
  version: typeof FOLD_VERSION;
  thread_id: string;
  asks: AskState[];
  waiting: "client" | "spartan" | null;
  last_event: string | null; // the last event id folded in, the staleness stamp
  last_t: string | null;
  events: number;
};

export function emptyState(thread_id: string): FoldState {
  return { version: FOLD_VERSION, thread_id, asks: [], waiting: null, last_event: null, last_t: null, events: 0 };
}

/** The identity an ask keeps across restatements: what it is, on which day, on which booking. */
const identity = (akind: string, date?: string, order_id?: number) => `${akind}|${date ?? ""}|${order_id ?? ""}`;

const CANCEL = "cancel_shift";

export function foldEvent(s: FoldState, e: FoldEvent): FoldState {
  const asks = s.asks.map((a) => ({ ...a, proof: [...a.proof], merged: [...a.merged], values: { ...a.values } }));
  let waiting = s.waiting;
  if (e.kind === "mail") {
    waiting = e.from === "client" ? "spartan" : "client";
  } else if (e.kind === "reading") {
    for (const r of e.ask.asks ?? []) {
      const date = (r.values as any)?.date?.value as string | undefined;
      const vals: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.values ?? {})) if (v && typeof v === "object" && "value" in (v as any)) vals[k] = (v as any).value;
      if (r.kind === CANCEL) {
        // A cancel withdraws the open ask it names (same day, same booking when both name one).
        const hit = asks.find((a) => a.status === "open" && a.akind !== CANCEL && a.date === date && (!r.order_id || !a.order_id || a.order_id === r.order_id));
        if (hit) { hit.status = "withdrawn"; hit.merged.push(r.key); continue; }
      }
      const id = identity(r.kind, date, r.order_id ?? undefined);
      const open = asks.find((a) => a.status !== "withdrawn" && identity(a.akind, a.date, a.order_id) === id);
      if (open) {
        // The same ask restated: the newest given words win; an acted ask asked again reopens.
        Object.assign(open.values, vals);
        open.merged.push(r.key);
        if (open.status === "acted") { open.status = "open"; open.acted_at = undefined; }
      } else {
        asks.push({ key: r.key, akind: r.kind, date, order_id: r.order_id ?? undefined, values: vals, status: "open", opened_at: e.t, proof: [], merged: [] });
      }
    }
  } else if (e.kind === "act") {
    // Staff touched a linked order: every open ask on that order (or any order, when the ask names none)
    // sent before the act is marked acted. Whether the act HELD the ask is the gold join's final-state
    // check, kept outside the fold so the fold never grades itself.
    for (const a of asks) {
      if (a.status !== "open") continue;
      if (a.order_id && a.order_id !== e.order_id) continue;
      if (a.opened_at > e.t) continue;
      a.status = "acted";
      a.acted_at = a.acted_at ?? e.t;
      if (a.proof.length < 20) a.proof.push(e.row_id);
    }
  }
  return { ...s, asks, waiting, last_event: e.id, last_t: e.t, events: s.events + 1 };
}

export function foldAll(thread_id: string, events: FoldEvent[]): FoldState {
  // Order is the caller's duty; folding sorts nothing so a replay is byte-faithful to the log.
  return events.reduce(foldEvent, emptyState(thread_id));
}

/** The asks still open whose day has passed at `now` (London day boundary approximated in UTC+0). */
export function expired(s: FoldState, nowIso: string): AskState[] {
  const today = nowIso.slice(0, 10);
  return s.asks.filter((a) => a.status === "open" && a.date !== undefined && a.date < today);
}
