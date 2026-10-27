// ============================================================================
// The operations the bot can perform, and everything about them that needs no browser.
// ----------------------------------------------------------------------------
// An operation is an explicit change to one record, never a "desired whole order": that
// model is what moved Legal Geek's install onto the derig day (#13709, 10-06). Days and
// times are London wall-clock as the client wrote them; conversion to UTC happens here,
// once, and OnSinch's read-back (UTC) is compared against the same conversion.
// ============================================================================
import { createHash } from "node:crypto";

export type PositionSpec = { size: number; profession_id: string; role?: "crew_chief" };

/** The wizard's role values (its select's data-value), as NewOrder carries them. */
export const wizardRole = (p: PositionSpec) => (p.role === "crew_chief" ? "CREWBOSS" : "WORKER");
/**
 * The first row of a new shift is plain Crew (the wizard's default row, the new-shift form's
 * one position); every other position is added after it. Null when there is no plain Crew
 * position: changing the first row's profession is not benched.
 */
export function rowsFor(positions: PositionSpec[]): PositionSpec[] | null {
  const i = positions.findIndex((p) => p.profession_id === "1" && !p.role);
  if (i < 0) return null;
  return [positions[i], ...positions.filter((_, j) => j !== i)];
}

/** The API's Slot.role for the same, as read back: 1 crew chief, 0 staff member. */
export const apiRole = (p: PositionSpec) => (p.role === "crew_chief" ? 1 : 0);
export type ShiftSpec = { name: string; date: string; start: string; end: string; place_id: string; place_label: string; positions: PositionSpec[]; description?: string };

export type Op =
  | { kind: "create_order"; company_id: string; company_name: string; client_email: string; job_name: string; po?: string; specification?: string; shifts: ShiftSpec[] }
  | { kind: "set_position_size"; order_id: number; slot_id: number; size: number }
  | { kind: "set_position_times"; order_id: number; slot_id: number; date: string; start: string; end: string }
  | { kind: "set_po"; order_id: number; po: string }
  | { kind: "cancel_position"; order_id: number; slot_id: number }
  | { kind: "add_shift"; order_id: number; location_id: number; name: string; date: string; start: string; end: string; positions: PositionSpec[] }
  | { kind: "add_position"; order_id: number; shift_id: number; date: string; start: string; end: string; position: PositionSpec };

/** Keys sorted at every depth; a field left undefined is left out, as JSON leaves it. */
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);

/**
 * Idempotency: the source message plus the operation's content, every field at every depth. A
 * retried email can never write twice. Until 27 Oct the key was legacyOpKey's: a replacer array
 * filters nested keys too, so a position's size and profession were not in it, and two additions
 * differing only there shared a key. A flat operation's key is unchanged.
 */
export function opKey(source: string, op: Op): string {
  return createHash("sha256").update(`${source}\n${op.kind}\n${canonical(op)}`).digest("hex").slice(0, 32);
}

