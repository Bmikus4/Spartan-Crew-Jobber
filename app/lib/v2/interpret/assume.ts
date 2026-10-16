// ============================================================================
// Times a client did not write, assumed from what that client booked before (Ben, 10-15:
// "better it exists than not"). No start: 08:00. No end: the client's usual length when 7 of
// its last 10 shifts agree, else 4 hours. Every assumption is said, so a person can see it.
// ----------------------------------------------------------------------------
// Measured 10-15 on 3,145 staff-built shifts, rule run as it would live (each shift against
// the 10 before it from other orders): when 7 of 10 agree, the length is right 90.4% of the
// time for (client, venue, start), 85.3% for (client, venue), 70.1% for the client alone.
// So the most specific history that has 10 shifts decides.
// ============================================================================
import { utcToLondon } from "../bot/ops";
import { addMinutes } from "./ground";

export type PastShift = { start: string; minutes: number; place_id: number | null; at: number };

/** The bot's own orders are not history: they are what is being checked. */
const BOT_USER = 2257;
export const DEFAULT_START = "08:00";
export const DEFAULT_MINUTES = 240;

/** One shift per SlotTeam: its earliest start to its latest end, staff-made orders only. */
export function pastShifts(orders: any[]): PastShift[] {
  const out: PastShift[] = [];
  for (const o of orders) {
    if (Number(o?.creator) === BOT_USER) continue;
    for (const j of ([] as any[]).concat(o?.Job ?? []))
      for (const t of ([] as any[]).concat(j?.SlotTeam ?? [])) {
        const slots = ([] as any[]).concat(t?.Slot ?? []).filter((s: any) => s?.cancelled !== true && s?.beginning && s?.end);
        if (!slots.length) continue;
        const b = Math.min(...slots.map((s: any) => Date.parse(s.beginning)));
        const e = Math.max(...slots.map((s: any) => Date.parse(s.end)));
        if (!(e > b)) continue;
        out.push({ start: utcToLondon(new Date(b).toISOString()).time, minutes: Math.round((e - b) / 60e3), place_id: Number(slots[0]?.SlotLocation?.place_id) || null, at: b });
      }
  }
  return out;
}

const hours = (m: number) => (m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m / 60}h`);

/** The length 7 of the last 10 comparable shifts share, from the most specific history with 10. */
export function usualMinutes(shifts: PastShift[], want: { place_id?: number | null; start?: string; place_name?: string }): { minutes: number; basis: string } | null {
  const scopes: { name: string; keep: (s: PastShift) => boolean }[] = [];
  const at = want.place_name ? ` at ${want.place_name}` : " at this venue";
  if (want.place_id && want.start) scopes.push({ name: `shifts${at} starting ${want.start}`, keep: (s) => s.place_id === want.place_id && s.start === want.start });
  if (want.place_id) scopes.push({ name: `shifts${at}`, keep: (s) => s.place_id === want.place_id });
  scopes.push({ name: "shifts", keep: () => true });
  for (const sc of scopes) {
    const last = shifts.filter(sc.keep).sort((a, b) => b.at - a.at).slice(0, 10);
    if (last.length < 10) continue;
    const count = new Map<number, number>();
    for (const s of last) count.set(s.minutes, (count.get(s.minutes) ?? 0) + 1);
    const [minutes, n] = [...count].sort((a, b) => b[1] - a[1])[0];
    if (n >= 7) return { minutes, basis: `${n} of the client's last 10 ${sc.name} were ${hours(minutes)}` };
  }
  return null;
}

/** The start and end a new shift is booked at, and what was assumed to get them. */
export function fillTimes(r: { start?: string; end?: string; duration?: number }, history: PastShift[], where: { place_id?: number | null; place_name?: string }): { start: string; end: string; assumed: string[] } {
  const assumed: string[] = [];
  let start = r.start;
  let end = r.end;
  if (!start && end && r.duration) start = addMinutes(end, -r.duration);
  if (!start) { start = DEFAULT_START; assumed.push(`no start time written: ${DEFAULT_START}`); }
  if (!end && r.duration) end = addMinutes(start, r.duration);
  if (!end) {
    const usual = usualMinutes(history, { ...where, start });
    end = addMinutes(start, usual?.minutes ?? DEFAULT_MINUTES);
    assumed.push(usual ? `no end time written: ${end}, as ${usual.basis}` : `no end time written: ${end}, Spartan's 4-hour call`);
  }
  return { start, end, assumed };
}
