// ============================================================================
// One operation, end to end: lease -> ledger intent -> read before write -> browser write
// -> read back through the API -> ledger verdict.
// ----------------------------------------------------------------------------
// The API is used only to read. Every write is made in the staff screens by the bot.
//
// A key the ledger has seen is never executed again, whatever its status. "unknown" in
// particular is final for the bot: the save may or may not have landed, and re-sending it
// is how a crew of 4 becomes 8. Reconciliation reads OnSinch and a person decides.
//
// Signed-on crew (Ben, 10-06): "Any change that touches a signed-on worker goes to ops."
// A position with anyone attending is handed over for any change except a size INCREASE,
// which adds seats and moves nobody.
// ============================================================================
import { httpTransport, OnsinchClient } from "../../engine/onsinch";
import contracts from "./contracts.json";
import type { Contract } from "./contract";
import { acquireLease, releaseLease, ledgerGet, ledgerIntent, ledgerSet, type LedgerStatus } from "./db";
import { apiRole, builderDate, builderEdit, opKey, positionCreateFields, rowsFor, shiftCreateFields, shiftWindow, utcToLondon, type Op, type PositionSpec } from "./ops";
import { openBot } from "./session";
import { cancelNode, createChild, editNode, type EditOutcome } from "./builder";
import { createOrder } from "./wizard";

export type RunResult = { op_key: string; status: LedgerStatus | "busy" | "seen"; reasons: string[]; detail?: Record<string, unknown> };

const CONTRACTS = contracts as unknown as Record<string, Contract>;

function api() {
  const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
  return { t, client: new OnsinchClient(t) };
}
const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);

export async function readOrder(orderId: number): Promise<any | null> {
  const { t } = api();
  const r = await t("GET", `/orders?id[eq]=${orderId}&with=Job__SlotTeam__Slot__SlotLocation`);
  if (r.status >= 400) throw new Error(`order read ${r.status}`);
  return rowsOf(r)[0] ?? null;
}

export const teamsOf = (o: any): { id: number; slots: any[] }[] =>
  ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []))
    .map((t: any) => ({ id: Number(t.id), slots: ([] as any[]).concat(t.Slot ?? []).filter((s: any) => s.cancelled !== true) }));

/** Does this set of live positions hold exactly these positions over this window? */
export function holdsPositions(slots: any[], date: string, start: string, end: string, want: PositionSpec[]): boolean {
  const w = shiftWindow(date, start, end);
  const sig = (b: string, e: string, size: unknown, prof: unknown, role: unknown) => `${Date.parse(b)}|${Date.parse(e)}|${Number(size)}|${String(prof)}|${Number(role ?? 0)}`;
  const got = slots.map((s) => sig(s.beginning, s.end, s.size, s.profession_id, s.role)).sort().join(" ");
  const asked = want.map((p) => sig(w.beginning, w.end, p.size, p.profession_id, apiRole(p))).sort().join(" ");
  return got === asked;
}

export const slotsOf = (o: any): any[] =>
  ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? [])).flatMap((s: any) => ([] as any[]).concat(s.Slot ?? []));

export async function attendingOn(orderId: number, slotId: number): Promise<number> {
  const rows = await api().client.liveTeamsForOrder(orderId);
  return rows.filter((r: any) => Number((Array.isArray(r?.Slot) ? r.Slot[0] : r?.Slot)?.id) === slotId).length;
}

