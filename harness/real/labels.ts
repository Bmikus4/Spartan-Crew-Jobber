// ============================================================================
// The label file: one row per live-week email, converted from the blind reads.
// ----------------------------------------------------------------------------
// Run: npx tsx harness/real/labels.ts   (writes eval/harness/labels/live-week.jsonl)
//
// Each row carries both readers' fields as written (asks, target_ref, days, crew, sure), the
// third reader's where it read the email, the consensus the live-week figures were counted by,
// and the provisional flag. The readers' free-text notes are NOT carried: they paraphrase the
// email, and this file is committed.
//
// The consensus rules are eval/reads/scripts/score.mts's, character for character (STRICT,
// WIDE, inq), and b42.mts's for quotes. Changing one changes every figure in
// eval/live-week-reads.md, which score-production checks line by line.
//
// `excluded` is the one field not read from the readers: an email both readers call booking
// work that needs nothing from this system, because OnSinch's own portal sent it (the sender
// rule, process.ts:161) or because the booking was already made when the email was decided
// (production said so; the basis records whether the snapshot bears it out). It is frozen here
// so that replay is scored against the same 90 outstanding requests as production.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadShown } from "./shown";
import { coded } from "../../app/lib/v2/reasons";
import { utcToLondon } from "../../app/lib/v2/bot/ops";
import { READS, LABELS, LABELS_ALL, ROOT, csvRows, fileHash, gold, readJson, type GoldDecision, type GoldMessage } from "./data";

export type Reading = { asks: string; target_ref: string; days: string; crew: string; sure: string };
export type Tri = "inquiry" | "disputed" | "not";
export type Label = {
  message_id: string;
  thread_id: string;
  date_iso: string;
  A: Reading;
  B: Reading;
  /** The third blind reader, on its 46-row sample only. */
  V: Reading | null;
  consensus: {
    /** Booking work (a new booking, a change, a cancellation): both readers, neither, or split. */
    strict: Tri;
    /** Any request at all (adds quotes, PO-only, questions). */
    wide: Tri;
    /** Both readers: a quote or availability request, and neither reads booking work. */
    quote_only: boolean;
    /** B42 (owner, 10-15): a quote-only email where either reader recorded a day AND a crew count. */
    b42_shifts: boolean;
    /** Both readers: a new booking. */
    new_booking: boolean;
    /** Both readers: nothing asked at all. */
    nothing: boolean;
  };
  /** Booking work after the third reader's majority on a split; null when a split has no third reading. */
  resolved: { strict: "inquiry" | "not"; by: "pair" | "majority with reader-V" } | null;
  provisional: boolean;
  provisional_why: string | null;
  /** Why the row is in eval/reads/adjudicate.csv, if it is. */
  adjudicate: string | null;
  excluded: null | "portal_notice" | "already_done";
  excluded_basis: string | null;
  /**
   * A split settled by majority with the third reader (eval/reads/settled.csv), all.jsonl only.
   * The consensus fields are then the winning reader's, as if both readers had read it so.
   */
  settled?: { asks: string; days: string; crew: string; by: string };
};

/** Which blind reads a label file is built from. live-week: the 400 the baseline was measured on, splits left disputed. */
export type LabelSet = "live-week" | "all";
const SOURCES: Record<LabelSet, { A: string[]; B: string[]; V: string[]; settle: boolean; path: string }> = {
  "live-week": { A: ["A-1.csv", "A-2.csv"], B: ["B-1.csv", "B-2.csv"], V: ["V-v.csv"], settle: false, path: LABELS },
  all: { A: ["A-1.csv", "A-2.csv", "A-3.csv", "A-4.csv"], B: ["B-1.csv", "B-2.csv", "B-3.csv", "B-4.csv"], V: ["V-v.csv", "V-v2.csv"], settle: true, path: LABELS_ALL },
};
export const labelPath = (set: LabelSet) => SOURCES[set].path;

