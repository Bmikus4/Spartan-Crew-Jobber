// ============================================================================
// Replay a real n8n execution through the repo's payload builder, locally.
// ----------------------------------------------------------------------------
// Why this exists: the label-strip consumes every message and "Get many
// messages" only looks back 10 minutes, so a processed email cannot be made to
// flow again. But n8n keeps each execution's full node data, which is the same
// input the payload builder saw. Replaying it proves a builder fix against REAL
// mail without sending anything into a live client inbox.
//
// Read-only: fetches executions, runs the node body in-process, prints the
// contract. It never posts to the engine and never touches n8n or the database.
//
//   node scripts/replay-execution.mjs              # the last 5 full executions
//   node scripts/replay-execution.mjs 300327       # one specific execution
//   node scripts/replay-execution.mjs 300327 --json
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const h = { "X-N8N-API-KEY": KEY };
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const ONE = argv.find((a) => /^\d+$/.test(a));

const src = readFileSync(join(ROOT_DIR, "n8n", "nodes", "build-engine-payload.js"), "utf8");

/** Run the node body with n8n's globals faked from an execution's runData. */
function runNode(runData, tapJson) {
  const $ = (name) => {
    const run = runData[name];
    if (!run) throw new Error(`no node "${name}"`); // n8n throws too
    const items = (run[0]?.data?.main?.[0] || []).map((i) => i.json);
    if (!items.length) throw new Error(`node "${name}" produced nothing`);
    return { item: { json: items[0] }, all: () => items.map((j) => ({ json: j })) };
  };
  return new Function("$", "$json", "Buffer", src)($, tapJson, Buffer);
}

const ids = ONE
  ? [ONE]
  : (await (await fetch(`${BASE}/executions?workflowId=${WF}&limit=20`, { headers: h })).json()).data
      .filter((e) => e.status === "success")
      .map((e) => e.id);

let shown = 0;
for (const id of ids) {
  const d = await (await fetch(`${BASE}/executions/${id}?includeData=true`, { headers: h })).json();
  const runData = d?.data?.resultData?.runData || {};
  if (!runData["Build Engine Payload"] && !runData["Get a thread2"]) continue; // never reached the tap
  if (!ONE && shown >= 5) break;
  shown++;

  const tap = (runData["Combine all Email Data"]?.[0]?.data?.main?.[0]?.[0]?.json) || {};
  let out;
  try {
    out = runNode(runData, tap);
  } catch (err) {
    console.log(`\n${id}  REPLAY FAILED: ${err.message}`);
    continue;
  }
  const p = out[0].json;

  if (JSON_OUT) { console.log(JSON.stringify(p, null, 2)); continue; }

  // What the LIVE run actually posted, for a side-by-side.
  const live = runData["Build Engine Payload"]?.[0]?.data?.main?.[0]?.[0]?.json;
  const liveMsgs = Array.isArray(live?.messages) ? live.messages : [];

  console.log(`\n=== execution ${id}  thread=${p.thread_id}  messages=${p.messages.length} ===`);
  for (let i = 0; i < p.messages.length; i++) {
    const m = p.messages[i];
    const l = liveMsgs[i];
    console.log(`  [${i}] ${m.message_id}`);
    console.log(`      from     ${JSON.stringify(m.from)}${l && l.from !== m.from ? `   (live posted ${JSON.stringify(l.from)})` : ""}`);
    console.log(`      subject  ${JSON.stringify(m.subject)}${l && l.subject !== m.subject ? `   (live posted ${JSON.stringify(l.subject)})` : ""}`);
    console.log(`      to       ${JSON.stringify(m.to)}${l && JSON.stringify(l.to) !== JSON.stringify(m.to) ? `   (live posted ${JSON.stringify(l.to)})` : ""}`);
    console.log(`      spartan  ${m.is_from_spartan}${l && l.is_from_spartan !== m.is_from_spartan ? `   (live posted ${l.is_from_spartan})` : ""}`);
    console.log(`      date     ${m.date_iso}   body=${String(m.body || "").length} chars`);
  }
  const blank = p.messages.filter((m) => !m.from || !m.subject).length;
  console.log(`  ${blank ? `STILL BLANK on ${blank}/${p.messages.length} message(s)` : "every message has a sender and a subject"}`);
}
if (!shown && !JSON_OUT) console.log("no execution reached the payload tap in the window inspected.");
