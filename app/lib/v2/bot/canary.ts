// ============================================================================
// The canary: walks every contracted surface on TEST without saving, and says whether
// OnSinch's screens still match what the bot was benched against.
// ----------------------------------------------------------------------------
// Ben, 10-06: "the harness needs to know when any UI changes were made so that it can
// update the protocol." Run daily and before any batch of live writes. A "block" means the
// bot must not write until the contract is re-benched; a "warn" (a version moved, the form
// did not) means a person looks before the next write.
//
// It reads the TEST bench order R11463 (#16514, position 59383). If that order is gone the
// canary says so rather than inventing another target.
// ============================================================================
import contracts from "./contracts.json";
import { checkContract, type Contract, type Verdict } from "./contract";
import { openNode, openCreateForm, harvestFields } from "./builder";
import { openBot, versionSignals, BASE, activeRole, AGENCY_ROLE_LABEL } from "./session";
import { WIZARD_HOOKS } from "./wizard";

export const BENCH = { order: 16514, slot: 59383, shift: 42275, location: 17253 };
const C = contracts as unknown as Record<string, Contract>;

export type CanaryResult = { tier: Verdict["tier"]; surfaces: { surface: string; tier: Verdict["tier"]; reasons: string[] }[]; role: string; at: string };

const worst = (ts: Verdict["tier"][]) => (ts.includes("block") ? "block" : ts.includes("warn") ? "warn" : "ok");

export async function runCanary(): Promise<CanaryResult> {
  const bot = await openBot();
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
  }
}
