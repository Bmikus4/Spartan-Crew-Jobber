import { chromium, type Browser } from "playwright-core";

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

/**
 * One Chromium launcher for every host. On Vercel the binary comes from @sparticuz/chromium,
 * unpacked into /tmp on a cold start; elsewhere BOT_CHROMIUM_PATH names a local Chromium.
 */
export async function launchBrowser(): Promise<Browser> {
  browserLog.length = 0;
  if (process.env.VERCEL) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true, logger });
  }
  return chromium.launch({ executablePath: process.env.BOT_CHROMIUM_PATH || undefined, headless: true, logger });
}
