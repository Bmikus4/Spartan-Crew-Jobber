// ============================================================================
// Install the engine wiring into the LIVE bookings workflow (CPIRu7CpezvKjU8d).
// ----------------------------------------------------------------------------
// Four changes, all of which the workflow needs before it can ever work, none of
// which needs a credential we do not already have:
//
//  1. DEDUPE      The four Airtable nodes point at House of Hud's base, keyed on
//                 an Outlook conversation_id, and search-then-create races.
//                 Replaced by ONE HTTP call to our own /api/dedupe. The follow-up
//                 write-back chain (Get a record -> combine strings -> Update
//                 record) is House of Hud's follow-up sequence, which Spartan
//                 does not run, so it goes too.
//  2. DEAD REFS   MAINDATA reads every one of its 19 fields from
//                 $('When Executed by Another Workflow') - a node that does not
//                 exist here. Repointed at Normalize Data / Merge1.
//  3. IDENTITY    The Conversational Renderer still carries House of Hud's 44
//                 internal addresses and hello@houseofhud.com as its own address,
//                 so every spartancrew.co.uk reply reads as an external client.
//                 Swapped for one domain test.
//  4. CONTRACT    "Combine all Email Data" is an empty Set node, so POST to
//                 Engine posted an arbitrary shape. A Build Engine Payload code
//                 node now emits { thread_id, messages[] }.
//
// Safe by construction: fresh timestamped backup before anything, ONE atomic PUT
// (n8n either takes all of it or none), re-activate if the PUT clears the flag,
// then verify and refuse to claim success unless every change is present.
// Idempotent - re-running when already installed is a no-op.
//
//   node scripts/install-engine-wiring.mjs --dry   # print the plan, change nothing
//   node scripts/install-engine-wiring.mjs         # apply
// ============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const DRY = process.argv.includes("--dry");
const BASE = requireEnv("N8N_BASE");
const KEY = requireEnv("N8N_API_KEY");
const SECRET = (process.env.N8N_WEBHOOK_SECRET || "").trim();
const WF = process.env.WF_ID || "CPIRu7CpezvKjU8d";
const ENGINE_BASE = (process.env.ENGINE_BASE_URL || "https://spartan-crew-jobber.vercel.app").replace(/\/$/, "");
const h = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };

if (!SECRET) {
  console.error("N8N_WEBHOOK_SECRET is not set. The dedupe + engine calls are authenticated with it;");
  console.error("set it in .env.local (and the same value in Vercel) before installing.");
  process.exit(2);
}

const DEDUPE_NODE = "Dedupe Claim";
const PAYLOAD_NODE = "Build Engine Payload";
const ENGINE_NODE = "POST to Engine";
const TAP = "Combine all Email Data";
const DROP = ["Search records1", "does exist?", "get found?", "Switch", "Create a record", "Get a record", "combine strings", "Update record"];

const log = [];
const note = (s) => { log.push(s); console.log("  " + s); };

// ---------------------------------------------------------------- load + backup
const wf = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
if (!Array.isArray(wf.nodes)) { console.error("could not load workflow:", JSON.stringify(wf).slice(0, 300)); process.exit(1); }
console.log(`\nloaded: ${wf.name}\n  nodes=${wf.nodes.length} active=${wf.active} updated=${wf.updatedAt}\n`);

const stamp = String(wf.updatedAt || "unknown").replace(/[:.]/g, "-");
const backupDir = join(ROOT_DIR, "n8n", "backups");
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `bookings-${WF}.${stamp}.json`);
if (!DRY) {
  writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log(`backup written: ${backupPath}\n`);
} else {
  console.log(`(dry) backup would be: ${backupPath}\n`);
}

const byName = (n) => wf.nodes.find((x) => x.name === n);
const posOf = (n, dx = 0, dy = 0) => [(byName(n)?.position?.[0] ?? 2000) + dx, (byName(n)?.position?.[1] ?? 4256) + dy];

