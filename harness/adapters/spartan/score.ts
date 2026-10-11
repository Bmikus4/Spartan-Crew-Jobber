// ============================================================================
// One case, scored as 1-or-0 observations (Ben, 10-10). Accuracy nodes and invariants are
// separate: an invariant is a hard gate and is never averaged into accuracy.
// ============================================================================
import type { Observation } from "../../core/types";
import type { Op } from "../../../app/lib/v2/bot/ops";
import type { Recorded } from "../../../app/lib/v2/process";
import type { SpartanCase } from "./generate";

/** The fields that change what crew turn up where and when; cosmetic labels are left out. */
export function essentials(op: Op): Record<string, unknown> {
  switch (op.kind) {
    case "create_order": return { kind: op.kind, company_id: op.company_id, client_email: op.client_email, po: op.po ?? null,
      shifts: op.shifts.map((s) => ({ date: s.date, start: s.start, end: s.end, place_id: s.place_id, positions: s.positions })).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)) };
    case "set_position_times": return { kind: op.kind, order_id: op.order_id, slot_id: op.slot_id, date: op.date, start: op.start, end: op.end };
    case "set_position_size": return { kind: op.kind, order_id: op.order_id, slot_id: op.slot_id, size: op.size };
    case "set_po": return { kind: op.kind, order_id: op.order_id, po: op.po };
    case "cancel_position": return { kind: op.kind, order_id: op.order_id, slot_id: op.slot_id };
    case "add_shift": return { kind: op.kind, order_id: op.order_id, location_id: op.location_id, date: op.date, start: op.start, end: op.end, positions: op.positions };
    case "add_position": return { kind: op.kind, order_id: op.order_id, shift_id: op.shift_id, date: op.date, start: op.start, end: op.end, position: op.position };
  }
}
const canon = (ops: Op[]) => ops.map((o) => JSON.stringify(essentials(o))).sort();
export const sameOps = (a: Op[], b: Op[]) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const ALLOWED = new Set(["create_order", "set_position_size", "set_position_times", "set_po", "cancel_position", "add_shift", "add_position"]);
const FORBIDDEN_KEY = /price|wage|rate|pricelist|publish|confirm|approve/i;
const keysOf = (v: unknown): string[] => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

export type Outcome = { recorded: Recorded | null; written: Op[]; keys: string[]; error: string | null; ms: number };

export function said(r: Recorded | null): string {
  if (!r) return "no decision";
  const d = r.decision;
  return d.kind === "write" ? `write: ${d.why.join("; ")}` : d.kind === "handoff" ? `person: ${d.reasons.join("; ")}` : `none: ${d.reason}`;
}

export function score(c: SpartanCase, out: Outcome): Observation[] {
  const o = (node: string, ok: boolean, detail?: string): Observation => ({ case_id: c.id, branch: c.branch, node, ok: ok ? 1 : 0, ...(ok || !detail ? {} : { detail }) });
  const exp = c.expected;
  const kind = out.recorded?.kind ?? null;
  const opsRight = exp.kind !== "write" || sameOps(out.written, exp.ops);
  const intent = out.recorded?.interpretation?.extraction.intent ?? null;
  const orderCompany = new Map(c.input.orders.map((x) => [x.id, x.company_id]));
  const isolated = out.written.every((op) => op.kind === "create_order" ? c.input.company_id !== null && op.company_id === String(c.input.company_id) : c.input.company_id !== null && orderCompany.get(op.order_id) === c.input.company_id);
  const wrongWrite = out.written.length > 0 && !(exp.kind === "write" && opsRight);
  return [
    o("e2e", kind === exp.kind && opsRight, `expected ${exp.kind}${exp.kind === "write" ? ` ${JSON.stringify(canon(exp.ops))}` : ""}; got ${said(out.recorded)}${out.error ? ` (threw: ${out.error})` : ""}`),
    o("ai.intent", intent !== null && exp.intents.includes(intent), `intent ${intent ?? "none"}, expected ${exp.intents.join(" or ")}`),
    o("inv.no_wrong_write", !wrongWrite, `wrote ${JSON.stringify(canon(out.written))}`),
    o("inv.client_isolation", isolated, `a write outside company ${c.input.company_id}`),
    o("inv.no_double_write", new Set(out.keys).size === out.keys.length, "an operation key was sent twice"),
    o("inv.forbidden_fields", out.written.every((op) => ALLOWED.has(op.kind) && !keysOf(op).some((k) => FORBIDDEN_KEY.test(k))), "an operation outside the benched set or carrying a forbidden field"),
    o("inv.terminal_state", out.recorded !== null && out.error === null, out.error ?? "no recorded final state"),
    o("inv.five_minutes", out.ms <= 300_000, `${Math.round(out.ms / 1000)}s from receipt to final state`),
  ];
}
