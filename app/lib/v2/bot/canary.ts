// ============================================================================
// The canary: walks every contracted surface on TEST without saving, and says whether
// OnSinch's screens still match what the bot was benched against.
// ----------------------------------------------------------------------------
// Ben, 10-06: "the harness needs to know when any UI changes were made so that it can [DECISIONS V3]
// update the protocol." Run daily and before any batch of live writes. A "block" means the
// bot must not write until the contract is re-benched; a "warn" (a version moved, the form
// did not) means a person looks before the next write.
//
// It makes its own bench order on TEST - Eventz each run, through the API, and deletes it
// after. It read a standing bench order (R11463) until 10-15, when that order was cleared as
// test data and every surface reported "bench node not found": a check must not depend on a
// record that something else is allowed to remove.
// ============================================================================
import contracts from "./contracts.json";
import { checkContract, type Contract, type Verdict } from "./contract";
import { openNode, openCreateForm, harvestFields } from "./builder";
import { openBot, versionSignals, BASE, activeRole, AGENCY_ROLE_LABEL } from "./session";
import { WIZARD_HOOKS } from "./wizard";
import { httpTransport, OnsinchClient } from "../../onsinch/onsinch";
import { shiftWindow } from "./ops";
import { readRows } from "../read";

/** A one-shift TEST order the canary can walk; made, read back for its node ids, deleted after. */
async function benchOrder(): Promise<{ order: number; slot: number; shift: number; location: number; drop: () => Promise<void> }> {
  const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
  const client = new OnsinchClient(t);
  const w = shiftWindow("2027-12-31", "08:00", "12:00");
  const made: any = await client.createOrder([{ name: "CANARY - safe to delete", company_id: 515, user_id: 1591, order_manager_id: 2257, request_approval: true, Job: { name: "CANARY", pricelist_category_id: 354 }, SlotTeam: [{ name: "Crew", profession_id: 1, beginning: w.beginning, end: w.end, size: 1, place_id: 5 }] } as any]);
  const order = Number(made.id);
  const drop = async () => { await client.deleteOrders([order]).catch(() => {}); };
  const o = (await readRows(t, `/orders?id[eq]=${order}&with=Job__SlotTeam__Slot`))[0];
  const team = ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []))[0];
  const slot = ([] as any[]).concat(team?.Slot ?? [])[0];
  if (!team || !slot) { await drop(); throw new Error("the canary's bench order read back without its shift"); }
  return { order, slot: Number(slot.id), shift: Number(team.id), location: Number(slot.slotlocation_id), drop };
}
const C = contracts as unknown as Record<string, Contract>;

export type CanaryResult = { tier: Verdict["tier"]; surfaces: { surface: string; tier: Verdict["tier"]; reasons: string[] }[]; role: string; at: string };

const worst = (ts: Verdict["tier"][]) => (ts.includes("block") ? "block" : ts.includes("warn") ? "warn" : "ok");

export async function runCanary(): Promise<CanaryResult> {
  const BENCH = await benchOrder();
  const bot = await openBot().catch(async (e) => { await BENCH.drop(); throw e; });
  const surfaces: CanaryResult["surfaces"] = [];
  try {
    const role = await activeRole(bot.page);
    for (const [surface, model, id] of [["builder.Slot", "Slot", BENCH.slot], ["builder.Order", "Order", BENCH.order]] as const) {
      const sel = await openNode(bot.page, BENCH.order, model, id);
      if (!sel) { surfaces.push({ surface, tier: "block", reasons: [`bench node ${model}:${id} not found on order ${BENCH.order}`] }); continue; }
      const v = checkContract(C[surface], { version: await versionSignals(bot.page), fields: await harvestFields(bot.page, sel) });
      surfaces.push({ surface, tier: v.tier, reasons: v.reasons });
    }
    // The create forms open unsaved from the context menu; nothing is saved here either.
    for (const [surface, parent, menu, model, field] of [
      ["builder.SlotTeam.create", { model: "SlotLocation", id: BENCH.location }, "Add shift", "SlotTeam", "data[SlotTeam][SlotLocation][id]"],
      ["builder.Slot.create", { model: "SlotTeam", id: BENCH.shift }, "Add position", "Slot", "data[Slot][slotteam_id]"],
    ] as const) {
      const sel = await openCreateForm(bot.page, BENCH.order, parent, menu, model, field);
      if (!sel) { surfaces.push({ surface, tier: "block", reasons: [`"${menu}" did not open a new ${model} form`] }); continue; }
      const v = checkContract(C[surface], { version: await versionSignals(bot.page), fields: await harvestFields(bot.page, sel) });
      surfaces.push({ surface, tier: v.tier, reasons: v.reasons });
    }
    await bot.page.goto(`${BASE}/admin/jobs/add`, { waitUntil: "networkidle" });
    const reasons: string[] = [];
    const sig = await versionSignals(bot.page);
    if (sig.bundle !== C.wizard.version.bundle) reasons.push(`version bundle: ${C.wizard.version.bundle} -> ${sig.bundle}`);
    for (const h of WIZARD_HOOKS.job) if ((await bot.page.locator(`[data-cy="${h}"]`).count()) === 0) reasons.push(`hook gone: ${h}`);
    const hookGone = reasons.some((r) => r.startsWith("hook"));
    surfaces.push({ surface: "wizard", tier: hookGone ? "block" : reasons.length ? "warn" : "ok", reasons });
    if (role !== AGENCY_ROLE_LABEL) surfaces.push({ surface: "role", tier: "block", reasons: [`active role "${role}"`] });
    if (bot.alarms.length) surfaces.push({ surface: "page", tier: "block", reasons: bot.alarms });
    return { tier: worst(surfaces.map((s) => s.tier)), surfaces, role, at: new Date().toISOString() };
  } finally {
    await bot.close();
    await BENCH.drop();
  }
}
