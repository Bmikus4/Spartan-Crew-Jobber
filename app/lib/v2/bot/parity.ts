// ============================================================================
// Create parity: the old engine's orders replayed through the rebuild's writer.
// ----------------------------------------------------------------------------
// The old engine (v1) posted a whole order to the API, one SlotTeam per block per profession,
// a crew chief as his own block. The rebuild (v2) posts each shift with its plain crew and adds
// every other position inside that shift through the browser builder, as staff build it. What
// the client booked must come out the same either way: the same people, of the same trades,
// at the same venue, over the same hours. That is what `content` compares; how it is grouped
// into SlotTeams is allowed to differ, and is reported, never hidden.
// ============================================================================
import { shiftWindow, utcToLondon, type Op, type PositionSpec } from "./ops";
import { firstRow } from "./apiCreate";

type CreateOp = Extract<Op, { kind: "create_order" }>;
export type V1Team = { name?: string; beginning: string; end: string; place_id: number; profession_id: number; size: number; description?: string };
export type V1Shape = { name?: string; job_name?: string; company_id: number; user_id?: number; pricelist_category_id?: number; specification?: string; intern_name?: string; order_manager_id?: number; slot_teams: V1Team[] };

export const CHIEF = 36;

/** One booked position, as both versions must produce it: window, venue, trade, headcount. */
export const sig = (beginning: string, end: string, place: unknown, profession: unknown, size: unknown) =>
  `${new Date(beginning).toISOString()}|${new Date(end).toISOString()}|${Number(place)}|${Number(profession)}|${Number(size)}`;

/** A London wall-clock window moved by whole years, so a replay never lands on a real day. */
export function retime(beginning: string, end: string, years: number) {
  const b = utcToLondon(new Date(beginning).toISOString());
  const e = utcToLondon(new Date(end).toISOString());
  const date = `${Number(b.date.slice(0, 4)) + years}${b.date.slice(4)}`;
  return { date, start: b.time, end: e.time, window: shiftWindow(date, b.time, e.time) };
}

export function contentOfV1(shape: V1Shape, years = 0): string[] {
  return shape.slot_teams.map((t) => {
    const w = years ? retime(t.beginning, t.end, years).window : { beginning: t.beginning, end: t.end };
    return sig(w.beginning, w.end, t.place_id, t.profession_id, t.size);
  }).sort();
}

/** The same booking as a rebuild create: one shift per window and venue, every v1 block a position in it. */
export function opFromV1(shape: V1Shape, o: { company_id: string; client_email: string; years: number }): CreateOp {
  const groups = new Map<string, V1Team[]>();
  for (const t of shape.slot_teams) {
    const k = `${new Date(t.beginning).toISOString()}|${new Date(t.end).toISOString()}|${t.place_id}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const shifts = [...groups.values()].map((ts) => {
    const r = retime(ts[0].beginning, ts[0].end, o.years);
    const positions: PositionSpec[] = ts.map((t) => (t.profession_id === CHIEF ? { size: t.size, profession_id: String(CHIEF), role: "crew_chief" as const } : { size: t.size, profession_id: String(t.profession_id) }));
    const crew = ts.find((t) => t.profession_id === 1) ?? ts.find((t) => t.profession_id !== CHIEF) ?? ts[0];
    return { name: crew.name || "Crew", date: r.date, start: r.start, end: r.end, place_id: String(ts[0].place_id), place_label: "", positions, ...(crew.description ? { description: crew.description } : {}) };
  });
  return { kind: "create_order", company_id: o.company_id, company_name: "", client_email: o.client_email, job_name: shape.name ?? "", po: shape.intern_name, specification: shape.specification, shifts };
}

/** What the rebuild's writer will have made once the create and its builder steps are done. */
export function contentOfOp(op: CreateOp): { content: string[]; cannot?: string } {
  const out: string[] = [];
  for (const [i, s] of op.shifts.entries()) {
    if (!firstRow(s)) return { content: [], cannot: `shift ${i}: only a crew chief, so no position to make the shift with` };
    const w = shiftWindow(s.date, s.start, s.end);
    for (const p of s.positions) out.push(sig(w.beginning, w.end, s.place_id, p.profession_id, p.size));
  }
  return { content: out.sort() };
}

/** The booked content of an order as OnSinch holds it. */
export function contentOfOrder(order: any): string[] {
  const out: string[] = [];
  for (const j of ([] as any[]).concat(order?.Job ?? []))
    for (const t of ([] as any[]).concat(j.SlotTeam ?? []))
      for (const s of ([] as any[]).concat(t.Slot ?? [])) {
        if (s.cancelled === true) continue;
        const place = s.SlotLocation?.place_id ?? ([] as any[]).concat(s.SlotLocation ?? [])[0]?.place_id ?? t.place_id;
        out.push(sig(s.beginning, s.end, place, s.profession_id, s.size));
      }
  return out.sort();
}

/** How an order is laid out, beside what it books: the part the two versions may differ in. */
export function layoutOf(order: any) {
  const job = ([] as any[]).concat(order?.Job ?? [])[0] ?? {};
  const teams = ([] as any[]).concat(job.SlotTeam ?? []);
  const slots = teams.flatMap((t: any) => ([] as any[]).concat(t.Slot ?? []).filter((s: any) => s.cancelled !== true).map((s: any) => ({ ...s, team: t })));
  const chiefs = slots.filter((s: any) => Number(s.profession_id) === CHIEF);
  return {
    teams: teams.length,
    chief_inside: chiefs.filter((c: any) => ([] as any[]).concat(c.team.Slot ?? []).some((s: any) => Number(s.profession_id) !== CHIEF)).length,
    chief_alone: chiefs.filter((c: any) => ([] as any[]).concat(c.team.Slot ?? []).every((s: any) => Number(s.profession_id) === CHIEF)).length,
    chief_role_flag: chiefs.filter((c: any) => Number(c.role) === 1).length,
    hidden: slots.filter((s: any) => s.hidden === true || s.team.hidden === true).length,
    concept: slots.filter((s: any) => s.concept === true).length,
    slots: slots.length,
  };
}
