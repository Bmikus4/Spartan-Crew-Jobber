// ============================================================================
// One custom tooltip on every screen (components/ui/TipHost.tsx; the owner, 1 Nov: "a custom tooltip UI for the
// platform ... verify it works everywhere over the screen").
// ----------------------------------------------------------------------------
// Pinned: the host is mounted once, in the root layout, so the sign-in screen and the TV have it; it takes over every
// native title as it is hovered or focused (title off, its words on data-tip, and on aria-label when the element has
// no name), so the browser's grey tip never shows beside it; the bubble stays inside the window and points at its
// trigger. Checked in a browser on 1 Nov (.tmp-v2/tipcheck.mjs): 42 tooltips on Urgent, All Opportunities, Settings
// and the TV, every one the custom bubble, inside the window, no native title left.
// npx tsx test/tooltips.ts
// ============================================================================
import { readFileSync } from "node:fs";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const layout = readFileSync("app/layout.tsx", "utf8"), shell = readFileSync("app/components/AppShell.tsx", "utf8"), host = readFileSync("app/components/ui/TipHost.tsx", "utf8");
ok(/<TipHost \/>/.test(layout) && !/<TipHost/.test(shell), "mounted once, in the root layout, for every screen");
ok(/el\.removeAttribute\("title"\)/.test(host) && /el\.setAttribute\("data-tip", t\)/.test(host), "a native title is taken over: its words become the tip and the title comes off");
ok(/!el\.hasAttribute\("aria-label"\) && !el\.hasAttribute\("aria-labelledby"\)\) el\.setAttribute\("aria-label", t\)/.test(host), "an element named only by its title keeps that name");
ok(/closest\?\.\("\[title\]"\)/.test(host) && /"focusin", onOver/.test(host), "on hover and on keyboard focus");
ok(/vw - r\.width - EDGE/.test(host) && /vh - r\.height - EDGE/.test(host) && /arrow: Math\.max\(10/.test(host), "kept inside the window, the arrow on its trigger");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
