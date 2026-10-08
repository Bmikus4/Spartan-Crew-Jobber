// ============================================================================
// Creates through the new-job wizard (/admin/jobs/add): Job -> Shifts -> "OPEN IN BUILDER".
// ----------------------------------------------------------------------------
// "OPEN IN BUILDER" saves the order with every position hidden and in concept (measured on
// R11463: hidden=true, concept=true), which is what ops do before staffing. The two publish
// buttons beside it announce the job to workers; the bot never clicks them, and the
// mutation check refuses any position that would be visible.
//
// The wizard posts one GraphQL mutation, NewOrder. It is intercepted and checked against
// the operation (company, PO, every position's start, end, size, profession, venue) and
// aborted on any difference, so a mis-picked calendar day or dropdown option never lands.
//
// Benched: one or more shifts, each with ONE position of the default profession (Crew).
// More positions per shift, other professions and the Crew Chief role are not benched yet
// and are refused before the browser opens.
// ============================================================================
import type { Locator, Page } from "playwright-core";
import { BASE, versionSignals, type Bot } from "./session";
import { checkNewOrder, type Op } from "./ops";
import type { VersionSignals } from "./contract";

type CreateOp = Extract<Op, { kind: "create_order" }>;

export type CreateOutcome =
  | { stage: "blocked"; reasons: string[] }
  | { stage: "failed"; reasons: string[] }
  | { stage: "unknown"; reasons: string[] }
  | { stage: "submitted"; order_id: number; number: string; version: VersionSignals };

/** The wizard renders only the current step, so each step's hooks are checked on that step. */
export const WIZARD_HOOKS = {
  job: ["companyNameInput", "jobNameInput", "pricelistSelectInput", "nextStepShiftsButton"],
  shifts: ["shiftNameInput", "shiftStartTime", "shiftEndTime", "shiftLocationInput", "addShiftButton", "nextStepOverviewButton", "publishJobButton", "publishAndAnnounceButton"],
};

async function missingHooks(page: Page, hooks: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const h of hooks) if ((await page.locator(`[data-cy="${h}"]`).count()) === 0) out.push(`hook gone: ${h}`);
  return out;
}
const DEFAULT_PROFESSION = "1";

export function unbenched(op: CreateOp): string[] {
  const out: string[] = [];
  op.shifts.forEach((s, i) => {
    if (s.positions.length !== 1) out.push(`shift ${i}: ${s.positions.length} positions (benched: 1)`);
    for (const p of s.positions) {
      if (p.profession_id !== DEFAULT_PROFESSION) out.push(`shift ${i}: profession ${p.profession_id} not benched`);
      if (p.role) out.push(`shift ${i}: role ${p.role} not benched`);
    }
  });
  return out;
}

async function pickOption(page: Page, input: Locator, typed: string, exact: RegExp): Promise<string | null> {
  await input.click();
  await page.keyboard.type(typed, { delay: 25 });
  await page.waitForTimeout(1500);
  const options = page.locator('[data-cy^="dropdownOption-"]').filter({ hasText: exact });
  const n = await options.count();
  if (n !== 1) return `${n} options match ${exact} for "${typed}"`;
  await options.first().click();
  await page.waitForTimeout(800);
  return null;
}

async function pickDate(page: Page, field: Locator, iso: string): Promise<string | null> {
  const [y, m, d] = iso.split("-").map(Number);
  const want = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  const input = field.locator('input[placeholder="DD/MM/YYYY"]');
  const ts = await page.evaluate(([y, m, d]) => new Date(y, m - 1, d).getTime(), [y, m, d]);
  for (let attempt = 0; attempt < 2; attempt++) {
    await input.click();
    const cal = page.locator(".MuiDateCalendar-root");
    await cal.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 40; i++) {
      const day = cal.locator(`button[data-timestamp="${ts}"]`);
      if (await day.count()) { await day.click(); break; }
      await page.locator('button[aria-label="Next month"]').first().click();
      await page.waitForTimeout(200);
    }
    await cal.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    if ((await input.inputValue()) === want) return null;
    await page.keyboard.press("Escape");
  }
  return `date reads ${await input.inputValue()}, wanted ${want}`;
}

async function setTime(page: Page, field: Locator, hhmm: string): Promise<string | null> {
  const t = field.locator('[data-cy="time-input"]');
  await t.click(); await t.fill(hhmm); await page.keyboard.press("Tab"); await page.waitForTimeout(150);
  const got = await t.inputValue();
  return got === hhmm ? null : `time reads ${got}, wanted ${hhmm}`;
}

