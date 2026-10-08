// ============================================================================
// One logged-in OnSinch staff session, in the Agency "partner" role.
// ----------------------------------------------------------------------------
// The role matters more than it looks. The role picker lists "Spartan Crew - operations"
// under Companies, but that entry is the CLIENT portal of the OnSinch company "Spartan
// Crew" (switchRole/2240 lands on /client). Every client's order is edited under the
// Agency role "partner" (switchRole/2631). Measured 10-08: the role follows the URL, not
// the session. With one tab switched into the client portal, a fresh /admin page in the
// same session still rendered as "partner". The bot works only on /admin URLs, so it is in
// the agency role by construction; the assertion on each page it loads is the backstop.
//
// Expiry is detected by what the page shows (a redirect to /users/login, or the login
// panel), never by the cookie's age. A failed login is not retried: repeated wrong
// passwords are how an account gets locked.
// ============================================================================
import type { Browser, BrowserContext, Page } from "playwright-core";
import { launchBrowser, browserLog } from "./browser";
import { loadState, saveState } from "./db";
import type { VersionSignals } from "./contract";

export const BASE = "https://spartancrew.onsinch.com";
export const AGENCY_ROLE_LABEL = "partner";
/** Pinned: CakePHP ties a session to the user agent, so a restored session needs the same one. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

export type Bot = {
  page: Page;
  /** Anything the page did that the bot did not expect (a dialog, a failed request). Non-empty = fail closed. */
  alarms: string[];
  close(): Promise<void>;
};

export class LoginError extends Error {}
export class RoleError extends Error {}

/**
 * Measured on Vercel 10-08: a launch occasionally dies on its first navigation ("Target
 * page, context or browser has been closed"), then the next launch works. Nothing can have
 * been sent at that point, so one relaunch is safe; a second failure is reported.
 */
export async function openBot(opts: { persist?: boolean } = {}): Promise<Bot> {
  try {
    return await openBotOnce(opts);
  } catch (e) {
    if (!(e instanceof Error) || !/has been closed|crash/i.test(e.message)) throw e;
    return openBotOnce(opts);
  }
}

async function openBotOnce(opts: { persist?: boolean }): Promise<Bot> {
  const persist = opts.persist !== false;
  const browser: Browser = await launchBrowser();
  let ctx: BrowserContext | null = null;
  try {
    const state = persist ? await loadState().catch(() => null) : null;
    ctx = await browser.newContext({
      userAgent: UA, timezoneId: "Europe/London", locale: "en-GB", viewport: { width: 1440, height: 900 },
      ...(state ? { storageState: state as any } : {}),
    });
    // tsx/esbuild wrap named functions in __name(); functions sent to page.evaluate need it to exist.
    await ctx.addInitScript("window.__name = (f) => f");
    const page = await ctx.newPage();
    const alarms: string[] = [];
    // Playwright dismisses dialogs silently; a confirm() the bot did not expect is a fail-closed event.
    page.on("dialog", (d) => { alarms.push(`dialog ${d.type()}: ${d.message().slice(0, 200)}`); d.dismiss().catch(() => {}); });
    const bot: Bot = { page, alarms, close: async () => { await browser.close(); } };
    await ensureLoggedIn(bot, persist);
    await ensureAgencyRole(bot);
    return bot;
  } catch (e) {
    await browser.close().catch(() => {});
    if (e instanceof Error && /closed|crash|Target/i.test(e.message)) e.message += ` | browser log: ${browserLog.slice(-12).join(" / ")}`;
    throw e;
  }
}

const onLogin = (p: Page) => new URL(p.url()).pathname.startsWith("/users/login");

export async function ensureLoggedIn(bot: Bot, persist = true): Promise<void> {
  const { page } = bot;
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  if (!onLogin(page) && (await page.locator('[data-cy="role-picker"]').count()) === 1) return;
  const email = process.env.ONSINCH_UI_EMAIL, password = process.env.ONSINCH_UI_PASSWORD;
  if (!email || !password) throw new LoginError("ONSINCH_UI_EMAIL / ONSINCH_UI_PASSWORD not set");
  if (!onLogin(page)) await page.goto(`${BASE}/users/login`, { waitUntil: "domcontentloaded" });
  // The dormant reCAPTCHA hook: if a captcha script ever loads, stop rather than fight it.
  if (await page.locator('script[src*="recaptcha"]').count()) throw new LoginError("reCAPTCHA is now loaded on the login page");
  await page.fill('input[name="data[User][email]"]', email);
  await page.fill('input[name="data[User][password]"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/users/login"), { timeout: 30000 }).catch(() => {}),
    page.click('[data-cy="sign-in-btn"]'),
  ]);
  if (onLogin(page) || (await page.locator('[data-cy="role-picker"]').count()) !== 1) throw new LoginError("login did not reach the admin screens");
  if (persist) await saveState(await page.context().storageState());
}

export async function activeRole(page: Page): Promise<string> {
  const text = await page.locator('[data-cy="role-picker"]').first().innerText();
  return text.split("\n")[0].trim();
}

export async function ensureAgencyRole(bot: Bot): Promise<void> {
  const { page } = bot;
  if ((await activeRole(page)) === AGENCY_ROLE_LABEL) return;
  const href = await page.locator('[data-cy="role-switcher-admin-partner"]').getAttribute("href");
  if (!href || !/^\/users\/switchRole\/\d+$/.test(href)) throw new RoleError(`agency role switch not found (${href})`);
  await page.goto(BASE + href, { waitUntil: "domcontentloaded" });
  const now = await activeRole(page);
  if (now !== AGENCY_ROLE_LABEL) throw new RoleError(`active role is "${now}", not "${AGENCY_ROLE_LABEL}"`);
}

export async function versionSignals(page: Page): Promise<VersionSignals> {
  return page.evaluate(() => {
    const appka = /Appka\s+([\d.]+)/.exec(document.body.innerText)?.[1] ?? null;
    const srcs = [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src") ?? "");
    const scriptTag = srcs.map((s) => /^\/(?:global|layouts|pages)\/.*\?(\d+)$/.exec(s)?.[1]).find(Boolean) ?? null;
    const bundle = srcs.map((s) => /\/frontend\/(newJobForm\.[^/?]+\.js)/.exec(s)?.[1]).find(Boolean) ?? null;
    return { appka, scriptTag, bundle };
  });
}