export const STRICT = /new_booking|change|cancel/;
export const WIDE = /new_booking|quote_or_availability|change|cancel|po_only|question/;
export const inq = (r: Reading | null | undefined, re: RegExp) => !!r && re.test(r.asks) && !/^nothing$/.test(r.asks);
export const has = (r: Reading | null | undefined, k: string) => (r?.asks ?? "").split("+").includes(k);
const tri = (a: boolean, b: boolean): Tri => (a && b ? "inquiry" : !a && !b ? "not" : "disputed");

const reading = (r: Record<string, string> | undefined): Reading | null =>
  r ? { asks: r.asks ?? "", target_ref: r.target_ref ?? "", days: r.days ?? "", crew: r.crew ?? "", sure: r.sure ?? "" } : null;
const byId = (files: string[]) => new Map(files.flatMap((f) => (existsSync(join(READS, f)) ? csvRows(join(READS, f)) : [])).map((r) => [r.message_id, r]));

/** The label file, parsed. */
export function loadLabels(path = LABELS): Label[] {
  return readFileSync(path, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as Label);
}

/** Days of an order with a live (not cancelled) shift, London dates: booked.mts's test for "already booked". */
function liveDays(o: any): Set<string> {
  const s = new Set<string>();
  for (const j of ([] as any[]).concat(o?.Job ?? [])) for (const t of ([] as any[]).concat(j?.SlotTeam ?? [])) for (const sl of ([] as any[]).concat(t?.Slot ?? []))
    if (sl.beginning && !sl.cancelled) s.add(utcToLondon(String(sl.beginning)).date);
  return s;
}

