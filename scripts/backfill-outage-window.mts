// ============================================================================
// Store and decide the mail an intake outage longer than the catch-up sweep's 72 hours left behind.
// ----------------------------------------------------------------------------
// 12 Nov 16:40Z .. 17 Nov 13:32Z every intake poll failed at its Gmail step (credential "Gmail account 16"),
// and the intake's own "MANUAL: catch-up sweep" stops at 72 hours by design (the "New" label still sits on
// ~6,500 messages from before the pipeline). Ben, 17 Nov: "do the backfill yourself". This does what that
// sweep does, over the outage window: list the "New"-labelled mail received in it, run each unstored message
// through the intake's own nodes (Get IDs1 .. POST to Engine, copied from the published version), then remove
// the label. It posts to /api/n8n-inbound like any poll, so the mail is stored AND decided; that is the
// difference from backfill-pause-window.mts, whose window the owner ruled store-only.
//
//   BF_AFTER=<iso> BF_UNTIL=<iso> npx tsx scripts/backfill-outage-window.mts list   list + compare with the store
//   ... run [max]                      process the unstored, oldest first (later ones in a posted thread ride along)
//   ... audit                          ALL mail in the window, labelled or not, against the store (24-hour slices)
//   ... one <message id> <thread id>   one message the "New" label never marked, through the same chain
//   ... cleanup                        delete a leftover temporary workflow
//
// THE AUDIT IS NOT OPTIONAL. Only "New"-labelled mail is intake. On 17 Nov one booking thread's 2 client replies
// and 2 of ours (13-16 Nov) had never carried the label; only the audit found them (posted with `one`). A thread
// the label misses is invisible to the intake, outage or not.
//
// The temporary workflow lives in the intake's project (the Gmail credential is shared there only) and is
// deleted in a finally. Ids only are printed; bodies and addresses never leave n8n for this machine.
//
// 17 Nov run: 92 thread posts + 1, 0 errors; client emails in the window stored and decided 30 -> 159;
// the audit then found 367 of 367 window messages stored.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadEnv, requireEnv } from "./_env.mjs";
import { readOnlySql, proveReadOnly } from "./_readonly.mts";

