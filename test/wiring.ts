// ============================================================================
// Is the capability actually PLUGGED IN?
// ----------------------------------------------------------------------------
// Three features shipped this week were complete, tested, and reachable by nothing:
// the cross-thread internal email had no executor method behind it, no code path ever
// wrote a profession alias, and the Neon profession cache was written by a script and
// read by nobody. Every unit test passed the whole time, because a unit test asks
// whether a part works, not whether anything calls it.
//
// This asks the other question, at the seam where deps.ts assembles the real thing.
// It reads the module source rather than importing it, because importing deps.ts
// opens a database connection and reaches for env vars that do not exist in CI — and
// a wiring check that needs production credentials is one nobody runs.
//
// Run: npx tsx test/wiring.ts
// ============================================================================
import { readFileSync } from "node:fs";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const deps = readFileSync("app/lib/deps.ts", "utf8");
const pipeline = readFileSync("app/lib/engine/pipeline.ts", "utf8");
const compiler = readFileSync("app/lib/engine/compiler.ts", "utf8");

console.log("\n[1] every optional Executor method the pipeline calls has an implementation");
{
  // The pipeline treats these as optional so tests can omit them. That same optionality
  // is what let one ship to production missing.
  const optional = [...pipeline.matchAll(/executor\.(\w+)\?\./g)].map((m) => m[1]);
  const unique = [...new Set(optional)];
  ok(unique.length > 0, "found the optional calls to check", unique.join(", "));
  for (const name of unique) {
    ok(new RegExp(`\\b${name}\\b\\s*[(:]`).test(deps), `deps.ts implements ${name}`);
  }
}

console.log("\n[2] the cross-thread email reaches ops, not the client");
{
  ok(/createInternalDraft/.test(deps), "createInternalDraft is implemented");
  const body = deps.slice(deps.indexOf("async createInternalDraft"), deps.indexOf("async createOrder"));
  ok(/GMAIL_DRAFT_WEBHOOK/.test(body), "it goes through the Gmail draft webhook");
  // The comment above the call says "in_reply_to is deliberately absent", so a plain
  // search finds the prose rather than the code. Read the payload it actually sends.
  const payload = body.slice(body.indexOf("body: JSON.stringify"), body.indexOf("});", body.indexOf("body: JSON.stringify")));
  ok(!!payload && /\bto\b/.test(payload), "the payload carries an explicit recipient", payload.trim());
  ok(!/in_reply_to/.test(payload),
    "and NEVER in_reply_to — landing an internal question in the client's thread is the one way this does harm");
}

console.log("\n[3] the profession alias store is written AND read");
{
  ok(/kind: "profession"/.test(compiler), "something records a profession alias");
  ok(/aliasLookup\(deps\.aliases, "profession"/.test(compiler), "and something looks one up");
  ok(/profession_id: learnedProfessions/.test(compiler),
    "and a remembered id actually reaches the request block");
}

console.log("\n[4] the Neon profession cache is read by the engine");
{
  ok(/loadProfessions/.test(deps), "deps.ts loads the cached list");
  ok(/professions: await loadProfessions/.test(deps), "and passes it into the compile deps");
  ok(/professions: deps\.professions/.test(compiler), "which the compiler hands to compose");
}

console.log("\n[5] the destructive path is ON, with a kill switch");
{
  // Ben ruled that every amendment rebuilds the order, so the old opt-IN flag would
  // have meant the ruling did nothing at all. The switch is inverted, not removed:
  // this is still the only code in the repo that destroys a real booking.
  ok(/SPARTAN_BLOCK_ORDER_REPLACE/.test(deps), "the kill switch exists");
  ok(!/SPARTAN_ALLOW_ORDER_REPLACE\s*===/.test(deps), "and the old opt-in gate is gone");
  ok(/SPARTAN_BLOCK_ORDER_REPLACE\s*!==\s*"1"/.test(deps), "so replaceOrder is present unless it is set");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