/** What OnSinch must hold after the operation, as reasons it does not. Empty = verified. */
export function mismatches(op: Op, order: any): string[] {
  if (!order) return ["order no longer reads back"];
  if (op.kind === "set_po") return (order.intern_name ?? "") === op.po ? [] : [`PO reads "${order.intern_name}"`];
  if (op.kind === "create_order") return createMismatches(op, order);
  // An added shift is there when some shift holds exactly the asked positions over the asked
  // window; the same test, run first, stops a re-sent request from adding it twice.
  if (op.kind === "add_shift") return teamsOf(order).some((t) => holdsPositions(t.slots, op.date, op.start, op.end, op.positions)) ? [] : ["no shift holds the asked positions"];
  if (op.kind === "add_position") {
    const team = teamsOf(order).find((t) => t.id === op.shift_id);
    if (!team) return [`shift ${op.shift_id} not on the order`];
    return team.slots.some((s) => holdsPositions([s], op.date, op.start, op.end, [op.position])) ? [] : ["the shift holds no such position"];
  }
  const slot = slotsOf(order).find((s) => Number(s.id) === op.slot_id);
  if (!slot) return [`position ${op.slot_id} not on the order`];
  if (op.kind === "set_position_size") return Number(slot.size) === op.size ? [] : [`size reads ${slot.size}`];
  if (op.kind === "cancel_position") return slot.cancelled === true ? [] : ["position is not cancelled"];
  if (op.kind === "set_position_times") {
    const w = shiftWindow(op.date, op.start, op.end);
    const bad: string[] = [];
    if (Date.parse(slot.beginning) !== Date.parse(w.beginning)) bad.push(`begins ${slot.beginning}, expected ${w.beginning}`);
    if (Date.parse(slot.end) !== Date.parse(w.end)) bad.push(`ends ${slot.end}, expected ${w.end}`);
    return bad;
  }
  return [`no verification for ${(op as Op).kind}`];
}

function createMismatches(op: Extract<Op, { kind: "create_order" }>, order: any): string[] {
  const bad: string[] = [];
  if (String(order.company_id) !== op.company_id) bad.push(`company ${order.company_id}`);
  if ((order.intern_name ?? "") !== (op.po ?? "")) bad.push(`PO "${order.intern_name}"`);
  const teams = ([] as any[]).concat(order.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []));
  if (teams.length !== op.shifts.length) return [...bad, `${teams.length} shifts, expected ${op.shifts.length}`];
  const want = op.shifts.flatMap((s) => s.positions.map((p) => ({ ...shiftWindow(s.date, s.start, s.end), size: p.size, place: s.place_id, prof: p.profession_id, role: apiRole(p) })));
  const got = slotsOf(order).filter((s) => s.cancelled !== true);
  const key = (b: string, e: string, size: number, prof: string, role: number) => `${Date.parse(b)}|${Date.parse(e)}|${size}|${prof}|${role}`;
  const have = new Map<string, number>();
  for (const s of got) { const k = key(s.beginning, s.end, Number(s.size), String(s.profession_id), Number(s.role ?? 0)); have.set(k, (have.get(k) ?? 0) + 1); }
  for (const w of want) {
    const k = key(w.beginning, w.end, w.size, w.prof, w.role);
    if (!have.get(k)) bad.push(`no position ${w.beginning}..${w.end} x${w.size}`); else have.set(k, have.get(k)! - 1);
  }
  if (got.length !== want.length) bad.push(`${got.length} positions, expected ${want.length}`);
  if (got.some((s) => s.hidden !== true)) bad.push("a position is visible to staff");
  return bad;
}

/** The form fields an edit compares against OnSinch just before it submits, read through the API. */
export function liveFormValues(model: "Slot" | "Order", id: number, order: any): Record<string, string> {
  if (!order) return {};
  if (model === "Order") return { "data[Order][intern_name]": String(order.intern_name ?? "") };
  const slot = slotsOf(order).find((s) => Number(s.id) === id);
  if (!slot) return {};
  const b = utcToLondon(slot.beginning), e = utcToLondon(slot.end);
  return {
    "data[Slot][size]": String(slot.size),
    "data[Slot][beginning][date]": builderDate(b.date), "data[Slot][beginning][time]": b.time,
    "data[Slot][end][date]": builderDate(e.date), "data[Slot][end][time]": e.time,
  };
}

