// ============================================================================
// The matcher's evidence for every gold email (app/lib/match/match.ts), with OnSinch as it stood
// when the email arrived, and the two numbers step 3 of the matcher plan ends with: candidate
// recall (the true order is offered) and how often each family of evidence is available.
// ----------------------------------------------------------------------------
// As at the email: an order made later is never offered (match.ts L1); a change staff made later
// is undone from the timeline's own old values, newest first (a slot's times, size, cancel flag,
// profession and role); a shift or position added later is removed; a cancel made later (which
// the timeline never logs) is undone from the order's modified stamp. Without this, a time change
// the email asked for already sits on the order and reads as agreement (audit 22 Oct).
// Precedents are the gold labels of the sender's and the thread's earlier emails; the thread's
// link is the job_links row that existed then. $0: no model, no write.
//
//   npx tsx scripts/gold/features.mts [--dir .tmp-data/gold] [--measure]
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { corpus } from "../../app/lib/match/ngram";
import { indexWorld, match, FAMILIES, type MatchMsg, type Reading, type Precedent } from "../../app/lib/match/match";
import { recordMeasurement } from "../_gateMeasure.mjs";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir", ".tmp-data/gold");
const load = (n: string) => JSON.parse(readFileSync(`${DIR}/${n}.json`, "utf8"));
const meta = load("meta");
const messages: any[] = load("messages"), readings: any[] = load("readings"), companies: any[] = load("companies");
const orders: any[] = load("orders"), places: any[] = load("places"), timeline: any[] = load("timeline"), links: any[] = load("links");
const rows: any[] = readFileSync(`${DIR}/truth.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const addr = (f: unknown) => String(f ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
const val = (g: any) => (g && typeof g === "object" && "value" in g ? g.value : g) ?? undefined;
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); };

// ---- the world, indexed once ------------------------------------------------------------------
const C = corpus([...places.map((p) => p.name), ...places.map((p) => p.alias).filter(Boolean), ...orders.map((o) => o.name), ...companies.map((c) => c.name)]);
const ix = indexWorld(companies, orders, places.map((p) => ({ id: Number(p.id), name: String(p.name ?? ""), alias: p.alias || undefined, address: p.address || undefined, zip: p.zip || undefined })), C);

// Every later change, by the order it belongs to.
const owner = new Map<string, number>();
for (const o of orders) for (const j of [].concat(o.Job ?? []) as any[]) { owner.set(`Job:${j.id}`, Number(o.id)); for (const t of [].concat(j.SlotTeam ?? []) as any[]) { owner.set(`SlotTeam:${t.id}`, Number(o.id)); for (const s of [].concat(t.Slot ?? []) as any[]) owner.set(`Slot:${s.id}`, Number(o.id)); } }
type Change = { at: number; kind: "field" | "created"; model: string; id: string; fields?: Record<string, { old: unknown }> };
const changes = new Map<number, Change[]>();
const SLOT_FIELDS = new Set(["beginning", "end", "size", "cancelled", "profession_id", "role"]);
for (const a of timeline) {
  let d: any; try { d = JSON.parse(a.data); } catch { continue; }
  const at = Date.parse(a.created);
  if (a.action === "common_change" && d.model === "Slot") {
    const f = Object.fromEntries(Object.entries(d.diffChanges?.Slot ?? {}).filter(([k]) => SLOT_FIELDS.has(k))) as Record<string, { old: unknown }>;
    const oid = owner.get(`Slot:${d.id}`);
    if (oid && Object.keys(f).length) push(changes, oid, { at, kind: "field", model: "Slot", id: String(d.id), fields: f });
  } else if (a.action === "common_create" && (d.model === "Slot" || d.model === "SlotTeam")) {
    const oid = Number(/^Order:(\d+)/.exec(String(d.data?.path ?? ""))?.[1] ?? 0) || owner.get(`${d.model}:${d.id}`);
    if (oid) push(changes, oid, { at, kind: "created", model: d.model, id: String(d.id) });
  }
}
for (const list of changes.values()) list.sort((x, y) => y.at - x.at);
const utcIso = (s: unknown) => `${String(s).replace(" ", "T")}Z`;

/** The order as it stood at `at`. */
function asAtFor(at: number) {
  return (o: any) => {
    if (!o) return o;
    const later = (changes.get(Number(o.id)) ?? []).filter((c) => c.at > at);
    const gone = new Set(later.filter((c) => c.kind === "created").map((c) => `${c.model}:${c.id}`));
    const undo = new Map<string, Record<string, unknown>>();
    for (const c of later) if (c.kind === "field") { const u = undo.get(c.id) ?? {}; for (const [k, v] of Object.entries(c.fields!)) u[k] = v.old; undo.set(c.id, u); } // newest first, so the oldest later change's old value wins
    const slot = (s: any) => {
      const u = undo.get(String(s.id));
      let x = s.cancelled === true && Date.parse(s.modified) > at && !u ? { ...s, cancelled: false } : s;
      if (u) {
        x = { ...x };
        for (const [k, v] of Object.entries(u)) {
          if (k === "beginning" || k === "end") x[k] = utcIso(v);
          else if (k === "cancelled") x.cancelled = String(v) === "1" || v === true;
          else x[k] = Number(v);
        }
      }
      return x;
    };
    const job = ([] as any[]).concat(o.Job ?? []).map((j: any) => ({ ...j, SlotTeam: ([] as any[]).concat(j.SlotTeam ?? []).filter((t: any) => !gone.has(`SlotTeam:${t.id}`)).map((t: any) => ({ ...t, cancelled: t.cancelled === true && Date.parse(t.modified) > at ? false : t.cancelled, Slot: ([] as any[]).concat(t.Slot ?? []).filter((s: any) => !gone.has(`Slot:${s.id}`)).map(slot) })) }));
    // Cancelled (-1) or closed (-2, set once the job is over) after the email: live when it arrived.
    return { ...o, status: [-1, -2].includes(Number(o.status)) && Date.parse(o.modified) > at ? 0 : o.status, Job: job };
  };
}

// ---- the emails ------------------------------------------------------------------------------
const msgById = new Map(messages.map((m) => [m.message_id, m]));
const byThread = new Map<string, any[]>();
for (const m of messages) push(byThread, m.thread_id, m);
for (const t of byThread.values()) t.sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
const asMsg = (m: any): MatchMsg => ({ id: m.message_id, at: Date.parse(m.date_iso), from: addr(m.from_address), to: ([] as unknown[]).concat(m.to_addresses ?? []).map(addr), cc: ([] as unknown[]).concat(m.cc_addresses ?? []).map(addr), subject: String(m.subject ?? ""), body: String(m.body ?? ""), ours: !!m.is_from_spartan || /@spartancrew\.co\.uk$/i.test(addr(m.from_address)), attachments: m.attachment_names ?? undefined });
const readingOf = new Map(readings.map((r) => [r.message_id, r.extraction]));
function readingFor(id: string): Reading | null {
  const x = readingOf.get(id);
  if (!x) return null;
  const asks = (x.requests ?? []).map((q: any) => {
    const start = val(q.start), dur = Number(val(q.duration_minutes)) || 0;
    let end = val(q.end);
    if (!end && start && dur) { const t = Number(String(start).slice(0, 2)) * 60 + Number(String(start).slice(3, 5)) + dur; end = `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; }
    return { action: q.action, date: val(q.date), target_date: val(q.target?.date), start, end, crew: typeof val(q.crew) === "number" ? val(q.crew) : undefined, venue: val(q.venue) };
  });
  return { source: "model", intent: x.intent ?? null, asks, po: x.po ?? null };
}
const linksOf = new Map<string, any[]>();
for (const l of links) push(linksOf, l.thread_id, l);

