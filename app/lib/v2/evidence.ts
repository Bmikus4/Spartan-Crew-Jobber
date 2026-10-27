// ============================================================================
// WHICH ORDER A REQUEST IS ALREADY IN, by the day and one more fact (Ben, 10-15: "no order can [DECISIONS V1]
// link on a date ALONE. Date plus other evidence (client, venue, times, crew) may link").
// ----------------------------------------------------------------------------
// Measured 10-16 on the 13 open needs on the TV: 4 were jobs staff had already booked (Bearded
// Kitten R11545 and R11541, EMS R11515, Solotech), and none was found, because the finders asked
// for the exact window at the exact venue, or skipped a card whose link pointed at a dead bot
// order. Here the client's own orders are searched for one with a live shift on a day asked
// for that also shares the venue, a start time on that day, or the crew count that day.
// One such order is the answer; two equally good are no answer.
// ============================================================================
import { utcToLondon } from "./bot/ops";

export const BOT_USER = 2257;

export type Want = {
  /** London days asked for. */
  days: string[];
  /** "YYYY-MM-DD|HH:MM" starts asked for. */
  starts: string[];
  /** "YYYY-MM-DD|N" headcounts asked for. */
  crew: string[];
  place_id: number | null;
  r_numbers: string[];
};

export type Found = { order: any; evidence: string[] };

const liveSlots = (o: any): any[] =>
  ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j?.SlotTeam ?? []))
    .flatMap((t: any) => ([] as any[]).concat(t?.Slot ?? [])).filter((s: any) => s?.cancelled !== true && s?.beginning);

/** The order among `orders` that holds this request, or why there is not exactly one. */
export function evidenceMatch(want: Want, orders: any[], opts: { staffOnly?: boolean; skip?: Set<number> } = {}): Found | "ambiguous" | null {
  const hits: Found[] = [];
  for (const o of orders) {
    if (opts.skip?.has(Number(o.id))) continue;
    if (opts.staffOnly && Number(o.creator) === BOT_USER) continue;
    if (Number(o.status) === -1) continue;
    if (want.r_numbers.includes(String(o.number ?? ""))) return { order: o, evidence: ["its R number"] };
    const onDays = liveSlots(o).filter((s) => want.days.includes(utcToLondon(s.beginning).date));
    if (!onDays.length) continue;
    const evidence: string[] = [];
    if (want.place_id && onDays.some((s) => Number(s?.SlotLocation?.place_id) === want.place_id)) evidence.push("venue");
    const starts = new Set(onDays.map((s) => `${utcToLondon(s.beginning).date}|${utcToLondon(s.beginning).time}`));
    if (want.starts.some((k) => starts.has(k))) evidence.push("start time");
    const totals = new Map<string, number>();
    for (const s of onDays) { const d = utcToLondon(s.beginning).date; totals.set(d, (totals.get(d) ?? 0) + Number(s.size || 0)); }
    if (want.crew.some((k) => { const [d, n] = k.split("|"); return totals.get(d) === Number(n); })) evidence.push("crew count");
    if (evidence.length) hits.push({ order: o, evidence });
  }
  if (!hits.length) return null;
  const best = Math.max(...hits.map((h) => h.evidence.length));
  const top = hits.filter((h) => h.evidence.length === best);
  return top.length === 1 ? top[0] : "ambiguous";
}

/** What a set of grounded requests asks for, in the terms an order can be compared on. */
export function wantOf(requests: Array<{ date?: string; start?: string; crew?: number; place_id?: number; target?: { date?: string; start?: string } }>, r_numbers: string[] = []): Want {
  const days = new Set<string>(), starts = new Set<string>(), crew = new Set<string>();
  let place: number | null = null;
  for (const r of requests) {
    for (const d of [r.date, r.target?.date]) if (d) days.add(d);
    if (r.date && r.start) starts.add(`${r.date}|${r.start}`);
    if (r.target?.date && r.target.start) starts.add(`${r.target.date}|${r.target.start}`);
    if (r.date && r.crew) crew.add(`${r.date}|${r.crew}`);
    if (r.place_id && !place) place = Number(r.place_id);
  }
  return { days: [...days], starts: [...starts], crew: [...crew], place_id: place, r_numbers };
}