/** The database fields each edit may change, as OnSinch's audit names them. */
const AUDIT_FIELDS: Record<string, string[]> = { set_position_size: ["size"], set_position_times: ["beginning", "end"], set_po: ["intern_name"], cancel_position: ["cancelled"] };

async function auditPage(t: any, page?: number): Promise<{ rows: any[]; pageCount: number }> {
  const r = await t("GET", `/timelineAudits?action=common_change&limit=100&page=${page ?? 1}`);
  return { rows: (r.data?.data ?? []) as any[], pageCount: Number(r?.data?.pagination?.pageCount) };
}

/** The newest staff-edit audit id right now; rows after it belong to what happens next. */
export async function auditCursor(): Promise<number | null> {
  const { t } = api();
  const first = await auditPage(t);
  if (!Number.isInteger(first.pageCount) || first.pageCount < 1) return null;
  const last = first.pageCount === 1 ? first : await auditPage(t, first.pageCount);
  return last.rows.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) || null;
}

/**
 * OnSinch's own record of the save: every audit row by the bot's user on this record after
 * the cursor must change only the fields the operation names. The read-back says the value
 * is right; this says nothing else moved with it. Order rows are keyed by the R number,
 * other models by their id, so both are accepted as the record's name.
 */
async function auditExtras(model: string, ids: string[], cursor: number, allowed: string[]): Promise<string[] | null> {
  const { t } = api();
  const first = await auditPage(t);
  if (!Number.isInteger(first.pageCount) || first.pageCount < 1) return null;
  const extras: string[] = [];
  let rows = 0;
  for (let p = first.pageCount; p >= Math.max(1, first.pageCount - 1); p--) {
    const page = p === 1 ? first : await auditPage(t, p);
    for (const x of page.rows) {
      if (Number(x.id) <= cursor || Number(x.creator) !== BOT_USER) continue;
      let d: any; try { d = JSON.parse(x.data); } catch { continue; }
      if (d.model !== model || !ids.includes(String(d.id))) continue;
      rows++;
      for (const f of Object.keys(d.diffChanges?.[model] ?? {})) if (!allowed.includes(f) && !["modified", "modifier"].includes(f)) extras.push(f);
    }
  }
  return rows ? extras : null;
}

/** The OnSinch user the bot's login (and the old engine's API key) writes as. */
const BOT_USER = 2257;

/** Refusals that need no browser: the order, the position, signed-on crew, and TEST-only while benching. */
async function preflight(op: Op, order: any, testOnly: boolean): Promise<string[]> {
  if (op.kind === "create_order") return testOnly && op.company_id !== "515" ? ["bench mode: creates only on TEST 515"] : [];
  if (!order) return [`order ${op.order_id} not found`];
  if (testOnly && Number(order.company_id) !== 515) return ["bench mode: writes only on TEST 515"];
  if (op.kind === "set_po" || op.kind === "add_shift") return [];
  if (op.kind === "add_position") return teamsOf(order).some((t) => t.id === op.shift_id) ? [] : [`shift ${op.shift_id} is not on order ${op.order_id}`];
  const slot = slotsOf(order).find((s) => Number(s.id) === op.slot_id);
  if (!slot) return [`position ${op.slot_id} is not on order ${op.order_id}`];
  if (slot.cancelled === true && op.kind !== "cancel_position") return [`position ${op.slot_id} is cancelled`];
  const growOnly = op.kind === "set_position_size" && op.size > Number(slot.size);
  if (!growOnly) {
    const n = await attendingOn(op.order_id, op.slot_id);
    if (n > 0) return [`signed-on crew: ${n} on position ${op.slot_id}; ops must make this change`];
  }
  return [];
}