export async function createOrder(bot: Bot, op: CreateOp): Promise<CreateOutcome> {
  const { page } = bot;
  const sent = { yes: false };
  try {
    const bad = unbenched(op);
    if (bad.length) return { stage: "blocked", reasons: bad };
    await page.goto(`${BASE}/admin/jobs/add`, { waitUntil: "networkidle" });
    const version = await versionSignals(page);
    const gone1 = await missingHooks(page, WIZARD_HOOKS.job);
    if (gone1.length) return { stage: "blocked", reasons: ["wizard changed: protocol update needed", ...gone1] };

    const company = await pickOption(page, page.locator('[data-cy="companyNameInput"]'), op.company_name, new RegExp(`^${escape(op.company_name)}$`));
    if (company) return { stage: "blocked", reasons: [`company: ${company}`] };
    await page.fill('[data-cy="jobNameInput"]', op.job_name);
    if (op.po) await page.fill('input[name="Order.internName"]', op.po);
    await page.click('[data-cy="nextStepShiftsButton"]');
    await page.locator('[data-cy="shiftNameInput"]').waitFor({ timeout: 20000 });
    const gone2 = await missingHooks(page, WIZARD_HOOKS.shifts);
    if (gone2.length) return { stage: "blocked", reasons: ["wizard changed: protocol update needed", ...gone2] };

    for (let i = 0; i < op.shifts.length; i++) {
      const s = op.shifts[i];
      if (i > 0) { await page.click('[data-cy="addShiftButton"]'); await page.waitForTimeout(800); }
      await page.fill('[data-cy="shiftNameInput"]', s.name);
      const start = page.locator('[data-cy="shiftStartTime"]'), end = page.locator('[data-cy="shiftEndTime"]');
      const endDate = Date.parse(`${s.date}T${s.end}`) > Date.parse(`${s.date}T${s.start}`) ? s.date : new Date(Date.parse(`${s.date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
      const problems = [await pickDate(page, start, s.date), await setTime(page, start, s.start), await pickDate(page, end, endDate), await setTime(page, end, s.end)].filter(Boolean) as string[];
      if (problems.length) return { stage: "blocked", reasons: [`shift ${i}`, ...problems] };
      // OnSinch searches places by name, so the name part is typed and the option is matched on the full label.
      const loc = await pickOption(page, page.locator('[data-cy="shiftLocationInput"]'), s.place_label.split(",")[0].trim(), new RegExp(`^${escape(s.place_label)}`));
      if (loc) return { stage: "blocked", reasons: [`shift ${i} venue: ${loc}`] };
      const size = page.locator(`input[name="Shift.${i}.positions.0.size"]`);
      if ((await size.count()) !== 1) return { stage: "blocked", reasons: [`shift ${i}: position size input not found`] };
      await size.fill(String(s.positions[0].size)); await page.keyboard.press("Tab");
    }
    if (bot.alarms.length) return { stage: "blocked", reasons: ["page raised", ...bot.alarms] };

    const guard: string[] = [];
    await page.route((u) => u.pathname === "/admin/graphQLApi/entry", async (route) => {
      let body: any = null;
      try { body = JSON.parse(route.request().postData() ?? ""); } catch {}
      if (body?.operationName !== "NewOrder") return route.continue();
      const bad = checkNewOrder(body.variables, op);
      if (bad.length) { guard.push(...bad); return route.abort(); }
      sent.yes = true;
      return route.continue();
    });
    const answer = page.waitForResponse(async (r) => {
      if (!r.url().includes("/admin/graphQLApi/entry") || r.request().method() !== "POST") return false;
      try { return JSON.parse(r.request().postData() ?? "")?.operationName === "NewOrder"; } catch { return false; }
    }, { timeout: 45000 }).catch(() => null);
    const button = page.getByRole("button", { name: /^open in builder$/i });
    if ((await button.count()) !== 1) return { stage: "blocked", reasons: [`${await button.count()} "open in builder" buttons`] };
    if (/publish/i.test((await button.getAttribute("data-cy")) ?? "")) return { stage: "blocked", reasons: ["the builder button is a publish control"] };
    await button.click();
    const res = await answer;
    if (guard.length) return { stage: "blocked", reasons: ["NewOrder refused before sending", ...guard] };
    if (!res) return sent.yes ? { stage: "unknown", reasons: ["NewOrder sent, no answer within 45s"] } : { stage: "blocked", reasons: ["NewOrder was never sent (form validation?)"] };
    let j: any = null;
    try { j = await res.json(); } catch { return { stage: "unknown", reasons: [`NewOrder answered ${res.status()} with no JSON`] }; }
    const r = j?.data?.createOrder;
    if (r?.result !== true || !r?.payload?.id) return { stage: "failed", reasons: [JSON.stringify(j?.errors ?? r?.messages ?? j).slice(0, 300)] };
    return { stage: "submitted", order_id: Number(r.payload.id), number: String(r.payload.number), version };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    return sent.yes ? { stage: "unknown", reasons: [`after NewOrder was sent: ${msg}`] } : { stage: "blocked", reasons: [`bot error before submit: ${msg}`] };
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