// ============================================================ 1. DEDUPE
console.log("1. DEDUPE - Airtable -> /api/dedupe");
if (byName(DEDUPE_NODE)) {
  note(`"${DEDUPE_NODE}" already present`);
} else {
  wf.nodes.push({
    parameters: {
      method: "POST",
      url: `${ENGINE_BASE}/api/dedupe`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "x-webhook-secret", value: SECRET }] },
      sendBody: true,
      specifyBody: "json",
      // Gmail ids straight off Get IDs1. The endpoint claims the message
      // atomically and answers found / thread_first_seen.
      jsonBody:
        '={{ JSON.stringify({ message_id: $json.id, thread_id: $json.threadId, from_address: $json.from?.[0]?.email, note: "n8n bookings poll" }) }}',
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: posOf("Get IDs1", 220, 0),
    id: randomUUID(),
    name: DEDUPE_NODE,
    // Never let a ledger hiccup stop an enquiry - the engine dedupes again.
    onError: "continueRegularOutput",
  });
  note(`added "${DEDUPE_NODE}" -> POST ${ENGINE_BASE}/api/dedupe`);
}

// Rewire: Get IDs1 -> Dedupe Claim -> Get Hydrated Emails1.
// Both Switch branches already hydrated, so the Airtable check gated nothing;
// the once-only guard is and remains the Gmail label removal at the end.
wf.connections["Get IDs1"] = { main: [[{ node: DEDUPE_NODE, type: "main", index: 0 }]] };
wf.connections[DEDUPE_NODE] = { main: [[{ node: "Get Hydrated Emails1", type: "main", index: 0 }]] };
note("rewired Get IDs1 -> Dedupe Claim -> Get Hydrated Emails1");

// The classify branch must still return to the batch loop now that the
// Get a record -> Update record chain is gone, or non-order items stall it.
const ifConn = wf.connections["If"] || { main: [[], []] };
ifConn.main = [
  [{ node: TAP, type: "main", index: 0 }],
  [{ node: "Loop Over Items", type: "main", index: 0 }],
];
wf.connections["If"] = ifConn;
note('rewired If: [0] -> tap, [1] (not an order) -> Loop Over Items (no stall)');

const dropped = [];
for (const name of DROP) {
  if (!byName(name)) continue;
  wf.nodes = wf.nodes.filter((n) => n.name !== name);
  delete wf.connections[name];
  dropped.push(name);
}
// scrub any remaining edges pointing at a dropped node
for (const c of Object.values(wf.connections)) {
  c.main = (c.main || []).map((outs) => (outs || []).filter((e) => !DROP.includes(e.node)));
}
note(dropped.length ? `dropped ${dropped.length}: ${dropped.join(", ")}` : "nothing to drop (already removed)");

// ============================================================ 2. DEAD REFS
console.log("\n2. DEAD REFS - MAINDATA repointed at the real Gmail nodes");
const NORM = "$('Normalize Data').item.json";
const MERGE = "$('Merge1').item.json";
const MAP = {
  id: `={{ ${NORM}.original_email.email_id }}`,
  conversationId: `={{ ${NORM}.original_email.thread_id }}`,
  subject: `={{ ${NORM}.original_email.subject }}`,
  bodyContent: `={{ ${NORM}.original_email.body }}`,
  fromAddress: `={{ ${NORM}.original_email.from }}`,
  // Gmail gives `date` on the hydrated item, or internalDate in epoch ms.
  sentDateTime: `={{ ${MERGE}.date || (${MERGE}.internalDate ? new Date(Number(${MERGE}.internalDate)).toISOString() : $now.toISO()) }}`,
  receivedDateTime: `={{ ${MERGE}.date || (${MERGE}.internalDate ? new Date(Number(${MERGE}.internalDate)).toISOString() : $now.toISO()) }}`,
  // The renderer only reads the fields above plus the dedupe flags. The rest of
  // MAINDATA's Outlook fields are unread - blanked rather than left pointing at
  // a node that does not exist.
  fromName: "=",
  // ARRAY-typed, unlike every other field here. "=" evaluates to an empty
  // STRING, which n8n rejects at runtime: "'ccRecipients' expects a array but we
  // got ''" - it killed the first real run. Nothing reads CC (the renderer never
  // looks at it), so an empty array is the correct blank.
  ccRecipients: "={{ [] }}",
  createdDateTime: "=",
  lastModifiedDateTime: "=",
  sentDate: "=",
  sentTime: "=",
  receivedDate: "=",
  receivedTime: "=",
  category: "=",
  "toRecipients[0].name": "=",
  "toRecipients[0].address": "=bookings@spartancrew.co.uk",
  // Normalize Data's history is cleaned bodies only (no From:/Sent: blocks), so
  // the renderer's Outlook thread parser cannot rebuild it. The ENGINE does its
  // own thread analysis from the full Gmail thread, so this is context, not the
  // load-bearing path.
  threadHistory: `={{ (${NORM}.thread_history?.messages || []).join('\\n\\n---\\n\\n') }}`,
  // dedupe flags now come from Dedupe Claim rather than Airtable
  found: `={{ $('${DEDUPE_NODE}').item.json.found }}`,
  last_sent_message: "=",
  last_place_in_follow_up: "=",
  added_to_whatsapp: "=false",
};
const main = byName("MAINDATA");
if (!main) {
  console.error("MAINDATA not found - aborting, no change committed.");
  process.exit(1);
}
let repointed = 0;
for (const a of main.parameters?.assignments?.assignments ?? []) {
  const want = MAP[a.name];
  if (want !== undefined && a.value !== want) { a.value = want; repointed++; }
}
const stillDead = JSON.stringify(main.parameters).includes("When Executed by Another Workflow");
note(`repointed ${repointed} MAINDATA assignments`);
note(stillDead ? "WARNING: dead ref still present in MAINDATA" : "no dead refs left in MAINDATA");