/** After a builder write: ledger the outcome, read the order back, check the audit row. */
async function finish(key: string, op: Op, out: EditOutcome, orderId: number, model: string, id: number, cursor: number): Promise<RunResult> {
  if (out.stage !== "submitted") {
    await ledgerSet(key, out.stage, { reasons: out.reasons });
    return { op_key: key, status: out.stage, reasons: out.reasons };
  }
  await ledgerSet(key, "submitted", { before: out.before, response: out.response as Record<string, unknown>, version_tier: out.verdict.tier });
  const after = await readOrder(orderId);
  const bad = mismatches(op, after);
  const names = model === "Order" ? [String(id), String(after?.number ?? "")] : [String(id)];
  const extras = await auditExtras(model, names, cursor, AUDIT_FIELDS[op.kind] ?? []);
  if (extras === null) bad.push("no audit row found for the save");
  else if (extras.length) bad.push(`audit shows other fields changed: ${[...new Set(extras)].join(", ")}`);
  await ledgerSet(key, bad.length ? "mismatch" : "verified", { readback: bad });
  return { op_key: key, status: bad.length ? "mismatch" : "verified", reasons: [...bad, ...out.verdict.reasons] };
}

export async function runOp(source: string, op: Op, opts: { testOnly: boolean } = { testOnly: true }): Promise<RunResult> {
  const key = opKey(source, op);
  const seen = await ledgerGet(key);
  if (seen) return { op_key: key, status: "seen", reasons: [`already ${seen.status}`], detail: seen.detail ?? undefined };
  if (!(await acquireLease(key, 240))) return { op_key: key, status: "busy", reasons: ["another operation holds the bot"] };
  // Before the browser opens nothing can have been sent, so a throw there is "blocked";
  // after it, the save may have gone out and only a read can say whether it landed.
  let phase: "pre" | "browser" = "pre";
  try {
    if (!(await ledgerIntent(key, source, op.kind, op))) return { op_key: key, status: "seen", reasons: ["raced"] };
    const orderId = op.kind === "create_order" ? null : op.order_id;
    const before = orderId ? await readOrder(orderId) : null;
    const refusals = await preflight(op, before, opts.testOnly);
    if (refusals.length) { await ledgerSet(key, "blocked", { reasons: refusals }); return { op_key: key, status: "blocked", reasons: refusals }; }
    if (op.kind === "create_order") {
      const bot = await openBot();
      phase = "browser";
      let out;
      try { out = await createOrder(bot, op); } finally { await bot.close(); }
      if (out.stage !== "submitted") { await ledgerSet(key, out.stage, { reasons: out.reasons }); return { op_key: key, status: out.stage, reasons: out.reasons }; }
      await ledgerSet(key, "submitted", { order_id: out.order_id, number: out.number, client_user_id: out.client_user_id, version: out.version });
      const created = await readOrder(out.order_id);
      const bad = mismatches(op, created);
      if (created && String(created.user_id) !== out.client_user_id) bad.push(`client reads ${created.user_id}, expected ${out.client_user_id}`);
      await ledgerSet(key, bad.length ? "mismatch" : "verified", { readback: bad });
      return { op_key: key, status: bad.length ? "mismatch" : "verified", reasons: bad, detail: { order_id: out.order_id, number: out.number } };
    }

    // Already true in OnSinch: nothing is sent. A save that changes nothing leaves no audit
    // row, so it could not be verified anyway, and it is a write that did not need to happen.
    if (mismatches(op, before).length === 0) {
      await ledgerSet(key, "verified", { noop: true });
      return { op_key: key, status: "verified", reasons: ["already so in OnSinch; nothing sent"] };
    }
    if (op.kind === "add_shift" || op.kind === "add_position") {
      const rows = op.kind === "add_shift" ? rowsFor(op.positions) : [op.position];
      if (!rows) { await ledgerSet(key, "blocked", { reasons: ["no plain Crew position for the new shift's first row"] }); return { op_key: key, status: "blocked", reasons: ["not benched"] }; }
      const bot = await openBot();
      phase = "browser";
      const steps: string[] = [];
      let out: EditOutcome;
      try {
        let shiftId = op.kind === "add_position" ? op.shift_id : 0;
        let todo = rows;
        if (op.kind === "add_shift") {
          const known = new Set(teamsOf(before).map((t) => t.id));
          out = await createChild(bot, CONTRACTS["builder.SlotTeam.create"], op.order_id, { model: "SlotLocation", id: op.location_id }, "Add shift", "SlotTeam", "data[SlotTeam][SlotLocation][id]", shiftCreateFields(op, rows[0]));
          steps.push(`shift: ${out.stage}`);
          if (out.stage === "submitted") {
            const fresh = teamsOf(await readOrder(op.order_id)).filter((t) => !known.has(t.id));
            if (fresh.length !== 1) out = { stage: "unknown", reasons: [`${fresh.length} new shifts appeared after the save`] };
            else shiftId = fresh[0].id;
          }
          todo = rows.slice(1);
        } else out = { stage: "submitted", before: {}, response: null, verdict: { tier: "ok", reasons: [] } };
        for (const p of todo) {
          if (out.stage !== "submitted") break;
          out = await createChild(bot, CONTRACTS["builder.Slot.create"], op.order_id, { model: "SlotTeam", id: shiftId }, "Add position", "Slot", "data[Slot][slotteam_id]", positionCreateFields(op.date, op.start, op.end, p));
          steps.push(`position ${p.profession_id}/${p.role ?? "staff"}: ${out.stage}`);
        }
      } finally { await bot.close(); }
      // A shift saved without its crew chief is a half-made change: it is reported as such,
      // never left looking like a refusal.
      const partial = op.kind === "add_shift" && steps[0] === "shift: submitted" && out.stage !== "submitted";
      if (out.stage !== "submitted" && !partial) { await ledgerSet(key, out.stage, { reasons: out.reasons, steps }); return { op_key: key, status: out.stage, reasons: out.reasons }; }
      const bad = mismatches(op, await readOrder(op.order_id));
      if (partial) bad.unshift(`stopped part-way: ${steps.join(", ")}`, ...("reasons" in out ? out.reasons : []));
      await ledgerSet(key, bad.length ? "mismatch" : "verified", { readback: bad, steps });
      return { op_key: key, status: bad.length ? "mismatch" : "verified", reasons: bad };
    }
    if (op.kind === "cancel_position") {
      const cursor = await auditCursor();
      if (cursor === null) { await ledgerSet(key, "blocked", { reasons: ["audit log unreadable"] }); return { op_key: key, status: "blocked", reasons: ["audit log unreadable"] }; }
      const bot = await openBot();
      phase = "browser";
      let out;
      try { out = await cancelNode(bot, op.order_id, "Slot", op.slot_id); } finally { await bot.close(); }
      return finish(key, op, out, op.order_id, "Slot", op.slot_id, cursor);
    }
    const edit = builderEdit(op);
    const contract = CONTRACTS[`builder.${edit.model}`];
    if (!contract) { await ledgerSet(key, "blocked", { reasons: [`no contract for builder.${edit.model}`] }); return { op_key: key, status: "blocked", reasons: ["no contract"] }; }
    const cursor = await auditCursor();
    if (cursor === null) { await ledgerSet(key, "blocked", { reasons: ["audit log unreadable: the write could not be verified"] }); return { op_key: key, status: "blocked", reasons: ["audit log unreadable"] }; }
    const bot = await openBot();
    phase = "browser";
    let out;
    const fresh = async () => liveFormValues(edit.model, edit.id, await readOrder(orderId!));
    try { out = await editNode(bot, contract, orderId!, edit.model, edit.id, edit.set, fresh); } finally { await bot.close(); }
    return finish(key, op, out, orderId!, edit.model, edit.id, cursor);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    const status = phase === "pre" ? "blocked" : "unknown";
    await ledgerSet(key, status, { error: msg }).catch(() => {});
    return { op_key: key, status, reasons: [msg] };
  } finally {
    await releaseLease(key).catch(() => {});
  }
}
