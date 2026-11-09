// ============================================================================
// The canonical ask, v1: the unit every system speaks (reader, fold, target, cards, judge, labels).
// ----------------------------------------------------------------------------
// A pure function of what v2_decisions already stores ({extraction, grounded}), so every reading
// ever recorded gets the same canonical form the newest one does, and a reading from last month and
// one from today compare field for field. Nothing here decides: values the grounding dropped stay
// dropped (the raw extraction underneath keeps them), and no value appears without its tier —
// "given" (the client's words in this email), "read" (the thread's history or a resolved id from
// the context the reader was shown). "hint" is reserved for the fold's priors; a reading never
// emits it. The ask key `<message_id>:<idx>` is the ask-pair grain the event log, the gold join
// and the curated set's labels all join on — cut here while volume is small.
// ============================================================================
import type { Extraction, Grounded, RawRequest } from "./interpret/extract";
import type { Interpretation, Request } from "./interpret/interpret";

export const ASK_VERSION = "ask-v1";

export type AskTier = "given" | "read" | "hint";
export type AskValue<T> = { value: T; tier: AskTier; proof?: string };

export type Ask = {
  /** `<message_id>:<index in the reading>` — stable, derivable, never reassigned. */
  key: string;
  kind: RawRequest["action"];
  /** The booking and shift it lands on, resolved from what the reader was shown. */
  order?: string;
  order_id?: number;
  shift_id?: number;
  place_id?: number;
  values: {
    date?: AskValue<string>;
    start?: AskValue<string>;
    end?: AskValue<string>;
    duration_minutes?: AskValue<number>;
    crew?: AskValue<number>;
    crew_add?: AskValue<number>;
    crew_remove?: AskValue<number>;
    venue?: AskValue<string>;
    crew_chief?: AskValue<boolean>;
    trade?: AskValue<string>;
  };
  target?: { quote: string; date?: string; start?: string };
  problems: string[];
};

export type CanonicalAsk = {
  version: typeof ASK_VERSION;
  message_id: string;
  intent: Extraction["intent"];
  po?: AskValue<string>;
  company?: AskValue<string>;
  order?: string;
  order_id?: number;
  asks: Ask[];
  problems: string[];
};

const quoteOf = <T>(g: Grounded<T> | undefined): string | undefined =>
  g && typeof g === "object" && typeof g.quote === "string" ? g.quote : undefined;

function v<T>(kept: T | undefined, raw: Grounded<T> | undefined, tier: AskTier): AskValue<T> | undefined {
  if (kept === undefined || kept === null) return undefined;
  const proof = quoteOf(raw);
  return proof === undefined ? { value: kept, tier } : { value: kept, tier, proof };
}

/**
 * grounded.requests is built positionally from extraction.requests (interpret.ts ground() maps
 * x.requests), so index i pairs the kept value with the words it came from. An old row whose
 * extraction lacks a newer field simply yields no proof for it.
 */
export function canonicalAsk(
  message_id: string,
  interpretation: { extraction?: Extraction | null; grounded?: Interpretation | null } | null | undefined
): CanonicalAsk | null {
  const g = interpretation?.grounded;
  if (!g) return null;
  const x = interpretation?.extraction ?? null;
  const asks: Ask[] = (g.requests ?? []).map((r: Request, i: number) => {
    const raw = x?.requests?.[i];
    const tier: AskTier = r.history ? "read" : "given";
    const ask: Ask = {
      key: `${message_id}:${i}`,
      kind: r.action,
      values: {
        date: v(r.date, raw?.date, tier),
        start: v(r.start, raw?.start, tier),
        end: v(r.end, raw?.end, tier),
        duration_minutes: v(r.duration, raw?.duration_minutes, tier),
        crew: v(r.crew, raw?.crew, tier),
        crew_add: v(r.crew_add, raw?.crew_add, tier),
        crew_remove: v(r.crew_remove, raw?.crew_remove, tier),
        venue: v(r.venue, raw?.venue, tier),
        crew_chief: v(r.crew_chief, raw?.crew_chief, tier),
        trade: v(r.trade, raw?.trade, tier),
      },
      problems: r.problems ?? [],
    };
    if (r.order !== undefined && r.order !== null) ask.order = r.order;
    if (r.order_id !== undefined && r.order_id !== null) ask.order_id = r.order_id;
    if (r.shift_id !== undefined && r.shift_id !== null) ask.shift_id = r.shift_id;
    if (r.place_id !== undefined && r.place_id !== null) ask.place_id = r.place_id;
    if (r.target) ask.target = r.target;
    return ask;
  });
  const out: CanonicalAsk = { version: ASK_VERSION, message_id, intent: g.intent, asks, problems: g.problems ?? [] };
  const po = v(g.po, x?.po ?? undefined, "given");
  if (po) out.po = po;
  const company = v(g.company_name, x?.company ?? undefined, "given");
  if (company) out.company = company;
  if (g.order_id !== undefined && g.order_id !== null) out.order_id = g.order_id;
  if (x?.order !== undefined && x?.order !== null) out.order = x.order;
  return out;
}
