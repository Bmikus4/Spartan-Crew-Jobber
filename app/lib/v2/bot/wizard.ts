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
// Benched: any number of shifts, each with a Crew staff-member position (the wizard's
// default first row) plus further positions added through ADD POSITION by profession, with
// the Crew chief role where asked. A shift with no plain Crew position is refused before
// the browser opens: changing the first row's profession is not benched.
// ============================================================================
import type { Locator, Page } from "playwright-core";
import { BASE, versionSignals, type Bot } from "./session";
import { checkNewOrder, rowsFor, wizardRole, type Op } from "./ops";
import type { VersionSignals } from "./contract";

type CreateOp = Extract<Op, { kind: "create_order" }>;

export type CreateOutcome =
  | { stage: "blocked"; reasons: string[] }
  | { stage: "failed"; reasons: string[] }
  | { stage: "unknown"; reasons: string[] }
  | { stage: "submitted"; order_id: number; number: string; client_user_id: string; version: VersionSignals };

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
export function unbenched(op: CreateOp): string[] {
  const out: string[] = [];
  op.shifts.forEach((s, i) => {
    if (!s.positions.length) out.push(`shift ${i}: no positions`);
    else if (!rowsFor(s.positions)) out.push(`shift ${i}: no plain Crew position for the first row (not benched)`);
    for (const p of s.positions) if (!Number.isInteger(p.size) || p.size < 1) out.push(`shift ${i}: size ${p.size}`);
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
    // Profession names come from the wizard's own list, so a renamed profession is matched
    // by id and never by a name remembered here.
    const professions = new Map<string, string>();
    const clients = new Map<string, string>();
    page.on("response", async (r) => {
      if (!r.url().includes("/admin/graphQLApi/entry")) return;
      try {
        const j = await r.json();
        for (const p of j?.data?.professions ?? []) professions.set(String(p.id), String(p.name).trim());
        for (const c of j?.data?.company?.clients ?? []) clients.set(String(c.email ?? "").trim().toLowerCase(), String(c.id));
      } catch {}
    });
    await page.goto(`${BASE}/admin/jobs/add`, { waitUntil: "networkidle" });
    const version = await versionSignals(page);
    const gone1 = await missingHooks(page, WIZARD_HOOKS.job);
    if (gone1.length) return { stage: "blocked", reasons: ["wizard changed: protocol update needed", ...gone1] };

    const company = await pickOption(page, page.locator('[data-cy="companyNameInput"]'), op.company_name, new RegExp(`^${escape(op.company_name)}$`));
    if (company) return { stage: "blocked", reasons: [`company: ${company}`] };
    // The client is the person who asked, matched by email among the company's contacts.
    // A sender who is not a contact is a human decision (a new contact, or a forward).
    const email = op.client_email.trim().toLowerCase();
    const clientUserId = clients.get(email);
    if (!clientUserId) return { stage: "blocked", reasons: [`${op.client_email} is not a contact of ${op.company_name}`] };
    const clientBox = page.locator('input[role="combobox"][placeholder="Select client"]');
    if ((await clientBox.count()) !== 1) return { stage: "blocked", reasons: ["client picker not found"] };
    if (!(await clientBox.inputValue()).toLowerCase().endsWith(`(${email})`)) {
      const c = await pickOption(page, clientBox, op.client_email, new RegExp(`\\(${escape(email)}\\)$`, "i"));
      if (c) return { stage: "blocked", reasons: [`client: ${c}`] };
    }
    await page.fill('[data-cy="jobNameInput"]', op.job_name);
    if (op.po) await page.fill('input[name="Order.internName"]', op.po);
    await page.click('[data-cy="nextStepShiftsButton"]');
    await page.locator('[data-cy="shiftNameInput"]').waitFor({ timeout: 20000 });
    const gone2 = await missingHooks(page, WIZARD_HOOKS.shifts);
    if (gone2.length) return { stage: "blocked", reasons: ["wizard changed: protocol update needed", ...gone2] };

    for (let i = 0; i < op.shifts.length; i++) {
      const s = op.shifts[i];
      if (i > 0) {
        await page.click('[data-cy="addShiftButton"]'); await page.waitForTimeout(800);
        // ADD SHIFT copies the previous shift's positions (measured 10-08: a Crew + Crew
        // Chief shift gave a new shift both rows). Back to the single default row first.
        const rowsNow = () => page.locator(`input[name^="Shift.${i}.positions."][name$=".size"]`).count();
        for (let n = await rowsNow(); n > 1; n = await rowsNow()) {
          await page.locator('[data-cy="postionActionMenu"]').nth(n - 1).click();
          const remove = page.locator('[role="menuitem"]').filter({ hasText: /^Remove$/ });
          if ((await remove.count()) !== 1) return { stage: "blocked", reasons: [`shift ${i}: no Remove in the position menu`] };
          await remove.click();
          // The wizard's own confirm, not a browser dialog. Confirmed only when it says
          // exactly what Remove is expected to ask; anything else stops the create.
          const dialog = page.locator('[role="dialog"]').filter({ hasText: "Do you really want to delete this record?" });
          await dialog.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
          const confirm = dialog.locator("button").filter({ hasText: /^confirm$/i });
          if ((await confirm.count()) !== 1) return { stage: "blocked", reasons: [`shift ${i}: unexpected confirmation when removing a copied position`] };
          await confirm.click(); await page.waitForTimeout(500);
          if ((await rowsNow()) !== n - 1) return { stage: "blocked", reasons: [`shift ${i}: removing a copied position did not take`] };
        }
      }
      await page.fill('[data-cy="shiftNameInput"]', s.name);
      const start = page.locator('[data-cy="shiftStartTime"]'), end = page.locator('[data-cy="shiftEndTime"]');
      const endDate = Date.parse(`${s.date}T${s.end}`) > Date.parse(`${s.date}T${s.start}`) ? s.date : new Date(Date.parse(`${s.date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
      const problems = [await pickDate(page, start, s.date), await setTime(page, start, s.start), await pickDate(page, end, endDate), await setTime(page, end, s.end)].filter(Boolean) as string[];
      if (problems.length) return { stage: "blocked", reasons: [`shift ${i}`, ...problems] };
      // OnSinch searches places by name, so the name part is typed and the option is matched on the full label.
      const loc = await pickOption(page, page.locator('[data-cy="shiftLocationInput"]'), s.place_label.split(",")[0].trim(), new RegExp(`^${escape(s.place_label)}`));
      if (loc) return { stage: "blocked", reasons: [`shift ${i} venue: ${loc}`] };
      const rows = rowsFor(s.positions)!;
      for (let j = 0; j < rows.length; j++) {
        const p = rows[j];
        if (j > 0) {
          const name = professions.get(p.profession_id);
          if (!name) return { stage: "blocked", reasons: [`shift ${i}: profession ${p.profession_id} is not in the wizard's list`] };
          await page.getByRole("button", { name: /^add position$/i }).click();
          const opt = page.locator('[data-cy="addPostionOption"]').filter({ hasText: new RegExp(`^\\s*${escape(name)}\\s*$`) });
          if ((await opt.count()) !== 1) return { stage: "blocked", reasons: [`shift ${i}: ${await opt.count()} "${name}" options in ADD POSITION`] };
          await opt.click(); await page.waitForTimeout(500);
        }
        const size = page.locator(`input[name="Shift.${i}.positions.${j}.size"]`);
        if ((await size.count()) !== 1) return { stage: "blocked", reasons: [`shift ${i}: position ${j} size input not found`] };
        await size.fill(String(p.size)); await page.keyboard.press("Tab");
        if (wizardRole(p) !== "WORKER") {
          await page.locator(`[id="mui-component-select-Shift.${i}.positions.${j}.role"]`).click();
          const role = page.locator(`[role="option"][data-value="${wizardRole(p)}"]`);
          if ((await role.count()) !== 1) return { stage: "blocked", reasons: [`shift ${i}: role ${wizardRole(p)} not offered`] };
          await role.click(); await page.waitForTimeout(300);
        }
      }
    }
    if (bot.alarms.length) return { stage: "blocked", reasons: ["page raised", ...bot.alarms] };

    const guard: string[] = [];
    await page.route((u) => u.pathname === "/admin/graphQLApi/entry", async (route) => {
      let body: any = null;
      try { body = JSON.parse(route.request().postData() ?? ""); } catch {}
      if (body?.operationName !== "NewOrder") return route.continue();
      const bad = checkNewOrder(body.variables, op, clientUserId);
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
    return { stage: "submitted", order_id: Number(r.payload.id), number: String(r.payload.number), client_user_id: clientUserId, version };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    return sent.yes ? { stage: "unknown", reasons: [`after NewOrder was sent: ${msg}`] } : { stage: "blocked", reasons: [`bot error before submit: ${msg}`] };
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
