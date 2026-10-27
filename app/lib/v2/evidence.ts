// ============================================================================
// The bot's OnSinch user, and what a set of requests asks for in the terms an order is compared
// on. Which order holds a request is identity/index.ts's to say (R8); its day-and-one-fact rule
// began here (Ben, 10-15: "no order can link on a date ALONE"). [DECISIONS V1]
// ============================================================================
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
