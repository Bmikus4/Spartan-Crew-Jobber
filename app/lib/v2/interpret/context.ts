// ============================================================================
// What the reader is shown besides the newest message: the thread, the client's bookings and
// the venues the client uses. All of it is what OnSinch and the inbox already hold.
// ----------------------------------------------------------------------------
// THE READER SAW ONLY THE NEWEST MESSAGE until 10-13, and that one choice made most of the
// failures measured against what ops did (scripts/score-vs-ops.mts, 9-13 Oct: 8 right of 63):
// - a change could not say which booking it was about. Clients almost never write an R number
//   (4 of 49 missed threads carried the right one anywhere), so "no order is named" was the
//   largest single reason;
// - a time, venue or crew count written two messages up was "not written by the client".
// The reader now picks the booking and shift from the list it is given, by id, and code checks
// the pick: the id must be one offered, its day must agree with any day the email gives, and
// every value must still be quoted from the thread (interpret.ts). Code and model must agree,
// as Ben ruled for every link (10-03); the day alone never links (S-0165).
// ============================================================================
import { utcToLondon } from "../bot/ops";
import { PROFESSION_NAME } from "./professions";

export type ThreadLine = { who: "client" | "spartan"; at: string; text: string };
export type BookingShift = { shift_id: number; name: string; date: string; start: string; end: string; place_id: number | null; venue: string; positions: string };
export type Booking = { order: string; order_id: number; job_id: number | null; name: string; po: string; shifts: BookingShift[] };
export type Venue = { place_id: number; name: string; address: string; uses: number };
export type ReadContext = { thread: ThreadLine[]; bookings: Booking[]; venues: Venue[] };

const teamsOf = (o: any) => ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []).map((t: any) => ({ job_id: Number(j.id), t })));
const live = (t: any) => ([] as any[]).concat(t.Slot ?? []).filter((s: any) => s.cancelled !== true);

/** The client's bookings with a shift from the day before the email to 90 days after, nearest first. */
export function bookingsOf(orders: any[], sentIso: string, placeName: (id: number) => string, limit = 20): Booking[] {
  const from = Date.parse(sentIso) - 864e5, to = Date.parse(sentIso) + 90 * 864e5;
  const out: (Booking & { first: number })[] = [];
  for (const o of orders) {
    // No status filter: the day window already keeps past jobs out, and an order closed since
    // (-2 once its day is over) was open when the email was written (Wall to Wall R11486).
    const shifts: BookingShift[] = [];
    let first = Infinity, job: number | null = null;
    for (const { job_id, t } of teamsOf(o)) {
      const slots = live(t);
      if (!slots.length) continue;
      const b = Date.parse(slots[0].beginning);
      if (!(b >= from && b <= to)) continue;
      first = Math.min(first, b); job = job ?? job_id;
      const s = utcToLondon(slots[0].beginning), e = utcToLondon(slots[0].end);
      const place = Number(slots[0].SlotLocation?.place_id) || null;
      const positions = slots.map((x: any) => `${x.size} ${Number(x.role) === 1 ? "Crew Chief" : PROFESSION_NAME[String(x.profession_id)] ?? `profession ${x.profession_id}`}`).join(" + ");
      shifts.push({ shift_id: Number(t.id), name: String(t.name ?? "").trim(), date: s.date, start: s.time, end: e.time, place_id: place, venue: place ? placeName(place) : "", positions });
    }
    if (shifts.length) out.push({ order: `R${o.number}`, order_id: Number(o.id), job_id: job, name: String(o.name ?? "").trim(), po: String(o.intern_name ?? "").trim(), shifts: shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)), first });
  }
  return out.sort((a, b) => a.first - b.first).slice(0, limit).map(({ first, ...b }) => b);
}

/** The places this client has booked, most used first. */
export function venuesOf(orders: any[], places: Map<number, { name: string; address?: string }>, limit = 12): Venue[] {
  const uses = new Map<number, number>();
  for (const o of orders) for (const { t } of teamsOf(o)) for (const s of live(t).slice(0, 1)) { const p = Number(s.SlotLocation?.place_id); if (p) uses.set(p, (uses.get(p) ?? 0) + 1); }
  return [...uses].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, n]) => ({ place_id: id, name: places.get(id)?.name ?? `place ${id}`, address: places.get(id)?.address ?? "", uses: n }));
}

/** The context as the reader is shown it. */
export function contextText(c: ReadContext): string {
  const thread = c.thread.length
    ? c.thread.map((l) => `[${l.who === "client" ? "CLIENT" : "SPARTAN"} ${l.at.slice(0, 16)}]\n${l.text.slice(0, 1500)}`).join("\n\n")
    : "(no earlier messages)";
  const bookings = c.bookings.length
    ? c.bookings.map((b) => `${b.order} "${b.name}"${b.po ? ` PO ${b.po}` : ""}\n` + b.shifts.map((s) => `  shift_id ${s.shift_id}: ${s.date} ${s.start}-${s.end} "${s.name}" at ${s.venue || "?"} — ${s.positions}`).join("\n")).join("\n")
    : "(none)";
  const venues = c.venues.length ? c.venues.map((v) => `venue_id ${v.place_id}: ${v.name}${v.address ? `, ${v.address}` : ""} (booked ${v.uses}x)`).join("\n") : "(none)";
  return `EARLIER MESSAGES ON THIS THREAD (oldest first):\n${thread}\n\nTHE CLIENT'S CURRENT BOOKINGS IN ONSINCH:\n${bookings}\n\nVENUES THIS CLIENT USES:\n${venues}`;
}

/** Every word the reader may quote: the subject, the earlier messages and the newest. */
export const quotable = (subject: string, c: ReadContext | undefined, newest: string) => [subject, ...(c?.thread ?? []).map((l) => l.text), newest].join("\n");
