// ============================================================================
// Store, without deciding, the client emails intake never took during the 10-21 pause.
// ----------------------------------------------------------------------------
// Owner, 2026-10-25: "store them without deciding". 40 client emails sent 10-21 01:05Z ..
// 10-22 00:25Z carry intake's label and are not in thread_messages (audit/live-state-2026-10-24.md).
// Intake's own catch-up looks back 72 hours, so nothing else will ever store them.
//
//   npx tsx --env-file=.env.local scripts/backfill-pause-window.mts pull    Gmail -> .tmp-v2 (no DB write)
//   npx tsx --env-file=.env.local scripts/backfill-pause-window.mts plan    read-only: what a write would store
//   npx tsx --env-file=.env.local scripts/backfill-pause-window.mts store   stores; refuses before the safe time
//
// WHY THE WRITE WAITS. The minute sync's sweepUndecided (app/lib/v2/process.ts) decides any
// client email first stored in the last 24 h that was sent within UNDECIDED_SENT_WITHIN_DAYS.
// Stored before that line, these 40 would be decided (a model call each, cards on the TV), which
// is the outcome the owner declined. After it, the sweep treats them as history, and the
// follow-up board treats their waits as dormant (followup/clock.ts DORMANT_AFTER_DAYS). The safe
// time is computed from the fetched dates and the constant read from process.ts, not typed here.
//
// WHY NOT /api/n8n-inbound. Its decideDelivery decides on whatever a delivery stores first, with
// no age rule. captureInboundRaw is the function that route stores with, called here alone.
//
// The fetch copies intake's own nodes (Get Hydrated Emails1 .. Build Engine Payload) from the
// live workflow into a temporary webhook workflow, so the payload is exactly what intake would
// have posted. "Dedupe Claim" is replaced by a stub that claims nothing; its `degraded` field
// marks each payload as this backfill in inbound_raw. The workflow is deleted in a finally.
// Bodies and addresses go to .tmp-v2/ (gitignored) and are never printed.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadEnv, requireEnv } from "./_env.mjs";
import { readOnlySql, proveReadOnly } from "./_readonly.mts";

const IDS = ".tmp-v2/ids.json";            // the Gmail list from the 10-25 check: { id, t, at, c }[]
const OUT = ".tmp-v2/backfill-payloads.json";
const INTAKE = "CPIRu7CpezvKjU8d";
const COPIED = ["Get Hydrated Emails1", "Get a thread2", "Merge1", "Normalize Data", "MAINDATA", "Conversational Renderer", "Build Engine Payload"];
const MARK = "backfill 2026-10-25: owner ruled store-only; not claimed, not decided";

type Listed = { id: string; t: string; at: string; c: boolean };
type Payload = { thread_id: string; messages: { message_id: string; date_iso: string; is_from_spartan: boolean }[] };

const ro = readOnlySql();
const mode = process.argv[2];

/** Client emails from the Gmail list that the store does not hold. */
async function targets(): Promise<Listed[]> {
  const listed = (JSON.parse(readFileSync(IDS, "utf8")) as Listed[]).filter((r) => r.c);
  const held = new Set((await ro`SELECT message_id FROM thread_messages WHERE message_id = ANY(${listed.map((r) => r.id)})`).map((r) => r.message_id));
  return listed.filter((r) => !held.has(r.id));
}

function sentWithinDays(): number {
  const m = readFileSync("app/lib/v2/process.ts", "utf8").match(/UNDECIDED_SENT_WITHIN_DAYS\s*=\s*(\d+)/);
  if (!m) throw new Error("UNDECIDED_SENT_WITHIN_DAYS not found in app/lib/v2/process.ts: re-derive the safe time before writing");
  return Number(m[1]);
}

