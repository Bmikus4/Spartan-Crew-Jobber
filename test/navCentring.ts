// ============================================================================
// The condensed rail's icon column is centred in the rail.
// ----------------------------------------------------------------------------
// The inset is split across three files and two nested elements — the rail width
// and icon box are CSS variables, the row container carries one padding and the
// button inside it carries another — so nobody looking at any single one of them
// can see where the icon actually lands. It landed at 14..54 in a 60px rail: a
// 14px left gutter against a 6px right one, every icon 4px right of centre.
//
// The logo band repeats the same number as a single literal, because the mark has
// to head the same column and it is not inside a row button.
//
// This reads the numbers out of the source rather than re-stating them, so the
// test fails when the layout moves rather than when the test goes stale.
// ============================================================================
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
const sidebar = readFileSync(join(ROOT, "app/components/Sidebar.tsx"), "utf8");

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

function cssPx(name: string): number {
  const m = css.match(new RegExp(`--${name}:\\s*(\\d+)px`));
  if (!m) throw new Error(`--${name} not found in globals.css`);
  return Number(m[1]);
}

console.log("nav rail centring");

const railW = cssPx("nav-w-condensed");
const iconBox = cssPx("nav-icon-box");

// The row container: the only `padding: "0 Npx"` in the file.
const containerPad = sidebar.match(/padding:\s*"0 (\d+)px"/);
ok(!!containerPad, "row container padding found");
// The button: `padding: "3px 6px"` — the horizontal half is what insets the icon.
const buttonPad = sidebar.match(/padding:\s*"\d+px (\d+)px"/);
ok(!!buttonPad, "row button padding found");
// The logo band states its left inset outright.
const logoPad = sidebar.match(/padding:\s*"0 \d+px 0 (\d+)px"/);
ok(!!logoPad, "logo band left padding found");

if (!containerPad || !buttonPad || !logoPad) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const inset = Number(containerPad[1]) + Number(buttonPad[1]);
const centred = (railW - iconBox) / 2;

ok(inset === centred, `icon column inset is ${centred}px`, `got ${inset}px — icons sit ${inset - centred}px off centre`);
ok(Number(logoPad[1]) === inset, "the logo band heads the same column as the icons", `band ${logoPad[1]}px vs rows ${inset}px`);

// Whatever the numbers become, the gutters must match: this is the property, the
// arithmetic above is just how it is currently achieved.
const rightGutter = railW - inset - iconBox;
ok(rightGutter === inset, "left and right gutters are equal", `left ${inset}px, right ${rightGutter}px`);
ok(rightGutter >= 0, "the icon box fits inside the condensed rail", `overflows by ${-rightGutter}px`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
