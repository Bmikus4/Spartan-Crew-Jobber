// ============================================================================
// EXACTLY ONE INTAKE MAY RUN THE ENGINE. Not both, and not neither.
// ----------------------------------------------------------------------------
// /api/n8n-inbound and the Gmail poll (/api/mail-poll) both store every message; two that
// both decided would race on one message, a model call and a write each (app/lib/intakePath.ts).
// On 2026-09-16 three days of live output had to be deleted, 25 of the 39 already duplicated
// by hand: that is what two deciders produce, at 16 orders a day.
//
// One env var decides which intake is live, and this file asserts the property that makes
// the switch-over safe: for ANY value of INTAKE_PATH, including nonsense, exactly one route
// may run the engine. The flip is one variable, atomic, reversible.
//
// Offline, no network, no database.  npx tsx test/intakePath.ts
// ============================================================================
import { activeIntake, mayRunEngine } from "../app/lib/intakePath";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

console.log("\n[1] unset is TODAY's behaviour — this ships long before the cutover");
{
  // The default has to be the world as it is, or deploying the interlock IS the cutover.
  ok(activeIntake({}) === "n8n", "no INTAKE_PATH means the n8n path", activeIntake({}));
  ok(mayRunEngine("n8n", {}) === true, "n8n-inbound runs the engine");
  ok(mayRunEngine("routing", {}) === false, "the Gmail poll stores but does not");
}

console.log("\n[2] the flip, which is the whole cutover");
{
  const env = { INTAKE_PATH: "routing" };
  ok(activeIntake(env) === "routing", "INTAKE_PATH=routing moves the engine");
  ok(mayRunEngine("routing", env) === true, "the Gmail poll now runs it");
  ok(mayRunEngine("n8n", env) === false, "and n8n-inbound stops, whether or not n8n is still firing");
}

console.log("\n[3] stated explicitly, it still means what it says");
{
  const env = { INTAKE_PATH: "n8n" };
  ok(mayRunEngine("n8n", env) === true && mayRunEngine("routing", env) === false, "INTAKE_PATH=n8n is the n8n path");
}

console.log("\n[4] a typo must not move intake, and must not stop it either");
{
  // Both failure directions are real. Falling open would double-book on a typo; falling
  // closed would silently stop every enquiry, which is the 42-hour outage of 2026-08-26.
  // "ROUTING " is NOT in here: case and surrounding whitespace are accepted on purpose,
  // see [5]. A typo is a different word, not a different shift key.
  for (const bad of ["", "   ", "gmail", "webhook", "rout1ng", "n8n;", "true", "1", "undefined"]) {
    const env = { INTAKE_PATH: bad };
    const n = mayRunEngine("n8n", env), r = mayRunEngine("routing", env);
    ok(n === true && r === false, `"${bad}" falls back to n8n rather than guessing`, `n8n=${n} routing=${r}`);
  }
}

console.log("\n[5] case and whitespace are accepted, because a human sets this by hand");
{
  for (const good of ["ROUTING", " routing", "routing ", "Routing"]) {
    ok(activeIntake({ INTAKE_PATH: good }) === "routing", `"${good}" is understood`, activeIntake({ INTAKE_PATH: good }));
  }
}

console.log("\n[6] THE INVARIANT — never both, never neither, for anything at all");
{
  // This is the assertion the whole file exists for. If it can ever be both, one enquiry
  // becomes two orders; if it can ever be neither, intake is silently dead.
  const values = ["", " ", "n8n", "routing", "ROUTING", "nonsense", "n8n routing", "both",
                  "null", "0", "-1", "\t", "routing\n", "N8N", "off", "none"];
  let bad = 0;
  for (const v of values) {
    const live = (["n8n", "routing"] as const).filter((p) => mayRunEngine(p, { INTAKE_PATH: v }));
    if (live.length !== 1) { bad++; console.log(`     "${v}" -> ${live.length} live path(s): ${live.join(",")}`); }
  }
  ok(bad === 0, `exactly one path is live for all ${values.length} values tried`);

  // And with the variable genuinely absent, not merely empty.
  const live = (["n8n", "routing"] as const).filter((p) => mayRunEngine(p, {}));
  ok(live.length === 1 && live[0] === "n8n", "and with no variable at all", live.join(","));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