export function buildLabels(set: LabelSet = "live-week"): Label[] {
  const src = SOURCES[set];
  const A = byId(src.A), B = byId(src.B), V = byId(src.V);
  const settledCsv = new Map(src.settle ? csvRows(join(READS, "settled.csv")).map((r) => [r.message_id, r]) : []);
  const adj = new Map(csvRows(join(READS, "adjudicate.csv")).map((r) => [r.message_id, r.why_listed]));
  const msgs = new Map(gold<GoldMessage[]>("messages.json").map((m) => [m.message_id, m]));
  const dec = new Map(gold<GoldDecision[]>("decisions.json").map((d) => [d.message_id, d]));
  // The second snapshot booked.mts checked against (week-truth, 10-23); absent, the basis says so.
  const wt = join(ROOT, ".tmp-data/week-truth-orders.json");
  const ordersByNo = new Map<string, any>();
  for (const o of gold<any[]>("orders.json")) ordersByNo.set(String(o.number), o);
  if (existsSync(wt)) for (const o of readJson<any[]>(wt)) ordersByNo.set(String(o.number), o);

  const ids = [...A.keys()];
  const missing = ids.filter((id) => !B.has(id) || !msgs.has(id));
  if (missing.length || B.size !== A.size) throw new Error(`labels: ${missing.length} ids lack a B reading or a message; A ${A.size}, B ${B.size}`);

  const out: Label[] = ids.map((id) => {
    const m = msgs.get(id)!;
    const a = reading(A.get(id))!, b = reading(B.get(id))!, v = reading(V.get(id));
    const pair = tri(inq(a, STRICT), inq(b, STRICT));
    // A settled split is read as if both readers had read it the winner's way.
    const st = pair === "disputed" ? settledCsv.get(id) : undefined;
    const win = st ? (st.source === "A+V" ? a : st.source === "B+V" ? b : null) : null;
    if (st && (!win || win.asks !== st.asks || win.days !== st.days || win.crew !== st.crew)) throw new Error(`labels: settled.csv row ${id} does not match the reader it names`);
    const [x, y] = win ? [win, win] : [a, b];
    const strict = tri(inq(x, STRICT), inq(y, STRICT));
    const quote_only = has(x, "quote_or_availability") && has(y, "quote_or_availability") && !STRICT.test(x.asks + y.asks);
    const consensus = {
      strict,
      wide: tri(inq(x, WIDE), inq(y, WIDE)),
      quote_only,
      b42_shifts: quote_only && (!!(x.days && x.crew) || !!(y.days && y.crew)),
      new_booking: has(x, "new_booking") && has(y, "new_booking"),
      nothing: !inq(x, WIDE) && !inq(y, WIDE),
    };
    let resolved: Label["resolved"] = null, provisional = false, provisional_why: string | null = null;
    if (st) resolved = { strict: strict === "inquiry" ? "inquiry" : "not", by: "majority with reader-V" };
    else if (strict !== "disputed") resolved = { strict: strict === "inquiry" ? "inquiry" : "not", by: "pair" };
    else {
      provisional = true;
      if (v) {
        const side = inq(v, STRICT) === inq(a, STRICT) ? "A" : "B";
        resolved = { strict: inq(v, STRICT) ? "inquiry" : "not", by: "majority with reader-V" };
        provisional_why = `readers A and B split on booking work; reader-V sides with ${side}; resting on a 2-1 vote, it stays out of the locked test set`;
      } else provisional_why = "readers A and B split on booking work and no third reading exists";
    }
    // Excluded: booking work this system was right to do nothing about (live-week-reads.md:26-28).
    let excluded: Label["excluded"] = null, excluded_basis: string | null = null;
    const d = dec.get(id);
    if (strict !== "not" && d?.kind === "none") {
      // Production's code as production coded it (shown.ts): reasons.ts may since code the same words otherwise.
      const c = loadShown().rows.get(id)?.code ?? coded(d.decision).code;
      const reason = String(d.decision.reason ?? "");
      if (c === "none_not_client") { excluded = "portal_notice"; excluded_basis = "sender rule (process.ts:161); production code none_not_client"; }
      else if (c === "none_already_booked" || c === "none_already_as_asked" || (c === "other" && /^already as asked/.test(reason))) {
        excluded = "already_done";
        if (c === "other") excluded_basis = "production said already as asked (code other); not checked against a snapshot";
        else {
          const rs = [...reason.matchAll(/R(\d{3,6})/g)].map((x) => x[1]);
          const asked = new Set([...a.days.split(";"), ...b.days.split(";")].filter(Boolean));
          const hit = rs.some((r) => { const o = ordersByNo.get(r); return o && (!asked.size || [...asked].some((day) => liveDays(o).has(day))); });
          excluded_basis = `production said ${c}; ` + (!rs.length ? "no R number in the reason"
            : hit ? "confirmed: the R named has a live shift on the asked day"
            : rs.every((r) => !ordersByNo.has(r)) ? "the R named is in neither snapshot"
            : "the R named has no live shift on the asked day");
        }
      }
    }
    return {
      message_id: id, thread_id: m.thread_id, date_iso: new Date(m.date_iso).toISOString(),
      A: a, B: b, V: v, consensus, resolved, provisional, provisional_why,
      adjudicate: adj.get(id) ?? null, excluded, excluded_basis,
      ...(st ? { settled: { asks: st.asks, days: st.days, crew: st.crew, by: st.source } } : {}),
    };
  });
  return out.sort((x, y) => x.date_iso.localeCompare(y.date_iso) || x.message_id.localeCompare(y.message_id));
}

/** The file's exact text: what the gate test compares the committed file with. */
export const serialize = (rows: Label[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

if (process.argv[1] && /labels\.ts$/.test(process.argv[1])) {
  for (const set of ["live-week", "all"] as LabelSet[]) {
    const rows = buildLabels(set), path = labelPath(set);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serialize(rows));
    const n = (f: (r: Label) => boolean) => rows.filter(f).length;
    console.log(JSON.stringify({
      set, rows: rows.length, strict_inquiry: n((r) => r.consensus.strict === "inquiry"), disputed: n((r) => r.consensus.strict === "disputed"),
      settled: n((r) => !!r.settled), provisional: n((r) => r.provisional), with_V: n((r) => !!r.V), excluded_portal: n((r) => r.excluded === "portal_notice"),
      excluded_done: n((r) => r.excluded === "already_done"), b42_shifts: n((r) => r.consensus.b42_shifts), labels_hash: fileHash(path),
    }));
  }
}
