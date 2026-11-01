// ============================================================================
// What a Spartan job is made of, as weights measured from production (ADDENDUM §14.4, 31 Oct, read-only:
// 2,335 orders with live calls, 1,252 readings of client emails). A job is drawn field by field from these, so
// the generated set looks like the real business in proportion, and every rare shape still turns up.
// The rules a buildable job keeps are the planner's (app/lib/v2/interpret/plan.ts), stated here as limits:
// the generator stays inside them for the buildable categories and steps outside them on purpose for the
// controls (harness/gen/cases.ts M).
// ============================================================================
import { addMinutes } from "../../app/lib/v2/interpret/ground";

export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
/** A value by measured weight: [[value, weight], ...]. */
export function weighted<T>(r: Rng, table: ReadonlyArray<readonly [T, number]>): T {
  const total = table.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of table) { x -= w; if (x < 0) return v; }
  return table[table.length - 1][0];
}

// ---- measured weights (ADDENDUM §14.4) ----------------------------------------------------------------------
export const DAYS = [[1, 1444], [2, 628], [3, 113], [4, 45], [5, 34], [6, 20], [8, 20], [10, 14]] as const;
export const CALLS_PER_DAY = [[1, 1758], [2, 541], [3, 36]] as const;
export const CREW = [[1, 1174], [2, 1405], [3, 362], [4, 988], [5, 240], [6, 240], [7, 108], [8, 109], [9, 74]] as const;
/** Over 9 in one call: 3% of calls; the planner hands them to a person (a shape it does not build). */
export const CREW_LARGE = [[10, 40], [12, 30], [15, 20], [20, 10]] as const;
export const START_HOUR = [[6, 167], [7, 296], [8, 717], [9, 739], [10, 329], [11, 207], [12, 191], [13, 159], [14, 192], [15, 194], [16, 308], [17, 327],
  [18, 149], [19, 99], [20, 86], [21, 117], [22, 165], [23, 212], [0, 17], [1, 58], [2, 30], [3, 14], [4, 18], [5, 33]] as const;
export const START_MINUTE = [["00", 3449], ["30", 1051], ["15", 121], ["45", 133]] as const;
export const LENGTH_HOURS = [[2, 1250], [3, 549], [4, 1456], [5, 216], [6, 352], [8, 503], [10, 323], [12, 157]] as const;
/** Days from the email to the first call (the order's lead time). */
export const LEAD_DAYS = [[1, 85], [2, 76], [3, 52], [5, 81], [7, 81], [10, 47], [14, 47], [21, 50], [30, 49], [45, 56]] as const;
export const VENUES = [[1, 2219], [2, 101], [3, 15]] as const;
/** A PO in the email: 57 of the 300-odd booking and change emails since 9 Oct. */
export const PO_IN_EMAIL = 0.19;

/**
 * The trades clients ask for, with the words they use and the profession the planner books (professions.ts). The
 * weight is the requests seen since 9 Oct; plain crew dominates (327 of about 420).
 */
export type Trade = { label: string; words: readonly string[]; profession: string | null };
export const TRADES: ReadonlyArray<readonly [Trade, number]> = [
  [{ label: "crew", words: ["crew", "general crew", "event crew", "local crew", "stagehands", "hands"], profession: null }, 327],
  [{ label: "Carpenter", words: ["carpenters", "chippies", "set builders", "joiners"], profession: "3" }, 14],
  [{ label: "Counterbalance", words: ["forklift drivers", "forkies", "FLT drivers", "counterbalance drivers"], profession: "22" }, 8],
  [{ label: "MCR Crew", words: ["MCR crew"], profession: "63" }, 4],
  [{ label: "Carpool Driver", words: ["carpool drivers"], profession: "45" }, 4],
  [{ label: "Minivan Driver", words: ["minivan drivers", "van drivers"], profession: "46" }, 4],
  [{ label: "AV tech", words: ["AV techs", "LED engineers", "video techs"], profession: "16" }, 14],
  [{ label: "Bar Staff", words: ["bar staff", "bartenders"], profession: "30" }, 3],
  [{ label: "IPAF 3a/3b", words: ["IPAF operators", "cherry picker operators"], profession: "5" }, 3],
  [{ label: "Telehandler", words: ["telehandler drivers"], profession: "23" }, 2],
];

// ---- a job --------------------------------------------------------------------------------------------------
export type Place = { id: number; name: string; address: string };
export type Call = { date: string; start: string; end: string; crew: number; trade: Trade; place: Place; chief?: boolean };
export type Job = { calls: Call[]; po: string | null };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export { addDays };

/** A call's times by the measured start and length. A call never ends inside the hour London's clock repeats. */
export function drawTimes(r: Rng): { start: string; end: string } {
  const start = `${String(weighted(r, START_HOUR)).padStart(2, "0")}:${weighted(r, START_MINUTE)}`;
  return { start, end: addMinutes(start, 60 * weighted(r, LENGTH_HOURS)) };
}

export type JobLimits = { maxCrew?: number; trades?: boolean; venues?: number; days?: number; callsPerDay?: number; po?: boolean };

/**
 * One job, drawn by the measured weights within the limits a category sets. `today` is the email's London day; the
 * first call is at least a day ahead, so no generated booking falls on a day already over unless a control wants it.
 */
export function drawJob(r: Rng, today: string, places: Place[], lim: JobLimits = {}): Job {
  const days = lim.days ?? weighted(r, DAYS);
  const first = addDays(today, weighted(r, LEAD_DAYS));
  const nVenues = lim.venues ?? weighted(r, VENUES);
  const venues = [...places].sort(() => r() - 0.5).slice(0, nVenues);
  const calls: Call[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(first, d);
    const n = lim.callsPerDay ?? weighted(r, CALLS_PER_DAY);
    const used = new Set<string>();
    for (let k = 0; k < n; k++) {
      let t = drawTimes(r);
      for (let tries = 0; used.has(t.start) && tries < 5; tries++) t = drawTimes(r);
      if (used.has(t.start)) continue;
      used.add(t.start);
      const trade = lim.trades === false ? TRADES[0][0] : weighted(r, TRADES);
      const crew = Math.min(lim.maxCrew ?? 9, weighted(r, CREW));
      calls.push({ date, ...t, crew, trade, place: venues[(d + k) % venues.length] });
    }
  }
  return { calls, po: lim.po ?? r() < PO_IN_EMAIL ? `${pick(r, ["PO", "INV-", "SPC", ""])}${int(r, 100000, 999999)}` : null };
}
