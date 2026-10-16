// The system against what ops actually did. Every stored client email since FROM is re-read,
// re-grounded and re-planned by the code on disk against OnSinch as it was when the email
// arrived; ops' booking actions (scripts/ops-truth.mts) are given to the latest email from
// that client before them that asked for something. Read-only towards OnSinch.
//   npx tsx --env-file=.env.local scripts/score-vs-ops.mts [--paid] [--max-usd 5] [--json out] [--list]
// Without --paid the stored model readings are re-grounded (free). With --paid each email is
// read again by the CURRENT prompt with its thread and bookings (context.ts), each reading
// cached by prompt id + message + exact input in .tmp-data/extract-cache.jsonl, so a rerun
// pays only for what changed; spend is appended to .tmp-v2/spend.json.
// A failure is any email where ops created or updated an order and the system would not have,
// or where the system would write and ops did nothing. The bar is 1 in 100 (Ben, 10-13).
import { neon } from "@neondatabase/serverless";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ground } from "../app/lib/v2/interpret/interpret";
import { latestText } from "../app/lib/v2/interpret/ground";
import { plan } from "../app/lib/v2/interpret/plan";
import { extractWithMeta, interpretModel, PROMPT_ID } from "../app/lib/v2/interpret/extract";
import { contextText } from "../app/lib/v2/interpret/context";
import { onsinchWorld, readContext } from "../app/lib/v2/process";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg("--from", "2026-10-09T10:20:00Z");
const LIMIT = Number(arg("--limit", "0"));
const PAID = process.argv.includes("--paid");
const MAX_USD = Number(arg("--max-usd", "5"));
const acts = JSON.parse(readFileSync(arg("--acts", ".tmp-data/ops-truth-acts.json"), "utf8")) as any[];
const sql = neon((process.env.DATABASE_URL || "").trim());
const live = onsinchWorld();
const cache = new Map<number, any[]>();
const orders = async (c: number) => { if (!cache.has(c)) cache.set(c, await live.companyOrders(c)); return cache.get(c)!; };
const worldAt = (sent: string) => ({ ...live, companyOrders: async (c: number) => (await orders(c)).filter((o: any) => Date.parse(o.created) <= Date.parse(sent)) });
const rows = (await sql`SELECT d.message_id, d.decision, d.interpretation->'extraction' AS x, d.from_address, d.company, d.company_id, m.thread_id, m.subject, m.body, m.date_iso
  FROM v2_decisions d JOIN thread_messages m USING (message_id) WHERE coalesce(d.code_version,'') <> 'local' AND d.created_at > ${FROM} AND d.interpretation IS NOT NULL ORDER BY m.date_iso`) as any[];
// --limit N: the newest N, so a paid comparison of two models costs what it says.
if (LIMIT > 0) rows.splice(0, Math.max(0, rows.length - LIMIT));

const CACHE = ".tmp-data/extract-cache.jsonl";
const readings = new Map<string, any>();
if (existsSync(CACHE)) for (const l of readFileSync(CACHE, "utf8").split("\n")) if (l.trim()) { const j = JSON.parse(l); readings.set(j.key, j); }
let spent = 0, calls = 0;