// Precedents: the gold label of every earlier email that has one.
const LABELLED = (r: any) => (r.truth.kind === "existing" || r.truth.kind === "new-job" || r.truth.kind === "several") && r.truth.confidence !== "weak";
const precedents: Precedent[] = rows.filter(LABELLED).map((r) => {
  const o = ix.byId.get(r.truth.orders[0]);
  return { at: Date.parse(r.at), from: r.from, thread_id: r.thread_id, company_id: o ? Number(o.company_id) : null, order_ids: r.truth.orders };
});

// ---- run ------------------------------------------------------------------------------------
const out: string[] = [];
let recallN = 0, recallHit = 0, impossible = 0;
const sizes: number[] = [];
const avail: Record<string, { rows: number; present: number }> = Object.fromEntries(FAMILIES.map((f) => [f, { rows: 0, present: 0 }]));
const missed: string[] = [];
for (const r of rows) {
  const m = msgById.get(r.message_id);
  if (!m) continue;
  const at = Date.parse(m.date_iso);
  const thread = (byThread.get(m.thread_id) ?? []).filter((x) => Date.parse(x.date_iso) <= at).map(asMsg);
  const live = (linksOf.get(m.thread_id) ?? []).filter((l) => (l.state === "linked" || l.state === "relinked") && Date.parse(l.first_seen) <= at).sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen))[0];
  const res = match({ email: asMsg(m), thread_id: m.thread_id, thread, reading: readingFor(m.message_id), link: live ? { order_id: Number(live.order_id), source: String(live.source) } : null, precedents: precedents.filter((p) => p.at < at) }, ix, asAtFor(at));
  sizes.push(res.candidates.length);
  for (const c of res.candidates) for (const f of FAMILIES) { avail[f].rows++; if (c.cmp[f] !== null) avail[f].present++; }
  // Recall over labels whose order existed before the email (a new job's order cannot be offered).
  if (LABELLED(r)) {
    const existed = r.truth.candidates.filter((c: any) => r.truth.orders.includes(c.id) && !c.new).map((c: any) => c.id);
    const made = r.truth.candidates.filter((c: any) => r.truth.orders.includes(c.id) && c.new).map((c: any) => c.id);
    if (made.some((id: number) => res.candidates.some((c) => c.order_id === id))) impossible++;
    if (existed.length) {
      recallN++;
      if (existed.some((id: number) => res.candidates.some((c) => c.order_id === id))) recallHit++;
      else missed.push(`${r.at.slice(0, 16)} ${r.from} | ${r.subject.slice(0, 50)} | truth ${r.truth.candidates[0]?.r} [${r.truth.candidates[0]?.sig.join("; ")}] | companies ${res.companies.map((c) => c.id).join(",") || "-"} | days ${res.days.slice(0, 4).join(",") || "-"}`);
    }
  }
  out.push(JSON.stringify({ message_id: r.message_id, thread_id: r.thread_id, at: r.at, from: r.from, label: r.truth, intent: r.intent, days: res.days, reading: res.context.reading, context: res.context, companies: res.companies, candidates: res.candidates }));
}
writeFileSync(`${DIR}/features.jsonl`, out.join("\n") + "\n");