async function n8n(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${requireEnv("N8N_BASE")}${path}`, { ...init, headers: { "X-N8N-API-KEY": requireEnv("N8N_API_KEY"), "content-type": "application/json" } });
  const text = await r.text();
  if (!r.ok) throw new Error(`n8n ${init.method ?? "GET"} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchPayloads(): Promise<void> {
  loadEnv();
  const want = await targets();
  console.log(`unstored client emails in the Gmail list: ${want.length}`);
  const live = await n8n(`/workflows/${INTAKE}`);
  const byName = Object.fromEntries(live.nodes.map((n: any) => [n.name, n]));
  const missing = COPIED.filter((n) => !byName[n]);
  if (missing.length) throw new Error(`intake no longer has: ${missing.join(", ")}`);

  const path = `bf-${randomUUID()}`;
  const nodes = [
    { name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: randomUUID(),
      parameters: { httpMethod: "POST", path, responseMode: "lastNode", responseData: "firstEntryJson", options: {} } },
    { name: "Get IDs1", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [200, 0],
      parameters: { assignments: { assignments: [
        { id: randomUUID(), name: "id", value: "={{ $json.body.id }}", type: "string" },
        { id: randomUUID(), name: "threadId", value: "={{ $json.body.threadId }}", type: "string" },
      ] }, options: {} } },
    { name: "Dedupe Claim", type: "n8n-nodes-base.code", typeVersion: 2, position: [400, 0],
      parameters: { mode: "runOnceForEachItem", jsCode: `return { json: { ...$json, found: false, first_seen: true, degraded: ${JSON.stringify(MARK)} } };` } },
    ...COPIED.map((name, i) => {
      const { id: _id, ...n } = byName[name];
      return { ...n, position: [600 + 200 * i, 0] };
    }),
  ];
  const connections = {
    "Webhook": { main: [[{ node: "Get IDs1", type: "main", index: 0 }]] },
    "Get IDs1": { main: [[{ node: "Dedupe Claim", type: "main", index: 0 }]] },
    "Dedupe Claim": { main: [[{ node: "Get Hydrated Emails1", type: "main", index: 0 }]] },
    "Get Hydrated Emails1": { main: [[{ node: "Get a thread2", type: "main", index: 0 }, { node: "Merge1", type: "main", index: 0 }]] },
    "Get a thread2": { main: [[{ node: "Merge1", type: "main", index: 1 }]] },
    "Merge1": { main: [[{ node: "Normalize Data", type: "main", index: 0 }]] },
    "Normalize Data": { main: [[{ node: "MAINDATA", type: "main", index: 0 }]] },
    "MAINDATA": { main: [[{ node: "Conversational Renderer", type: "main", index: 0 }]] },
    "Conversational Renderer": { main: [[{ node: "Build Engine Payload", type: "main", index: 0 }]] },
  };

  const wf = await n8n("/workflows", { method: "POST", body: JSON.stringify({ name: "TEMP backfill fetch 10-21 pause (delete me)", nodes, connections, settings: { executionOrder: "v1" } }) });
  const payloads: Record<string, Payload> = {};
  try {
    await n8n(`/workflows/${wf.id}/activate`, { method: "POST" });
    const hook = `${new URL(requireEnv("N8N_BASE")).origin}/webhook/${path}`;
    for (const t of want) {
      const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: t.id, threadId: t.t }) });
      const p = r.ok ? ((await r.json()) as Payload) : null;
      if (p && p.thread_id && Array.isArray(p.messages)) payloads[t.id] = p;
      else console.log(`  ${t.id}: no payload (${r.status})`);
    }
  } finally {
    await n8n(`/workflows/${wf.id}/deactivate`, { method: "POST" }).catch(() => {});
    await n8n(`/workflows/${wf.id}`, { method: "DELETE" });
    console.log("temporary workflow deleted");
  }
  writeFileSync(OUT, JSON.stringify(payloads));
  const msgs = Object.values(payloads).reduce((s, p) => s + p.messages.length, 0);
  console.log(`payloads: ${Object.keys(payloads).length} of ${want.length}; messages across them: ${msgs}`);
}

/** What a write would store, and the earliest time it may. Read-only. */
async function plan() {
  const want = await targets();
  const wanted = new Set(want.map((t) => t.id));
  const payloads = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, Payload>;
  const all = new Map<string, Payload["messages"][number]>();
  for (const p of Object.values(payloads)) for (const m of p.messages) all.set(m.message_id, m);
  const held = new Set((await ro`SELECT message_id FROM thread_messages WHERE message_id = ANY(${[...all.keys()]})`).map((r) => r.message_id));
  const fresh = [...all.values()].filter((m) => !held.has(m.message_id));
  const theirs = fresh.filter((m) => !m.is_from_spartan);
  const foreign = theirs.filter((m) => !wanted.has(m.message_id)).map((m) => m.message_id);
  const covered = want.filter((t) => all.has(t.id)).length;
  const newest = Math.max(...theirs.filter((m) => wanted.has(m.message_id)).map((m) => Date.parse(m.date_iso)));
  const safe = new Date(newest + sentWithinDays() * 86_400_000 + 10 * 60_000);
  return { payloads, want, wanted, foreign: new Set(foreign), safe, report: {
    targets: want.length, targets_in_payloads: covered, messages_in_payloads: all.size, already_stored: held.size,
    would_store_ours: fresh.length - theirs.length, would_store_targets: theirs.length - foreign.length,
    unlisted_client_messages_dropped: foreign.length, newest_target_sent: new Date(newest).toISOString(), safe_after: safe.toISOString(),
  } };
}

async function write() {
  const p = await plan();
  console.log(p.report);
  if (Date.now() < p.safe.getTime()) { console.log(`REFUSED: the undecided sweep would decide these until ${p.safe.toISOString()}`); process.exit(1); }
  if (p.report.targets_in_payloads !== p.report.targets) { console.log("REFUSED: some targets are in no payload; re-run pull"); process.exit(1); }
  const { captureInboundRaw } = await import("../app/lib/inboundRawDb.ts");
  let stored = 0, failed = 0;
  for (const payload of Object.values(p.payloads)) {
    const kept = { ...payload, messages: payload.messages.filter((m) => !p.foreign.has(m.message_id)) };
    const r = await captureInboundRaw(kept, "backfill");
    stored += r.messages_stored; if (!r.ok) failed++;
  }
  const ids = [...p.wanted];
  const [inStore] = await ro`SELECT count(*)::int AS n FROM thread_messages WHERE message_id = ANY(${ids})`;
  const [decided] = await ro`SELECT count(*)::int AS n FROM v2_decisions WHERE message_id = ANY(${ids})`;
  console.log({ messages_stored: stored, captures_failed: failed, targets_now_in_store: inStore.n, targets_with_a_decision: decided.n });
}

await proveReadOnly(ro);
if (mode === "pull") await fetchPayloads();
else if (mode === "plan") console.log((await plan()).report);
else if (mode === "store") await write();
else console.log("usage: pull | plan | store");
