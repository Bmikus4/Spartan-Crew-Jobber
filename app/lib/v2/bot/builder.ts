// ============================================================================
// Edits through the order builder (/admin/orders/builder/<order id>), the screen ops use.
// ----------------------------------------------------------------------------
// Every node of the tree (Order, Job, SlotLocation, SlotTeam = shift, Slot = position) opens
// its own CakePHP form, `#<Model>BuilderForm`. Saving posts it (multipart, AJAX) to
// `?model=<Model>&ajax=save_node&...` and OnSinch answers JSON {result, message, warnings}:
// a positive success signal, so nothing here infers success from the absence of an error.
//
// The request is built by the page's own script and checked twice before it leaves:
// once from the form's values after filling, once from the actual request body in flight.
// Both must show that only the intended fields (and the contract's declared derived ones)
// moved. Edit forms resend every field, so a stale value elsewhere on the form would
// otherwise be written back silently.
// ============================================================================
import type { Page } from "playwright-core";
import { BASE, activeRole, AGENCY_ROLE_LABEL, versionSignals, type Bot } from "./session";
import { asMap, canonical, checkContract, parseBody, unexpectedChanges, type Contract, type FieldShape, type Pairs, type Verdict } from "./contract";

/** OnSinch's current values for some of the form's fields, read through the API just before submit. */
export type FreshRead = () => Promise<Record<string, string>>;

export type EditOutcome =
  | { stage: "blocked"; reasons: string[]; verdict?: Verdict }
  | { stage: "failed"; reasons: string[]; response: unknown }
  | { stage: "unknown"; reasons: string[] }
  | { stage: "submitted"; before: Record<string, string>; response: unknown; verdict: Verdict };

/**
 * The save and cancel endpoints as the builder calls them (captured 10-08). Pinned against
 * the real URLs in test/v2BotPure.ts: when a pattern stops matching, the in-flight guard
 * silently stops running, which is how the first cancels went out unchecked.
 */
export const saveUrl = (orderId: number, model: string) => new RegExp(`/admin/orders/builder/${orderId}\\?model=${model}&ajax=save_node(&|$)`);
export const cancelUrl = (orderId: number) => new RegExp(`/admin/orders/builder/${orderId}\\?ajax=cancel$`);

export async function harvestFields(page: Page, formSelector: string): Promise<FieldShape[]> {
  return page.locator(formSelector).evaluate((f) =>
    [...(f as HTMLFormElement).elements].filter((e) => (e as HTMLInputElement).name).map((e) => {
      const x = e as HTMLInputElement;
      return { name: x.name, type: x.tagName === "INPUT" ? x.type : x.tagName.toLowerCase(), required: !!x.required, hidden: x.type === "hidden" };
    }));
}

export async function formPairs(page: Page, formSelector: string): Promise<Pairs> {
  return page.locator(formSelector).evaluate((f) =>
    // An empty file input still travels as a part with an empty value; reading it as absent
    // made the in-flight guard see a field appear from nowhere.
    [...new FormData(f as HTMLFormElement)].map(([k, v]) => [k, typeof v === "string" ? v : (v as File).name] as [string, string]));
}

/** Opens the builder at one node and returns its form selector, or null when the node is not on the order. */
export async function openNode(page: Page, orderId: number, model: string, id: number): Promise<string | null> {
  await page.goto(`${BASE}/admin/orders/builder/${orderId}`, { waitUntil: "networkidle" });
  if (!/^Complex order edit R\d+/.test(await page.title())) return null;
  // The tree fills in after the page settles, deepest nodes last; on a cold Vercel instance
  // that took longer than networkidle (10-08), so the anchor is waited for, not counted.
  const anchor = page.locator(`[id="${model}:${id}_anchor"]`);
  await anchor.waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  if ((await anchor.count()) !== 1) return null;
  await anchor.click();
  const sel = `#${model}BuilderForm`;
  await page.locator(`${sel} input[name="data[${model}][id]"][value="${id}"]`).waitFor({ state: "attached", timeout: 20000 });
  await page.waitForLoadState("networkidle");
  return sel;
}

