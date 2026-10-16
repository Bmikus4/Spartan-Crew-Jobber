import { chromium, type Browser } from "playwright-core";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** The last lines Playwright logged about the browser process, attached to launch failures. */
export const browserLog: string[] = [];
const logger = {
  isEnabled: (name: string) => name === "browser" || name === "protocol",
  log: (name: string, _sev: string, message: string | Error) => {
    if (name === "protocol") return;
    browserLog.push(String(message).slice(0, 300));
    if (browserLog.length > 40) browserLog.shift();
  },
};

const STALE_MS = 10 * 60e3;

/**
 * Clears what a dead browser leaves in /tmp. @sparticuz/chromium 152-153 crash on shutdown on
 * some runs and write a 300-385 MB core.chromium.<pid> (Sparticuz/chromium #512); with the
 * unpacked binary already ~200 MB of Vercel's 500 MB /tmp, one dump fills it and every later
 * launch on that warm instance dies ("Target page, context or browser has been closed",
 * net::ERR_INSUFFICIENT_RESOURCES). That is the 3-in-4 canary failure measured 10-15. Clearing
 * the dumps before and after every launch took the reporter to 0 failures in 600 runs.
 *
 * Crash dumps go at once. Playwright's own folders (profile, artifacts, downloads) go only when
 * older than 10 minutes: Fluid compute shares one /tmp between concurrent invocations, and a
 * fresh folder may be another run's live browser. Everything else is left alone.
 */
export function sweepTmp(dir = tmpdir(), now = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    const p = join(dir, name);
    try {
      if (/^core(\.|$)/.test(name)) { rmSync(p, { force: true }); removed.push(name); continue; }
      if (/^playwright[-_]/.test(name) && now - statSync(p).mtimeMs > STALE_MS) { rmSync(p, { recursive: true, force: true }); removed.push(name); }
    } catch { /* gone already, or in use by another invocation */ }
  }
  return removed;
}

/**
 * One Chromium launcher for every host. On Vercel the binary comes from @sparticuz/chromium,
 * unpacked into /tmp on a cold start; elsewhere BOT_CHROMIUM_PATH names a local Chromium.
 */
export async function launchBrowser(): Promise<Browser> {
  browserLog.length = 0;
  if (process.env.VERCEL) {
    const swept = sweepTmp();
    if (swept.length) browserLog.push(`swept /tmp: ${swept.join(", ").slice(0, 200)}`);
    const sparticuz = (await import("@sparticuz/chromium")).default;
    // No WebGL: the bot needs none, and it saves extracting swiftshader into /tmp.
    sparticuz.setGraphicsMode = false;
    const browser = await chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true, logger });
    // After every close, and after a crash, the dump it may have written goes too.
    browser.on("disconnected", () => { sweepTmp(); });
    return browser;
  }
  return chromium.launch({ executablePath: process.env.BOT_CHROMIUM_PATH || undefined, headless: true, logger });
}