loadEnv();
const INTAKE = "CPIRu7CpezvKjU8d";
// Defaults: the 12-17 Nov outage (last stored client mail 16:36Z, first failed poll 16:40Z; first good 13:32Z).
const AFTER = process.env.BF_AFTER ?? "2026-11-12T16:30:00Z";
const UNTIL = process.env.BF_UNTIL ?? "2026-11-17T13:40:00Z";
const NAME = "TEMP outage backfill (delete me)";
const LIST = ".tmp-v2/outage-list.json";
const LOG = ".tmp-v2/outage-run.json";
const DEADLINE_MIN = Number(process.env.BF_DEADLINE_MIN ?? 100);
const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";
const ORIGIN = new URL(BASE).origin;
const ro = readOnlySql();
const t0 = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function n8n(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(BASE + path, { ...init, headers: { "X-N8N-API-KEY": requireEnv("N8N_API_KEY"), "content-type": "application/json" } });
  const text = await r.text();
  if (!r.ok) throw new Error(`n8n ${init.method ?? "GET"} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function cleanup() {
  const all = (await n8n("/workflows?limit=250")).data as any[];
  for (const w of all.filter((w) => w.name === NAME)) {
    await n8n(`/workflows/${w.id}/deactivate`, { method: "POST" }).catch(() => {});
    await destroy(w.id);
  }
}

type Paths = { list: string; proc: string; unlabel: string; all: string };

async function create(): Promise<{ id: string; paths: Paths }> {
  const intake = await n8n(`/workflows/${INTAKE}`);
  const live = intake.activeVersion ?? intake;
  const project = intake.shared?.[0]?.projectId;
  if (!project) throw new Error("intake project unknown");
  const by: Record<string, any> = Object.fromEntries(live.nodes.map((n: any) => [n.name, n]));
  const CHAIN = ["Get IDs1", "Dedupe Claim", "First seen?", "Get Hydrated Emails1", "Get a thread2", "Merge1", "Normalize Data", "MAINDATA", "Conversational Renderer", "Build Engine Payload", "POST to Engine"];
  const missing = [...CHAIN, "Get many messages", "Remove label from message"].filter((n) => !by[n]);
  if (missing.length) throw new Error(`intake no longer has: ${missing.join(", ")}`);
  const copy = (name: string, position: number[], over: Record<string, unknown> = {}) => { const { id: _id, ...n } = by[name]; return { ...n, position, ...over }; };
  const hook = (name: string, path: string, y: number, responseData: string) => ({ name, type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, y], webhookId: randomUUID(), parameters: { httpMethod: "POST", path, responseMode: "lastNode", responseData, options: {} } });
  const code = (name: string, position: number[], jsCode: string) => ({ name, type: "n8n-nodes-base.code", typeVersion: 2, position, parameters: { jsCode } });
  const paths: Paths = { list: `bf-list-${randomUUID()}`, proc: `bf-proc-${randomUUID()}`, unlabel: `bf-unlabel-${randomUUID()}`, all: `bf-all-${randomUUID()}` };
  const gm = by["Get many messages"].parameters;

  const nodes = [
    hook("List", paths.list, 0, "firstEntryJson"),
    copy("Get many messages", [200, 0], { name: "List window", alwaysOutputData: true, parameters: { ...gm, filters: { ...gm.filters, receivedAfter: "={{ $json.body.after }}", receivedBefore: "={{ $json.body.before }}" } } }),
    code("Ids only", [400, 0], "return [{ json: { items: $input.all().filter(i => i.json && i.json.id).map(i => ({ id: i.json.id, threadId: i.json.threadId, internalDate: i.json.internalDate ?? null })) } }];"),

    hook("Process", paths.proc, 300, "firstEntryJson"),
    // The shape "Get many messages" hands Get IDs1. from_address only feeds the dedupe ledger's note column.
    code("Listed item", [200, 300], "const b = $input.first().json.body || {};\nreturn [{ json: { id: b.id, threadId: b.threadId, historyId: '', from: [{ email: '' }], to: [{ email: '' }], ccEmails: [''] } }];"),
    ...CHAIN.map((name, i) => copy(name, [400 + 200 * i, 300])),
    code("Already claimed", [1000, 500], "return [{ json: { skipped: 'already claimed', found: $('Dedupe Claim').first().json.found === true } }];"),

    hook("All mail", paths.all, 1000, "firstEntryJson"),
    copy("Get many messages", [200, 1000], { name: "List all", alwaysOutputData: true, parameters: { ...gm, filters: { receivedAfter: "={{ $json.body.after }}", receivedBefore: "={{ $json.body.before }}" } } }),
    // Ids, label ids and one ours/theirs bit: no address leaves n8n.
    code("Classify", [400, 1000], "const pick = (v) => { if (!v) return ''; if (Array.isArray(v)) return pick(v[0]); if (typeof v === 'string') return v; if (v.text) return v.text; if (v.value) return pick(v.value); if (v.address) return v.address; if (v.email) return v.email; return ''; };\nreturn [{ json: { items: $input.all().filter(i => i.json && i.json.id).map(i => { const j = i.json; let f = pick(j.From ?? j.from); if (!f && j.payload && Array.isArray(j.payload.headers)) { const h = j.payload.headers.find(h => /^from$/i.test(h.name)); f = h ? h.value : ''; } const labels = j.labelIds ?? (j.labels || []).map(l => l.id); return { id: j.id, threadId: j.threadId, internalDate: j.internalDate ?? null, labels, hasFrom: !!f, ours: /spartancrew\\.co\\.uk/i.test(f) }; }) } }];"),
    hook("Unlabel", paths.unlabel, 700, "firstEntryJson"),
    copy("Remove label from message", [200, 700], { name: "Remove label", onError: "continueRegularOutput", parameters: { ...by["Remove label from message"].parameters, messageId: "={{ $json.body.id }}" } }),
  ];
  const c = (to: string, index = 0) => ({ node: to, type: "main", index });
  const connections: Record<string, any> = {
    "List": { main: [[c("List window")]] },
    "List window": { main: [[c("Ids only")]] },
    "Process": { main: [[c("Listed item")]] },
    "Listed item": { main: [[c("Get IDs1")]] },
    "Get IDs1": { main: [[c("Dedupe Claim")]] },
    "Dedupe Claim": { main: [[c("First seen?")]] },
    "First seen?": { main: [[c("Get Hydrated Emails1")], [c("Already claimed")]] },
    "Get Hydrated Emails1": { main: [[c("Get a thread2"), c("Merge1")]] },
    "Get a thread2": { main: [[c("Merge1", 1)]] },
    "Merge1": { main: [[c("Normalize Data")]] },
    "Normalize Data": { main: [[c("MAINDATA")]] },
    "MAINDATA": { main: [[c("Conversational Renderer")]] },
    "Conversational Renderer": { main: [[c("Build Engine Payload")]] },
    "Build Engine Payload": { main: [[c("POST to Engine")]] },
    "Unlabel": { main: [[c("Remove label")]] },
    "All mail": { main: [[c("List all")]] },
    "List all": { main: [[c("Classify")]] },
  };
  const settings = { executionOrder: "v1" };
  // Created bare, moved into the intake's project, then given its credentials: a create or update that names a
  // credential the workflow's current project cannot use is refused with 400.
  const stripped = nodes.map(({ credentials: _c, ...n }: any) => n);
  const wf = await n8n("/workflows", { method: "POST", body: JSON.stringify({ name: NAME, nodes: stripped, connections, settings }) });
  try {
    await n8n(`/workflows/${wf.id}/transfer`, { method: "PUT", body: JSON.stringify({ destinationProjectId: project }) });
    await n8n(`/workflows/${wf.id}`, { method: "PUT", body: JSON.stringify({ name: NAME, nodes, connections, settings }) });
    await n8n(`/workflows/${wf.id}/activate`, { method: "POST" });
    const got = await n8n(`/workflows/${wf.id}`);
    const pub = (got.activeVersion ?? got).nodes as any[];
    const want = by["Get many messages"].credentials.gmailOAuth2.id;
    const gmail = pub.filter((n) => n.type === "n8n-nodes-base.gmail");
    const bad = gmail.filter((n) => n.credentials?.gmailOAuth2?.id !== want).map((n) => n.name);
    if (bad.length || !got.active) throw new Error(`temp workflow not ready: active=${got.active} missing credential on ${bad.join(", ")}`);
    console.log(`temp workflow ${wf.id} active in ${project}; ${gmail.length} Gmail nodes on credential ${want}`);
  } catch (e) {
    await n8n(`/workflows/${wf.id}`, { method: "DELETE" }).catch(() => {});
    throw e;
  }
  return { id: wf.id, paths };
}

async function destroy(id: string) {
  await n8n(`/workflows/${id}/deactivate`, { method: "POST" }).catch(() => {});
  // n8n answers 409 "still being unpublished" for a few seconds after a deactivate.
  for (let k = 0; ; k++) {
    try { await n8n(`/workflows/${id}`, { method: "DELETE" }); break; }
    catch (e) { if (k >= 11 || !/409/.test(String(e))) throw e; await sleep(5_000); }
  }
  console.log("temporary workflow deleted");
}

async function call(path: string, body: unknown, ms: number): Promise<{ status: number; json: any }> {
  try {
    const r = await fetch(`${ORIGIN}/webhook/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 120) }; }
    return { status: r.status, json };
  } catch (e) { return { status: 0, json: { error: String((e as Error).message).slice(0, 120) } }; }
}