/**
 * A throw before the save is clicked cannot have written anything, so it is "blocked";
 * after the click it propagates, and the caller records the outcome as unknown.
 */
export async function editNode(bot: Bot, contract: Contract, orderId: number, model: string, id: number, set: Record<string, string>, fresh?: FreshRead): Promise<EditOutcome> {
  const clicked = { yes: false };
  try {
    return await editNodeInner(bot, contract, orderId, model, id, set, clicked, fresh);
  } catch (e) {
    if (clicked.yes) throw e;
    return { stage: "blocked", reasons: [`bot error before submit: ${String((e as Error)?.message ?? e).slice(0, 200)}`] };
  }
}

async function editNodeInner(bot: Bot, contract: Contract, orderId: number, model: string, id: number, set: Record<string, string>, clicked: { yes: boolean }, fresh?: FreshRead): Promise<EditOutcome> {
  for (const k of Object.keys(set)) if (!contract.fill.includes(k)) return { stage: "blocked", reasons: [`${k} is not in ${contract.surface}'s fill list`] };
  const sel = await openNode(bot.page, orderId, model, id);
  if (!sel) return { stage: "blocked", reasons: [`${model}:${id} is not on order ${orderId}'s builder`] };
  return fillAndSave(bot, sel, contract, orderId, model, set, clicked, fresh);
}

/**
 * Opens a parent node's context-menu action that creates a child ("Add shift" on a
 * location, "Add position" on a shift) and returns the new, unsaved form. Nothing is
 * written until Save. The form must name the parent it was opened from.
 */
export async function openCreateForm(page: Page, orderId: number, parent: { model: string; id: number }, menuText: string, formModel: string, parentField: string): Promise<string | null> {
  if (!(await openNode(page, orderId, parent.model, parent.id))) return null;
  await page.locator(`[id="${parent.model}:${parent.id}_anchor"]`).click({ button: "right" });
  const item = page.locator(".vakata-context li a").filter({ hasText: menuText });
  if ((await item.count()) !== 1 || (await item.innerText()).trim() !== menuText) return null;
  await item.click();
  const sel = `#${formModel}BuilderForm`;
  await page.locator(`${sel} input[name="${parentField}"][value="${parent.id}"]`).waitFor({ state: "attached", timeout: 20000 });
  await page.waitForLoadState("networkidle");
  if ((await page.locator(`${sel} input[name="data[${formModel}][id]"]`).count()) !== 0) return null;
  return sel;
}

/** A new child record through its create form: the same fill, guard and save as an edit. */
export async function createChild(bot: Bot, contract: Contract, orderId: number, parent: { model: string; id: number }, menuText: string, formModel: string, parentField: string, set: Record<string, string>): Promise<EditOutcome> {
  const clicked = { yes: false };
  try {
    for (const k of Object.keys(set)) if (!contract.fill.includes(k)) return { stage: "blocked", reasons: [`${k} is not in ${contract.surface}'s fill list`] };
    const sel = await openCreateForm(bot.page, orderId, parent, menuText, formModel, parentField);
    if (!sel) return { stage: "blocked", reasons: [`"${menuText}" on ${parent.model}:${parent.id} did not open a new ${formModel} form`] };
    return await fillAndSave(bot, sel, contract, orderId, formModel, set, clicked);
  } catch (e) {
    if (clicked.yes) throw e;
    return { stage: "blocked", reasons: [`bot error before submit: ${String((e as Error)?.message ?? e).slice(0, 200)}`] };
  }
}