async function readOf(r: any, text: string, read: any) {
  if (!PAID) return { x: r.x, read: undefined };
  const ctx = contextText(read);
  // The model is part of a reading: keyed without it, a run with another model is served the
  // old model's cached readings and scores them as the new one's.
  const key = `${PROMPT_ID}|${interpretModel()}|${r.message_id}|${createHash("sha256").update(`${r.subject}\n${text}\n${ctx}`).digest("hex").slice(0, 16)}`;
  const hit = readings.get(key);
  if (hit) return { x: hit.x, read };
  if (spent >= MAX_USD) throw new Error(`budget for this run (${MAX_USD} USD) reached`);
  const from = String(r.from_address ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
  const got = await extractWithMeta(r.date_iso, from, String(r.subject ?? ""), text, ctx);
  spent += got.meta.cost_usd ?? 0.01; calls++;
  const rec = { key, x: got.x, meta: got.meta };
  readings.set(key, rec);
  appendFileSync(CACHE, JSON.stringify(rec) + "\n");
  return { x: got.x, read };
}

const ACTION = new Set(["booking", "change", "quote_request", "cancellation", "unclear"]);
const prep: any[] = [];
for (const r of rows) {
  const text = latestText(r.body);
  const thread = ((await sql`SELECT is_from_spartan, date_iso, body FROM thread_messages WHERE thread_id = ${r.thread_id} AND date_iso < ${r.date_iso} ORDER BY date_iso`) as any[])
    .slice(-6).map((t) => ({ who: t.is_from_spartan ? "spartan" : "client", at: String(t.date_iso), text: latestText(String(t.body ?? "")) }));
  const read = PAID ? await readContext(worldAt(r.date_iso), r.company_id ? Number(r.company_id) : null, r.date_iso, thread as any) : undefined;
  prep.push({ r, text, read });
}
// Readings in parallel (6 at a time); planning after, in order, because it reads the thread's earlier requests.
const got: any[] = new Array(prep.length);
for (let i = 0; i < prep.length; i += 6) {
  await Promise.all(prep.slice(i, i + 6).map(async (p, k) => {
    try { got[i + k] = await readOf(p.r, p.text, p.read); } catch (e) { got[i + k] = { error: String((e as Error).message).slice(0, 120) }; }
  }));
}
const out: any[] = [];
const priorBy = new Map<string, any[]>();
for (const [idx, { r, text }] of prep.entries()) {
  let g: any = { intent: "?" }, d: any;
  try {
    if (got[idx].error) throw new Error(got[idx].error);
    const { x, read } = got[idx];
    const [b] = (await sql`SELECT onsinch_order_id FROM conversation_state WHERE thread_id = ${r.thread_id}`) as any[];
    g = ground(x, `${r.subject}\n${text}`, r.date_iso, { subject: r.subject ?? "", prior: priorBy.get(r.thread_id) ?? [], read, linkedOrderId: b?.onsinch_order_id ? Number(b.onsinch_order_id) : null });
    priorBy.set(r.thread_id, [...(priorBy.get(r.thread_id) ?? []), ...g.requests]);
    d = await plan({ message_id: r.message_id, from: r.from_address, subject: r.subject, sentIso: r.date_iso, text }, g, worldAt(r.date_iso), b?.onsinch_order_id ? Number(b.onsinch_order_id) : null);
  } catch (e) { d = { kind: "handoff", reasons: [`replay threw: ${String((e as Error).message).slice(0, 100)}`] }; }
  out.push({ id: r.message_id, at: r.date_iso, company_id: Number(r.company_id), company: r.company, subject: r.subject, intent: g.intent, kind: d.kind, reply: !!d.reply, said: d.why ?? d.reasons ?? [d.reason], ops: d.ops?.map((o: any) => o.op) ?? [], staff: [] as any[] });
}
// Each staff action goes to an email: an order's later edits to the latest asking email on the
// thread that order was created from (or that names it), else to the client's latest asking
// email in the 36 hours before. A "thanks" on another thread no longer takes a booking's edits.
const threadOf = new Map(rows.map((r) => [r.message_id, r.thread_id]));
const orderThread = new Map<number, string>();
for (const e of out) for (const n of String(e.said.join(" ") + " " + e.subject).match(/R\d{5}/g) ?? []) { const a = acts.find((x) => `R${x.number}` === n); if (a && !orderThread.has(a.order_id)) orderThread.set(a.order_id, threadOf.get(e.id)!); }
for (const a of acts.filter((a) => a.by !== 2257).sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
  const asking = (list: any[]) => [...list].reverse().find((x) => ACTION.has(x.intent));
  const onThread = orderThread.has(a.order_id) ? out.filter((e) => threadOf.get(e.id) === orderThread.get(a.order_id) && Date.parse(e.at) <= Date.parse(a.at) && Date.parse(a.at) - Date.parse(e.at) <= 7 * 864e5) : [];
  const before = out.filter((e) => e.company_id === a.company_id && Date.parse(e.at) <= Date.parse(a.at) && Date.parse(a.at) - Date.parse(e.at) <= 36 * 3600e3);
  const e = asking(onThread) ?? (onThread.length ? undefined : asking(before) ?? before[before.length - 1]);
  if (!e) continue;
  e.staff.push(a);
  if (a.what === "create order" && !orderThread.has(a.order_id)) orderThread.set(a.order_id, threadOf.get(e.id)!);
}
for (const e of out) {
  e.truth = e.staff.some((a: any) => a.what === "create order") ? "create" : e.staff.length ? "update" : "none";
  const creates = e.ops.some((o: any) => o.kind === "create_order");
  const writes = e.kind === "write";
  const touched = new Set(e.staff.map((a: any) => a.order_id));
  if (e.truth === "none") {
    // The system's create for a job ops created on a later email of the same client (within
    // 36h) is the same booking, not a false one.
    const later = creates && acts.some((a) => a.by !== 2257 && a.what === "create order" && a.company_id === e.company_id && Date.parse(a.at) >= Date.parse(e.at) && Date.parse(a.at) - Date.parse(e.at) <= 36 * 3600e3);
    // A new order for a request ops then left alone is in To Confirm for ops to decline; a write
    // to an existing order ops left alone is a change nobody asked for.
    e.verdict = writes && !later ? (creates ? "CREATED, OPS DID NOT BOOK" : "FALSE WRITE") : "ok";
  } else if (e.truth === "create") e.verdict = creates ? "ok" : writes ? "wrote, but ops created an order" : "MISSED CREATE";
  // The replay reads OnSinch as it is NOW, after ops made the change, so a plan that finds the
  // change already in place on the very order ops touched ("already booked: R11498", "R11224
  // shift 41613: times to ..." with nothing left to send) aimed right and is counted so.
  else if (!writes && e.kind === "none" && /already|times to|crew in all|add a shift/.test(e.said.join(" ")) && e.staff.some((a: any) => e.said.join(" ").includes(`R${a.number}`))) e.verdict = "ok";
  else e.verdict = writes && e.ops.some((o: any) => touched.has(Number(o.order_id))) ? "ok" : writes && creates ? "created, but ops updated an order" : writes ? "wrote another order" : "MISSED UPDATE";
}
// Failures read one by one and found not to be the system's (a staff edit after a "thanks", a
// change made before the window, OnSinch already changed by ops in the replay) are labelled in
// .tmp-data/truth-labels.json with the reason; a full request ops chose not to book is right.
const LABELS = existsSync(".tmp-data/truth-labels.json") ? JSON.parse(readFileSync(".tmp-data/truth-labels.json", "utf8")) : {};
for (const e of out) { const l = LABELS[e.id]; if (!l || e.verdict === "ok") continue; e.label = l.label; if (l.label === "to_confirm") e.verdict = "ok"; }
const work = out.filter((e) => (e.truth !== "none" || e.kind === "write") && e.label !== "noise");
const noise = out.filter((e) => e.label === "noise").length;
const bad = work.filter((e) => e.verdict !== "ok");
if (PAID) {
  const SP = ".tmp-v2/spend.json";
  const j = existsSync(SP) ? JSON.parse(readFileSync(SP, "utf8")) : { budget_usd: 50, spent_usd: 0, runs: [] };
  j.spent_usd = Math.round((j.spent_usd + spent) * 10000) / 10000;
  j.runs.push({ at: new Date().toISOString(), what: `score-vs-ops --paid (${PROMPT_ID})`, calls, usd: Math.round(spent * 10000) / 10000 });
  writeFileSync(SP, JSON.stringify(j, null, 1));
  console.log(`paid readings: ${calls} new, ${spent.toFixed(3)} USD this run; session total ${j.spent_usd} of ${j.budget_usd} USD`);
}
console.log(`emails ${out.length}; booking work ${work.length} (ops created after ${out.filter((e) => e.truth === "create").length}, updated after ${out.filter((e) => e.truth === "update").length}, system-only writes ${out.filter((e) => e.truth === "none" && e.kind === "write").length})`);
console.log(`done right ${work.length - bad.length} of ${work.length}; failures ${bad.length} (${((bad.length / Math.max(1, work.length)) * 100).toFixed(1)}%, bar 1%); ${noise} labelled not the system's (truth-labels.json)`);
const tally: Record<string, number> = {};
for (const e of bad) { const k = `${e.verdict} <- ${e.kind}${e.reply ? "/reply" : ""}: ${String(e.said[0] ?? "").replace(/R\d+|\d{4}-\d\d-\d\d|"[^"]*"|\b\d+\b/g, "#").slice(0, 70)}`; tally[k] = (tally[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), k);
const json = process.argv.indexOf("--json");
if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(out, null, 1));
if (process.argv.includes("--list")) for (const e of bad) console.log(`${e.at.slice(5, 16)} ${e.verdict.padEnd(16)} ${String(e.company).slice(0, 20).padEnd(20)} | ${String(e.subject).slice(0, 38).padEnd(38)} | ${e.said.join("; ").slice(0, 160)} | ops: ${e.staff.map((a: any) => `${a.what} R${a.number}`).slice(0, 4).join(", ")}`);
