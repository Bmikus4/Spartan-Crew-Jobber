// /tmp hygiene for the live browser (bot/browser.ts sweepTmp): crash dumps go at once, stale
// Playwright folders go, a folder another invocation is still using stays.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sweepTmp } from "../app/lib/v2/bot/browser";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const dir = mkdtempSync(join(tmpdir(), "sweep-test-"));
const now = Date.now();
const old = (p: string) => { const t = new Date(now - 20 * 60e3); utimesSync(p, t, t); };
writeFileSync(join(dir, "core.chromium.4711"), "x");
writeFileSync(join(dir, "core.12"), "x");
mkdirSync(join(dir, "playwright_chromiumdev_profile-old")); old(join(dir, "playwright_chromiumdev_profile-old"));
mkdirSync(join(dir, "playwright-artifacts-old")); old(join(dir, "playwright-artifacts-old"));
mkdirSync(join(dir, "playwright_chromiumdev_profile-live"));
mkdirSync(join(dir, "chromium-pack")); old(join(dir, "chromium-pack"));
writeFileSync(join(dir, "corefile.txt"), "x");

const removed = sweepTmp(dir, now);
ok(!existsSync(join(dir, "core.chromium.4711")) && !existsSync(join(dir, "core.12")), "crash dumps are removed whatever their age (a 300+ MB core fills /tmp: sparticuz/chromium #512)");
ok(!existsSync(join(dir, "playwright_chromiumdev_profile-old")) && !existsSync(join(dir, "playwright-artifacts-old")), "Playwright folders older than 10 minutes are removed");
ok(existsSync(join(dir, "playwright_chromiumdev_profile-live")), "a fresh Playwright folder, possibly another invocation's live browser, stays");
ok(existsSync(join(dir, "chromium-pack")) && existsSync(join(dir, "corefile.txt")), "anything else in /tmp stays, the unpacked Chromium included");
ok(removed.length === 4, "it reports what it removed", removed);
ok(sweepTmp(join(dir, "missing")).length === 0, "a missing directory is not an error");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