/** The key before 27 Oct, still asked for so an operation run under it is never run again. */
export function legacyOpKey(source: string, op: Op): string {
  const canon = JSON.stringify(op, Object.keys(op).sort());
  return createHash("sha256").update(`${source}\n${op.kind}\n${canon}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Time. A London wall-clock moment -> UTC, by asking Intl what London's clock reads at a
// candidate instant and correcting. A time that does not exist (the spring-forward hour) or
// happens twice (the fall-back hour) is refused: either reading is a guess about a shift time.
// ---------------------------------------------------------------------------

const LONDON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function londonParts(ms: number) {
  const p = Object.fromEntries(LONDON.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
}

/** "2027-12-01", "08:00" -> "2027-12-01T08:00:00.000Z" (GMT) or ...T07:00 in BST. */
export function londonToUtc(date: string, hhmm: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isInteger)) throw new Error(`bad date/time ${date} ${hhmm}`);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall;
  for (let i = 0; i < 3; i++) t = wall - (londonParts(t) - t);
  if (londonParts(t) !== wall) throw new Error(`${date} ${hhmm} does not exist in London`);
  if (londonParts(t - 36e5) === wall || londonParts(t + 36e5) === wall) throw new Error(`${date} ${hhmm} happens twice in London`);
  return new Date(t).toISOString();
}

/**
 * UTC instant -> London wall clock, as {date: "YYYY-MM-DD", time: "HH:MM"}. A string with no zone is
 * UTC: OnSinch's audit rows write "2026-10-23 07:30:00", and `new Date` would read that in the
 * machine's zone (4 hours late on a New York box; test/zonelessIsUtc.ts).
 */
export function utcToLondon(iso: string): { date: string; time: string } {
  const zoned = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(iso) ? iso.replace(" ", "T") + "Z" : iso;
  const p = Object.fromEntries(LONDON.formatToParts(new Date(zoned)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** A shift's end, rolled to the next day when it is not after the start (22:00-02:00). */
export function shiftWindow(date: string, start: string, end: string): { beginning: string; end: string } {
  // A start equal to its end is no shift: read as overnight it became 24 hours. "Arrive for
  // 17:00 instead of 14:00" on a 14:00-17:00 call was planned 17:00-17:00 (R11029, 10-15).
  if (start === end) throw new Error(`a shift from ${start} to ${end} has no length`);
  const b = londonToUtc(date, start);
  let e = londonToUtc(date, end);
  if (Date.parse(e) <= Date.parse(b)) {
    const next = new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
    e = londonToUtc(next, end);
  }
  return { beginning: b, end: e };
}

/**
 * The builder's formats. Dates are written as the date picker rewrites them on blur
 * ("01.12.2027"), not as the server renders them ("1.12.2027"): measured 10-08, a filled
 * "1.12.2027" left the field as "01.12.2027", and the submission guard compares exactly.
 */
export const builderDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
export const builderTime = (hhmm: string) => { const [h, m] = hhmm.split(":"); return `${Number(h)}:${m}`; };

/** A London window as the builder's four date/time fields of one model; an overnight end gets the next day. */
export function windowFields(model: string, date: string, start: string, end: string): Record<string, string> {
  const w = shiftWindow(date, start, end);
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(w.end));
  return {
    [`data[${model}][beginning][date]`]: builderDate(date), [`data[${model}][beginning][time]`]: builderTime(start),
    [`data[${model}][end][date]`]: builderDate(endDate), [`data[${model}][end][time]`]: builderTime(end),
  };
}

/** The new-shift form: name, window, and its first position (plain Crew; see rowsFor). */
export function shiftCreateFields(op: Extract<Op, { kind: "add_shift" }>, first: PositionSpec): Record<string, string> {
  if (!Number.isInteger(first.size) || first.size < 1) throw new Error(`refusing size ${first.size}`);
  // "Not a concept" (0), as on the new-position form: left to the form's default, R11500's shift
  // added on 10-14 went in as a draft (slot 59716), the same miss fixed for positions on 10-13.
  return { "data[SlotTeam][name]": op.name, "data[SlotTeam][profession_id]": first.profession_id, "data[SlotTeam][size]": String(first.size), ...windowFields("SlotTeam", op.date, op.start, op.end), "data[SlotTeam][concept]": "0" };
}

/** The new-position form. Its window must be set: the form defaults to an unrelated day (10-08). */
export function positionCreateFields(date: string, start: string, end: string, p: PositionSpec): Record<string, string> {
  if (!Number.isInteger(p.size) || p.size < 1) throw new Error(`refusing size ${p.size}`);
  // "Not a concept" (0): the builder adds positions as concepts, which reads as a blank draft
  // beside staff's positions (10-13, R11534). Staff positions are concept 0 and hidden.
  return { "data[Slot][profession_id]": p.profession_id, "data[Slot][role]": String(apiRole(p)), "data[Slot][size]": String(p.size), ...windowFields("Slot", date, start, end), "data[Slot][concept]": "0" };
}

/** The builder fields an edit operation sets, by form. Nothing outside the contract's fill list. */
export function builderEdit(op: Op): { model: "Slot" | "Order"; id: number; set: Record<string, string> } {
  switch (op.kind) {
    case "set_position_size":
      if (!Number.isInteger(op.size) || op.size < 1) throw new Error(`refusing size ${op.size}`);
      return { model: "Slot", id: op.slot_id, set: { "data[Slot][size]": String(op.size) } };
    case "set_position_times":
      return { model: "Slot", id: op.slot_id, set: windowFields("Slot", op.date, op.start, op.end) };
    case "set_po":
      if (!/\d/.test(op.po)) throw new Error("refusing a PO with no digit in it");
      return { model: "Order", id: op.order_id, set: { "data[Order][intern_name]": op.po } };
    case "cancel_position":
      throw new Error("cancel_position is not benched yet");
    default:
      throw new Error(`${op.kind} is not a builder edit`);
  }
}

// ---------------------------------------------------------------------------
// The create wizard sends one GraphQL mutation, NewOrder. Its variables are checked against
// the operation before the request is allowed out: the UI can mis-pick a date, a dropdown
// option or a company, and this is the last place that can be caught for free.
// ---------------------------------------------------------------------------

export function checkNewOrder(vars: any, op: Extract<Op, { kind: "create_order" }>, clientUserId: string): string[] {
  const bad: string[] = [];
  const input = vars?.input;
  if (!input) return ["no input in NewOrder variables"];
  if (String(input.userId) !== clientUserId) bad.push(`client ${input.userId} != ${clientUserId} (${op.client_email})`);
  if (String(input.companyId) !== op.company_id) bad.push(`companyId ${input.companyId} != ${op.company_id}`);
  if ((input.internName ?? "") !== (op.po ?? "")) bad.push(`PO "${input.internName}" != "${op.po ?? ""}"`);
  if (input.quote !== false || input.provisional !== false) bad.push("quote/provisional set");
  const jobs = input.jobs ?? [];
  if (jobs.length !== 1) return [...bad, `${jobs.length} jobs, expected 1`];
  const shifts = jobs[0].shifts ?? [];
  if (shifts.length !== op.shifts.length) return [...bad, `${shifts.length} shifts, expected ${op.shifts.length}`];
  op.shifts.forEach((want, i) => {
    const got = shifts[i];
    const w = shiftWindow(want.date, want.start, want.end);
    const pos = (got.positions ?? []) as any[];
    if (pos.length !== want.positions.length) { bad.push(`shift ${i}: ${pos.length} positions, expected ${want.positions.length}`); return; }
    for (const [j, p] of pos.entries()) {
      if (Date.parse(p.beginning) !== Date.parse(w.beginning)) bad.push(`shift ${i} pos ${j}: begins ${p.beginning}, expected ${w.beginning}`);
      if (Date.parse(p.end) !== Date.parse(w.end)) bad.push(`shift ${i} pos ${j}: ends ${p.end}, expected ${w.end}`);
      if (String(p.location?.placeId) !== want.place_id) bad.push(`shift ${i} pos ${j}: place ${p.location?.placeId}, expected ${want.place_id}`);
      if (p.hidden !== true || p.concept !== true) bad.push(`shift ${i} pos ${j}: would be visible to staff`);
    }
    // Positions are compared as a set: the wizard's row order is not part of the booking.
    const sig = (size: unknown, prof: unknown, role: unknown) => `${Number(size)}|${String(prof)}|${String(role)}`;
    const sent = pos.map((p) => sig(p.size, p.professionId, p.role)).sort().join(" ");
    const asked = want.positions.map((p) => sig(p.size, p.profession_id, wizardRole(p))).sort().join(" ");
    if (sent !== asked) bad.push(`shift ${i}: positions ${sent}, expected ${asked}`);
  });
  return bad;
}
