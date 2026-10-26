// ============================================================================
// What one decision put in front of staff: the TV outcome, read through the TV's own code.
// ----------------------------------------------------------------------------
// Outcome is v2Source's card kind (app/lib/feed/v2.ts:102), the code the office TV runs:
//   none        no card (v2.ts:109)
//   needs-reply a card the TV never lists (serve.ts:109)          -> silent, as failure-taxonomy §1.1
//   check       a verified write, never listed (serve.ts:116)     -> an item: the work was done
//   listed      needs-created / needs-updated, listed for a person -> an item
// eval/reads/scripts/score.mts re-implemented this; `readsOutcome` is that copy, kept only so
// score-production can show both agree on every email before trusting either.
// ============================================================================
import { loadShown } from "./shown";
import { coded } from "../../app/lib/v2/reasons";
import { v2Source, type V2Row } from "../../app/lib/feed/v2";
import type { Interpretation } from "../../app/lib/v2/interpret/interpret";
import { addr, gold, type GoldDecision, type GoldMessage } from "./data";

export type Outcome = "none" | "needs-reply" | "listed" | "check";
export const SHOWN = (o: Outcome) => o === "listed" || o === "check";

export type SystemRow = {
  message_id: string;
  kind: "none" | "handoff" | "write";
  decision: any;
  executed: any[] | null;
  outcome: Outcome;
  /** The TV card kind (needs-created, created-check, ...), null for none. */
  card: string | null;
  code: string;
  /** The item proposes a NEW order: a create_order op, or a card drawn as Order Needs Created. */
  proposes_new: boolean;
  company_id: number | null;
  /** Email sent -> decision recorded (production), or in-process time (replay). */
  latency_ms: number | null;
  cost_usd: number | null;
  /**
   * The later email this one was read with (process.ts:204-224): it has no card of its own, and its
   * request is on the later email's card. metrics.ts counts it as reached when that card is an item.
   */
  carried_by: string | null;
};

/** The later email a "read together" decision names. */
export const carrierOf = (d: any): string | null => /^read together with the later email (\S+)/.exec(String(d?.reason ?? ""))?.[1] ?? null;

/** The card the TV draws for a decision. `grounded` splits needs-created from needs-updated only. */
export function cardOf(m: { thread_id: string; message_id: string; sent_at: string; subject: string | null; from_address: string }, kind: SystemRow["kind"], decision: any, executed: any[] | null, grounded: Interpretation | null, company_id: number | null): string | null {
  if (kind === "none") return null;
  const row: V2Row = { thread_id: m.thread_id, message_id: m.message_id, sent_at: m.sent_at, kind, grounded, decision, executed, company_id, company: null, from_address: m.from_address, subject: m.subject };
  const item = v2Source(row, Date.parse(m.sent_at) || 0).item as { kind: string; work?: boolean } | null;
  // A reply card that asks for crew is listed where the TV lists it (serve.ts isFailure, once `work` exists).
  return item ? (item.kind === "needs-reply" && item.work ? "needs-reply+work" : item.kind) : null;
}

export function outcomeOfCard(card: string | null): Outcome {
  if (!card) return "none";
  if (card === "needs-reply") return "needs-reply";
  if (card === "needs-reply+work") return "listed";
  if (card === "created-check" || card === "updated-check") return "check";
  return "listed";
}

/** eval/reads/scripts/score.mts:22-30, verbatim in logic. */
const REPLY_REASON = /asked for a quote|the request is unclear|: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;
export function readsOutcome(r: { kind: string; decision: any; executed: any[] | null }): Outcome {
  const d = r.decision;
  if (r.kind === "none") return "none";
  if (r.kind === "write") {
    const ex = r.executed, ops = d.ops ?? [];
    return ex?.length && ex.length === ops.length && ex.every((e: any) => e.status === "verified") ? "check" : "listed";
  }
  return (d.reply ?? (d.reasons ?? []).every((x: string) => REPLY_REASON.test(x))) ? "needs-reply" : "listed";
}

const unwrap = (g: any) => (g && typeof g === "object" && "value" in g ? g.value : g ?? undefined);
/**
 * The grounded interpretation is not in the gold copy (decisions.json has no interpretation
 * column). For production's created/updated split only, the stored reading stands in for it:
 * the split reads intent, po, and each request's action and target (v2.ts:76-77).
 */
export function groundedFromReading(x: any): Interpretation | null {
  if (!x) return null;
  return {
    intent: x.intent, po: unwrap(x.po), problems: [],
    requests: (x.requests ?? []).map((r: any) => ({
      action: r.action, date: unwrap(r.date), start: unwrap(r.start), end: unwrap(r.end), crew: unwrap(r.crew), venue: unwrap(r.venue),
      target: r.target ? { quote: String(r.target.quote ?? ""), date: unwrap(r.target.date), start: unwrap(r.target.start) } : undefined,
    })),
  } as Interpretation;
}

export function proposesNew(kind: SystemRow["kind"], decision: any, card: string | null): boolean {
  if (kind === "write") return (decision.ops ?? []).some((o: any) => (o.op ?? o).kind === "create_order");
  return card === "needs-created";
}

/**
 * Production's stored decision for each email, as the TV showed it: from the frozen record (shown.ts).
 * `display: "current"` draws the same decisions through the TV code on disk instead.
 */
export function productionRows(ids: string[], display: "frozen" | "current" = "frozen"): Map<string, SystemRow> {
  const shown = display === "frozen" ? loadShown().rows : null;
  const msgs = new Map(gold<GoldMessage[]>("messages.json").map((m) => [m.message_id, m]));
  const dec = new Map(gold<GoldDecision[]>("decisions.json").map((d) => [d.message_id, d]));
  const rd = new Map(gold<any[]>("readings.json").map((r) => [r.message_id, r.extraction]));
  const out = new Map<string, SystemRow>();
  for (const id of ids) {
    const d = dec.get(id), m = msgs.get(id);
    if (!d || !m) throw new Error(`score-production: ${id} has no ${d ? "message" : "decision"} in the gold copy`);
    if (shown) {
      const s = shown.get(id);
      if (!s) throw new Error(`score-production: ${id} is not in production-shown.jsonl`);
      out.set(id, { message_id: id, kind: d.kind, decision: { ...d.decision, code: s.code }, executed: d.executed, outcome: s.outcome as SystemRow["outcome"], card: s.card, code: s.code,
        proposes_new: s.proposes_new, company_id: d.company_id, latency_ms: Date.parse(d.created_at) - Date.parse(d.sent_at), cost_usd: null, carried_by: s.carried_by });
      continue;
    }
    const decision = coded(d.decision);
    const card = cardOf({ thread_id: d.thread_id, message_id: id, sent_at: d.sent_at, subject: m.subject, from_address: addr(m.from_address) }, d.kind, decision, d.executed, groundedFromReading(rd.get(id)), d.company_id);
    out.set(id, {
      message_id: id, kind: d.kind, decision, executed: d.executed, outcome: outcomeOfCard(card), card, code: decision.code ?? "uncoded",
      proposes_new: proposesNew(d.kind, decision, card), company_id: d.company_id,
      latency_ms: Date.parse(d.created_at) - Date.parse(d.sent_at), cost_usd: null, carried_by: carrierOf(decision),
    });
  }
  return out;
}