async function fillAndSave(bot: Bot, sel: string, contract: Contract, orderId: number, model: string, set: Record<string, string>, clicked: { yes: boolean }, fresh?: FreshRead): Promise<EditOutcome> {
  const { page } = bot;
  const verdict = checkContract(contract, { version: await versionSignals(page), fields: await harvestFields(page, sel) });
  if (verdict.tier === "block") return { stage: "blocked", reasons: ["form changed: protocol update needed", ...verdict.reasons], verdict };

  const before = await formPairs(page, sel);
  const form = page.locator(sel);
  for (const [name, value] of Object.entries(set)) {
    const input = form.locator(`[name="${name}"]`);
    if ((await input.count()) !== 1) return { stage: "blocked", reasons: [`${name}: ${await input.count()} inputs`] };
    const kind = await input.evaluate((e) => (e.tagName === "SELECT" ? "select" : e.classList.contains("date-picker") ? "date" : "text"));
    if (kind === "select") {
      await input.selectOption(value);
    } else if (kind === "date") {
      // The bootstrap date picker restores its own date on blur after a programmatic fill
      // (measured 10-08 on the new-shift form); typed keys and Enter are what it accepts.
      await input.click();
      await input.press("Control+a");
      await input.pressSequentially(value, { delay: 20 });
      await input.press("Enter");
    } else {
      await input.fill(value);
      await input.press("Tab");
    }
  }
  await page.keyboard.press("Escape");
  const filled = await formPairs(page, sel);
  const domDiff = unexpectedChanges(before, filled, set, contract.derived);
  if (domDiff.length) return { stage: "blocked", reasons: ["form values after filling", ...domDiff] };
  if ((await activeRole(page)) !== AGENCY_ROLE_LABEL) return { stage: "blocked", reasons: ["role changed before submit"] };
  if (bot.alarms.length) return { stage: "blocked", reasons: ["page raised", ...bot.alarms] };
  // Edit forms resend every field. If a person changed this record after the form loaded,
  // saving now would write their change back out; so OnSinch is re-read and must still
  // hold what the form was loaded with.
  if (fresh) {
    const was = asMap(before);
    const moved = Object.entries(await fresh()).filter(([k, v]) => was.has(k) && was.get(k) !== canonical(k, v)).map(([k, v]) => `${k}: form ${was.get(k)}, OnSinch now ${v}`);
    if (moved.length) return { stage: "blocked", reasons: ["changed by someone else since the form loaded", ...moved] };
  }

  const guard: string[] = [];
  const inspected = { yes: false };
  const pattern = saveUrl(orderId, model);
  await page.route((u) => pattern.test(u.toString()), async (route) => {
    inspected.yes = true;
    const req = route.request();
    const sent = parseBody(req.postData() ?? "", req.headers()["content-type"] ?? "");
    const bad = sent.length ? unexpectedChanges(before, sent, set, contract.derived) : ["request body unreadable"];
    if (bad.length) { guard.push(...bad); await route.abort(); } else await route.continue();
  });
  const save = form.locator('button[type="submit"]');
  if ((await save.count()) !== 1) return { stage: "blocked", reasons: [`${await save.count()} submit buttons`] };
  const answer = page.waitForResponse((r) => pattern.test(r.url()) && r.request().method() === "POST", { timeout: 30000 }).catch(() => null);
  clicked.yes = true;
  await save.click();
  const res = await answer;
  await page.unroute((u) => pattern.test(u.toString()));
  if (guard.length) return { stage: "blocked", reasons: ["request in flight", ...guard] };
  if (!res) return { stage: "unknown", reasons: ["no answer to the save within 30s"] };
  // A guard that never ran is not a guard that passed: a URL pattern that stopped matching
  // would otherwise let every save through unchecked (it happened to the cancel, 10-08).
  if (!inspected.yes) return { stage: "unknown", reasons: ["the save was answered but the guard never saw the request"] };
  let body: any = null;
  try { body = await res.json(); } catch { return { stage: "unknown", reasons: [`save answered ${res.status()} with no JSON`] }; }
  if (body?.result !== true) return { stage: "failed", reasons: [String(body?.message ?? "result not true")], response: body };
  if (bot.alarms.length) return { stage: "unknown", reasons: ["page raised during save", ...bot.alarms] };
  return { stage: "submitted", before: Object.fromEntries(before.filter(([k]) => Object.keys(set).includes(k))), response: { message: body.message, warnings: body.warnings }, verdict };
}