type Listed = { id: string; threadId: string; internalDate: string | null };

async function listWindow(paths: Paths): Promise<Listed[]> {
  const before = new Date().toISOString();
  const r = await call(paths.list, { after: AFTER, before }, 240_000);
  if (r.status !== 200 || !Array.isArray(r.json?.items)) throw new Error(`list failed: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  const items = r.json.items as Listed[];
  // Gmail lists newest first; internalDate (ms) when the simple output carries it.
  const dated = items.every((i) => i.internalDate);
  const sorted = dated ? [...items].sort((a, b) => Number(a.internalDate) - Number(b.internalDate)) : [...items].reverse();
  writeFileSync(LIST, JSON.stringify({ after: AFTER, before, dated, items: sorted }));
  return sorted;
}

async function storeState(ids: string[]) {
  const rows = await ro`SELECT m.message_id, m.is_from_spartan, EXISTS (SELECT 1 FROM v2_decisions d WHERE d.message_id = m.message_id) AS decided
    FROM thread_messages m WHERE m.message_id = ANY(${ids})`;
  return new Map(rows.map((r: any) => [String(r.message_id), { ours: !!r.is_from_spartan, decided: !!r.decided }]));
}

async function report(items: Listed[], label: string) {
  const st = await storeState(items.map((i) => i.id));
  const stored = [...st.values()];
  const threads = new Set(items.map((i) => i.threadId)).size;
  const unstoredThreads = new Set(items.filter((i) => !st.has(i.id)).map((i) => i.threadId)).size;
  console.log(`${label}: listed ${items.length} in ${threads} threads | stored ${stored.length} (client ${stored.filter((s) => !s.ours).length}, decided ${stored.filter((s) => s.decided).length}) | unstored ${items.length - stored.length} in ${unstoredThreads} threads`);
  return st;
}

async function run(max: number) {
  const { id, paths } = await create();
  const log: any[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];
  try {
    const items = await listWindow(paths);
    let st = await report(items, "before");
    let done = 0;
    for (const it of items) {
      if (done >= max) break;
      if ((Date.now() - t0) / 60_000 > DEADLINE_MIN) { console.log("deadline reached; stopping"); break; }
      st = await storeState([it.id]).then((m) => new Map([...st, ...m]));
      if (st.has(it.id)) continue;                      // already stored by an earlier thread post
      const s = Date.now();
      const r = await call(paths.proc, { id: it.id, threadId: it.threadId }, 280_000);
      // A webhook timeout does not stop the execution: wait for the store before moving on.
      let landed = (await storeState([it.id])).get(it.id);
      for (let k = 0; !landed && k < 24 && r.status !== 200; k++) { await sleep(10_000); landed = (await storeState([it.id])).get(it.id); }
      const j = r.json ?? {};
      const kinds: Record<string, number> = {};
      for (const d of Array.isArray(j.decided) ? j.decided : []) kinds[d.decision ?? (d.skipped ? "skipped" : "null")] = (kinds[d.decision ?? (d.skipped ? "skipped" : "null")] ?? 0) + 1;
      const row = { id: it.id, thread: it.threadId, http: r.status, ok: j.ok ?? null, skipped: j.skipped ?? null, error: j.error ? String(j.error).slice(0, 80) : null, captured: j.captured ?? null, kinds, stored: !!landed, ms: Date.now() - s };
      log.push(row); writeFileSync(LOG, JSON.stringify(log));
      done++;
      console.log(`${String(done).padStart(3)} ${it.id} http ${row.http} ok ${row.ok} stored ${row.stored} ${JSON.stringify(kinds)}${row.skipped ? " SKIPPED " + row.skipped : ""}${row.error ? " ERR " + row.error : ""} ${Math.round(row.ms / 1000)}s`);
    }
    st = await report(items, "after");
    // Parity with the sweep: listed mail loses the "New" label, here only once it is in the store.
    let unl = 0, unlFail = 0;
    for (const it of items.filter((i) => st.has(i.id))) {
      const r = await call(paths.unlabel, { id: it.id }, 60_000);
      if (r.status === 200 && !r.json?.error) unl++; else unlFail++;
    }
    console.log(`unlabelled ${unl}, failed ${unlFail}`);
  } finally {
    await destroy(id);
  }
}

/** Every message received in the window, labelled or not, against the store; 24-hour slices so no call is huge. */
async function audit() {
  const { id, paths } = await create();
  const all: any[] = [];
  try {
    for (let a = Date.parse(AFTER); a < Date.parse(UNTIL); a += 86_400_000) {
      const b = Math.min(a + 86_400_000, Date.parse(UNTIL));
      const r = await call(paths.all, { after: new Date(a).toISOString(), before: new Date(b).toISOString() }, 280_000);
      if (r.status !== 200 || !Array.isArray(r.json?.items)) throw new Error(`all-mail list failed: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
      all.push(...r.json.items);
    }
  } finally { await destroy(id); }
  writeFileSync(".tmp-v2/outage-allmail.json", JSON.stringify(all));
  const st = await storeState(all.map((i) => i.id));
  const storedThreads = new Set((await ro`SELECT DISTINCT thread_id FROM thread_messages WHERE thread_id = ANY(${[...new Set(all.map((i) => i.threadId))]})`).map((r: any) => String(r.thread_id)));
  const NEW = "Label_5089401050847698788";
  const tally: Record<string, number> = {};
  const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
  for (const m of all) {
    const labels: string[] = m.labels ?? [];
    const cat = labels.find((l) => l.startsWith("CATEGORY_")) ?? "no-category";
    const where = labels.includes("SENT") ? "SENT" : labels.includes("INBOX") ? "INBOX" : labels.includes("DRAFT") ? "DRAFT" : "archived";
    bump(`${st.has(m.id) ? "stored" : "UNSTORED"} | ${m.ours ? "ours" : m.hasFrom ? "theirs" : "no-from"} | ${where} | ${cat} | New:${labels.includes(NEW)} | thread stored:${storedThreads.has(m.threadId)}`);
  }
  console.log(`all mail in window: ${all.length}; stored ${all.filter((m) => st.has(m.id)).length}`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), k);
}

async function listOnly() {
  const { id, paths } = await create();
  try { await report(await listWindow(paths), "now"); } finally { await destroy(id); }
}

await proveReadOnly(ro);
const mode = process.argv[2];
if (mode === "list") await listOnly();
else if (mode === "run") await run(Number(process.argv[3] ?? 1e9));
else if (mode === "cleanup") await cleanup();
else if (mode === "audit") await audit();
else if (mode === "one") {
  // One message the "New" label never marked, through the same chain as the sweep.
  const [msg, thread] = [process.argv[3], process.argv[4]];
  const { id, paths } = await create();
  try {
    const r = await call(paths.proc, { id: msg, threadId: thread }, 280_000);
    const j = r.json ?? {};
    console.log("http", r.status, "ok", j.ok, "captured", j.captured, "decided", JSON.stringify((j.decided ?? []).map((d: any) => d.decision ?? d.skipped)), j.skipped ?? "", j.error ? "ERR " + String(j.error).slice(0, 80) : "");
  } finally { await destroy(id); }
}
else console.log("usage: list | run [max] | cleanup");
process.exit(0);