// ============================================================ 3. IDENTITY
console.log("\n3. IDENTITY - Conversational Renderer is Spartan, not House of Hud");
const rend = byName("Conversational Renderer");
if (!rend?.parameters?.jsCode) {
  console.error("Conversational Renderer not found - aborting, no change committed.");
  process.exit(1);
}
let code = rend.parameters.jsCode;
const before = code;
// its own send address
code = code.replace(
  /const AI_SEND_ADDRESS = '[^']*';/,
  "const AI_SEND_ADDRESS = 'bookings@spartancrew.co.uk';"
);
// 44 House of Hud addresses -> one domain test (nothing to maintain)
code = code.replace(
  /const isInternalSender\s*=\s*a\s*=>\s*INTERNAL_SENDERS\.has\(addrOf\(a\)\);/,
  "const isInternalSender    = a => /@spartancrew\\.co\\.uk$/i.test(addrOf(a)) || INTERNAL_SENDERS.has(addrOf(a));"
);
// HoH enquiry-form senders do not exist in this mailbox; Spartan's are unknown
code = code.replace(
  /const ENQUIRY_FORM_SENDERS = new Set\(\[[\s\S]*?\]\);/,
  "const ENQUIRY_FORM_SENDERS = new Set([\n  // Spartan enquiry-form senders go here once known (was House of Hud's list).\n]);"
);
code = code.replace(
  /const INTERNAL_SENDERS = new Set\(\[[\s\S]*?\]\);/,
  "const INTERNAL_SENDERS = new Set([\n  // Covered by the @spartancrew.co.uk domain test; list any off-domain staff here.\n]);"
);
const hoh = (code.match(/houseofhud|arabiantents|pearltents|completechillout/gi) || []).length;
if (code !== before) { rend.parameters.jsCode = code; note("swapped HoH identity for Spartan (send address, domain test, sender lists)"); }
else note("renderer identity already Spartan");
note(hoh ? `WARNING: ${hoh} House of Hud reference(s) still in the renderer` : "no House of Hud references left in the renderer");

// ============================================================ 4. CONTRACT
console.log("\n4. CONTRACT - Build Engine Payload before POST to Engine");
const bodySrc = readFileSync(join(ROOT_DIR, "n8n", "nodes", "build-engine-payload.js"), "utf8");
let payloadNode = byName(PAYLOAD_NODE);
if (!payloadNode) {
  payloadNode = {
    parameters: { jsCode: bodySrc },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: posOf(TAP, 200, 160),
    id: randomUUID(),
    name: PAYLOAD_NODE,
  };
  wf.nodes.push(payloadNode);
  note(`added "${PAYLOAD_NODE}"`);
} else if (payloadNode.parameters.jsCode !== bodySrc) {
  payloadNode.parameters.jsCode = bodySrc;
  note("refreshed the node body from n8n/nodes/build-engine-payload.js");
} else {
  note("payload builder already up to date");
}