/** The live shape of a node's form, for capturing or re-benching a contract. */
export async function captureContract(page: Page, orderId: number, model: string, id: number, surface: string, fill: string[], derived: string[]): Promise<Contract | null> {
  const sel = await openNode(page, orderId, model, id);
  if (!sel) return null;
  return { surface, version: await versionSignals(page), fields: await harvestFields(page, sel), fill, derived, benched_at: new Date().toISOString() };
}

/**
 * Cancels one node through its context menu (the "Cancel" ops use; the record stays, marked
 * cancelled). Measured 10-08 on TEST: a bootbox asks "Are you sure you want to cancel
 * selected item(s) and all its children items?", OK posts `?ajax=cancel` with
 * `selected[]=<Model:id>`, and OnSinch answers {result: true, message}. The request must
 * name exactly this one node: the tree supports multi-select, and a cancel of a shift
 * cascades to every position under it.
 */
export const CANCEL_PROMPT = "Are you sure you want to cancel selected item(s) and all its children items?";

export async function cancelNode(bot: Bot, orderId: number, model: string, id: number): Promise<EditOutcome> {
  const { page } = bot;
  const clicked = { yes: false };
  try {
    const sel = await openNode(page, orderId, model, id);
    if (!sel) return { stage: "blocked", reasons: [`${model}:${id} is not on order ${orderId}'s builder`] };
    if ((await activeRole(page)) !== AGENCY_ROLE_LABEL) return { stage: "blocked", reasons: ["not in the agency role"] };
    await page.locator(`[id="${model}:${id}_anchor"]`).click({ button: "right" });
    const item = page.locator(".vakata-context li a").filter({ hasText: "Cancel" });
    if ((await item.count()) !== 1 || (await item.innerText()).trim() !== "Cancel") return { stage: "blocked", reasons: ["context menu has no single Cancel item"] };
    await item.click();
    const box = page.locator(".bootbox").first();
    await box.waitFor({ state: "attached", timeout: 10000 });
    const prompt = (await box.locator(".bootbox-body").innerText()).trim();
    if (prompt !== CANCEL_PROMPT) {
      await box.locator('button[data-bb-handler="cancel"]').click().catch(() => {});
      return { stage: "blocked", reasons: [`unexpected confirmation: "${prompt.slice(0, 120)}"`] };
    }
    const guard: string[] = [];
    const inspected = { yes: false };
    const pattern = cancelUrl(orderId);
    await page.route((u) => pattern.test(u.toString()), async (route) => {
      inspected.yes = true;
      const sent = new URLSearchParams(route.request().postData() ?? "").getAll("selected[]");
      if (sent.length !== 1 || sent[0] !== `${model}:${id}`) { guard.push(`cancel would select ${JSON.stringify(sent)}`); return route.abort(); }
      return route.continue();
    });
    const answer = page.waitForResponse((r) => pattern.test(r.url()) && r.request().method() === "POST", { timeout: 30000 }).catch(() => null);
    if (bot.alarms.length) return { stage: "blocked", reasons: ["page raised", ...bot.alarms] };
    clicked.yes = true;
    await box.locator('button[data-bb-handler="confirm"]').click();
    const res = await answer;
    if (guard.length) return { stage: "blocked", reasons: ["request in flight", ...guard] };
    if (!res) return { stage: "unknown", reasons: ["no answer to the cancel within 30s"] };
    if (!inspected.yes) return { stage: "unknown", reasons: ["the cancel was answered but the guard never saw the request"] };
    let body: any = null;
    try { body = await res.json(); } catch { return { stage: "unknown", reasons: [`cancel answered ${res.status()} with no JSON`] }; }
    if (body?.result !== true) return { stage: "failed", reasons: [String(body?.message ?? JSON.stringify(body?.errors ?? body)).slice(0, 200)], response: body };
    return { stage: "submitted", before: {}, response: { message: body.message }, verdict: { tier: "ok", reasons: [] } };
  } catch (e) {
    if (clicked.yes) throw e;
    return { stage: "blocked", reasons: [`bot error before submit: ${String((e as Error)?.message ?? e).slice(0, 200)}`] };
  }
}