sizes.sort((a, b) => a - b);
const q = (p: number) => sizes[Math.floor(p * (sizes.length - 1))];
const availability = Object.fromEntries(FAMILIES.map((f) => [f, Number((avail[f].present / Math.max(1, avail[f].rows)).toFixed(3))]));
console.log(`emails ${rows.length}; candidate recall ${recallHit}/${recallN} (${(100 * recallHit / recallN).toFixed(2)}%); a new job's later order offered: ${impossible}`);
console.log(`candidates per email: median ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)}, max ${q(1)}`);
console.log("availability per family (share of candidate rows with a level):", JSON.stringify(availability));
console.log(`missed (${missed.length}):\n  ${missed.slice(0, 40).join("\n  ")}`);
if (process.argv.includes("--measure")) {
  recordMeasurement("matcher_candidates", {
    dataset: `gold set v1: ${rows.length} client emails ${meta.from.slice(0, 10)} to ${meta.taken_at.slice(0, 10)}, labels from staff actions (scripts/gold/truth.mts), OnSinch as at each email`,
    instrument: "scripts/gold/features.mts",
    denominator: "labelled emails whose order existed before the email (strong, medium or inherited)",
    recall: recallHit, of: recallN, new_job_order_offered: impossible,
    candidates_median: q(0.5), candidates_p90: q(0.9), candidates_max: q(1), availability,
  });
}