if (!byName(ENGINE_NODE)) { console.error(`"${ENGINE_NODE}" missing - run scripts/wire-engine.mjs first.`); process.exit(1); }
// tap -> builder -> engine, and the tap still returns to the batch loop
wf.connections[TAP] = { main: [[{ node: PAYLOAD_NODE, type: "main", index: 0 }, { node: "Loop Over Items", type: "main", index: 0 }]] };
wf.connections[PAYLOAD_NODE] = { main: [[{ node: ENGINE_NODE, type: "main", index: 0 }]] };
note(`rewired ${TAP} -> ${PAYLOAD_NODE} -> ${ENGINE_NODE}`);

// ---------------------------------------------------------------- commit
console.log("");
if (DRY) {
  console.log(`(dry run) ${log.length} changes planned, nothing sent.`);
  console.log(`would PUT: nodes=${wf.nodes.length}`);
  process.exit(0);
}

const ALLOWED = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"];
const settings = {};
for (const k of ALLOWED) if (wf.settings?.[k] !== undefined) settings[k] = wf.settings[k];
const wasActive = wf.active;

const res = await fetch(`${BASE}/workflows/${WF}`, {
  method: "PUT", headers: h,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
const txt = await res.text();
if (!res.ok) {
  console.error(`PUT failed ${res.status}: ${txt.slice(0, 800)}`);
  console.error(`No change committed (PUT is atomic). Backup: ${backupPath}`);
  process.exit(1);
}
console.log(`PUT ${res.status}`);

if (wasActive) {
  const chk = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
  if (!chk.active) {
    const act = await fetch(`${BASE}/workflows/${WF}/activate`, { method: "POST", headers: h });
    console.log(`re-activated: ${act.status}`);
  }
}

// ---------------------------------------------------------------- verify
const after = await (await fetch(`${BASE}/workflows/${WF}`, { headers: h })).json();
const names = new Set(after.nodes.map((n) => n.name));
const edge = (from, to) => (after.connections[from]?.main || []).some((o) => (o || []).some((e) => e.node === to));
const deadRefs = after.nodes.filter((n) => JSON.stringify(n.parameters ?? {}).includes("When Executed by Another Workflow")).map((n) => n.name);
const airtable = after.nodes.filter((n) => /airtable/i.test(n.type)).map((n) => n.name);
const rendCode = after.nodes.find((n) => n.name === "Conversational Renderer")?.parameters?.jsCode || "";

const checks = [
  [names.has(DEDUPE_NODE), "Dedupe Claim present"],
  [names.has(PAYLOAD_NODE), "Build Engine Payload present"],
  [names.has(ENGINE_NODE), "POST to Engine present"],
  [airtable.length === 0, `no Airtable nodes left${airtable.length ? " (" + airtable.join(", ") + ")" : ""}`],
  [deadRefs.length === 0, `no dead node refs${deadRefs.length ? " (" + deadRefs.join(", ") + ")" : ""}`],
  [!/houseofhud/i.test(rendCode), "no houseofhud in the renderer"],
  [edge("Get IDs1", DEDUPE_NODE), "Get IDs1 -> Dedupe Claim"],
  [edge(DEDUPE_NODE, "Get Hydrated Emails1"), "Dedupe Claim -> Get Hydrated Emails1"],
  [edge(TAP, PAYLOAD_NODE), `${TAP} -> ${PAYLOAD_NODE}`],
  [edge(PAYLOAD_NODE, ENGINE_NODE), `${PAYLOAD_NODE} -> ${ENGINE_NODE}`],
  [edge("If", "Loop Over Items"), "If[1] -> Loop Over Items (no stall)"],
];
console.log("\nverify:");
let bad = 0;
for (const [ok, label] of checks) { if (!ok) bad++; console.log(`  ${ok ? "OK  " : "FAIL"} ${label}`); }
console.log(`\nnodes=${after.nodes.length} active=${after.active}`);
if (bad) {
  console.error(`\n${bad} check(s) failed. Restore with: node scripts/restore-workflow.mjs "${backupPath}"`);
  process.exit(1);
}
console.log("installed OK.");
