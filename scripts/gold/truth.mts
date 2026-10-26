// ============================================================================
// The job matcher's labels, from what STAFF did in OnSinch after each client email. $0, no model.
// ----------------------------------------------------------------------------
// Reads the gold snapshot (scripts/gold/snapshot.mts). A staff booking action on order O at time
// T is given to the latest client email before T that could be about O (O's company by address
// or domain, O's contact person, or O's R/J/PO in its thread) and that names a day O holds:
// within 96 hours with a day matched, within 36 hours when the email names no day. The
// timeline never logs a cancel or a delete, so an order's and its shifts' own modifier stamps
// stand in. Three signals need no staff action: O's R or J written in the thread (by us after
// the email, or by anyone), O's PO or reference in the thread, and the sender being O's contact
// on a day the email names. A later email with nothing of its own inherits its thread's order.
//
// The days an email names: the model's reading where one was made (since 9 Oct), else the
// matcher's own reader (match/facts.ts) over the subject and the newest words. They only
// decide which order a staff action belongs to, never the label alone.
//
//   npx tsx scripts/gold/truth.mts [--dir .tmp-data/gold] [--out .tmp-data/gold/truth.jsonl]
// ============================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { companiesOf } from "../../app/lib/v2/threadState";
import { factsOf } from "../../app/lib/match/facts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir", ".tmp-data/gold");
const OUT = arg("--out", `${DIR}/truth.jsonl`);
const load = (n: string) => JSON.parse(readFileSync(`${DIR}/${n}.json`, "utf8"));
const BOT = 2257;
const H = 3600e3;
const WINDOW = 36 * H;
// A change or a new order staff make later than 36h still counts when it holds a day the email
// names: Creative Technology's Cytiva order was built 45h after the email (audit 22 Oct).
const LONG = 96 * H;

const meta = load("meta");
const FROM = Date.parse(meta.from);
const messages: any[] = load("messages");
const readings: any[] = load("readings");
const decisions: any[] = load("decisions");
const links: any[] = load("links");
const companies: any[] = load("companies");
const orders: any[] = load("orders");
const timeline: any[] = load("timeline");

const NOT_CLIENT = /spartancrew\.co\.uk|no-?reply|mailer-daemon|postmaster|onsinch|sinch\.cz/i;
const addr = (f: unknown) => String(f ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
const domain = (a: string) => a.split("@")[1] ?? "";
const FREE = new Set(["gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "btinternet.com", "msn.com", "protonmail.com", "mail.com"]);
const ldn = (iso: string | number) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const val = (g: any) => (g && typeof g === "object" && "value" in g ? g.value : g) ?? undefined;
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); };

// --- OnSinch indexes -------------------------------------------------------------------------
const userEmail = new Map<number, string>();
const companiesByEmail = new Map<string, Set<number>>();
const companiesByDomain = new Map<string, Set<number>>();
const coName = new Map<number, string>();
for (const c of companies) {
  coName.set(Number(c.id), String(c.name ?? "").trim());
  const add = (m: Map<string, Set<number>>, k: string) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(Number(c.id)); };
  for (const cl of c.Client ?? []) {
    const e = String(cl.email ?? "").toLowerCase().trim();
    userEmail.set(Number(cl.id), e);
    add(companiesByEmail, e);
    if (!/spartancrew\.co\.uk$/.test(e) && !FREE.has(domain(e))) add(companiesByDomain, domain(e));
  }
  const inv = String(c.email_invoice ?? "").toLowerCase().trim();
  if (inv) add(companiesByEmail, inv);
}

type O = { id: number; number: string; company_id: number; user_id: number; contact: string; created: number; creator: number; status: number; name: string; po: string; days: Set<string>; all: Set<string>; jobs: string[]; stamps: { at: number; by: number }[] };
const byId = new Map<number, O>();
const byNumber = new Map<string, O>();
const byJob = new Map<string, O>();
const byContact = new Map<string, O[]>();
const owner = new Map<string, number>();
for (const o of orders) {
  const rec: O = { id: Number(o.id), number: String(o.number), company_id: Number(o.company_id), user_id: Number(o.user_id), contact: userEmail.get(Number(o.user_id)) ?? "", created: Date.parse(o.created), creator: Number(o.creator), status: Number(o.status), name: String(o.name ?? ""), po: String(o.intern_name ?? "").trim(), days: new Set(), all: new Set(), jobs: [], stamps: [] };
  const stamp = (x: any) => { if (x?.modifier && Number(x.modifier) !== BOT) rec.stamps.push({ at: Date.parse(x.modified), by: Number(x.modifier) }); };
  stamp(o);
  for (const j of [].concat(o.Job ?? []) as any[]) {
    rec.jobs.push(String(j.id));
    owner.set(`Job:${j.id}`, rec.id);
    byJob.set(String(j.id), rec);
    for (const t of [].concat(j.SlotTeam ?? []) as any[]) {
      owner.set(`SlotTeam:${t.id}`, rec.id);
      stamp(t);
      for (const s of [].concat(t.Slot ?? []) as any[]) {
        owner.set(`Slot:${s.id}`, rec.id);
        if (s.beginning) rec.all.add(ldn(s.beginning));
        if (s.cancelled !== true && s.beginning) rec.days.add(ldn(s.beginning));
      }
    }
  }
  byId.set(rec.id, rec);
  byNumber.set(rec.number, rec);
  if (rec.contact) push(byContact, rec.contact, rec);
}

// --- staff booking actions -------------------------------------------------------------------
const BOOKING_FIELDS = /^Slot\.(size|beginning|end|profession_id|cancelled|role)$|^Order\.intern_name$/;
type Act = { at: number; by: number; what: string; order: number };
const acts: Act[] = [];
for (const a of timeline) {
  if (Number(a.creator) === BOT) continue;
  let d: any; try { d = JSON.parse(a.data); } catch { continue; }
  let what = "", oid = 0;
  // An Order's own rows name it by its NUMBER (order_cancel, order_confirm_provisional, a change
  // to Order.intern_name), an order_create by its id: numbers and ids overlap, so never mixed.
  // A copy names the new order by its number too (45 of 48 copies match a number and no id, 10-26).
  if (a.action === "order_create") { what = "create order"; oid = Number(d.id); }
  else if (a.action === "order_create_by_copy") { what = "create order"; oid = byNumber.get(String(d.id))?.id ?? 0; }
  else if (a.action === "order_cancel") { what = "cancel order"; oid = byNumber.get(String(d.id))?.id ?? 0; }
  else if (a.action === "order_confirm_provisional") { what = "confirm order"; oid = byNumber.get(String(d.id))?.id ?? 0; }
  else if (a.action === "common_create" && /^(Job|SlotTeam|Slot)$/.test(d.model)) { what = `add ${d.model}`; oid = Number(/^Order:(\d+)/.exec(String(d.data?.path ?? ""))?.[1] ?? 0) || owner.get(`${d.model}:${d.id}`) || 0; }
  else if (a.action === "common_change") {
    const f = Object.entries(d.diffChanges ?? {}).flatMap(([m, x]) => Object.keys(x as object).map((k) => `${m}.${k}`)).filter((k) => BOOKING_FIELDS.test(k));
    if (!f.length) continue;
    what = `edit ${[...new Set(f)].sort().join("+")}`;
    oid = d.model === "Order" ? byNumber.get(String(d.id))?.id ?? 0 : owner.get(`${d.model}:${d.id}`) ?? 0;
  } else continue;
  if (!oid || !byId.has(oid)) continue;
  acts.push({ at: Date.parse(a.created), by: Number(a.creator), what, order: oid });
}
for (const o of byId.values()) for (const s of o.stamps) if (s.at >= FROM) acts.push({ at: s.at, by: s.by, what: "stamp", order: o.id });
acts.sort((x, y) => x.at - y.at);

// --- client emails ---------------------------------------------------------------------------
const R_RE = /\b(?:R|order\s*(?:no\.?|number|#)?\s*)[\s#:-]?(1\d{4})\b/gi;
const J_RE = /\bJ[\s#:-]?(1\d{4,5})\b/g;
const PO_RE = /\b(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,}\b/gi;
const reading = new Map(readings.map((r) => [r.message_id, r.extraction]));
const decision = new Map(decisions.map((d) => [d.message_id, d]));
const threads = new Map<string, any[]>();
for (const m of messages) push(threads, m.thread_id, m);
for (const t of threads.values()) t.sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));

type E = { id: string; thread: string; at: number; from: string; subject: string; intent: string; days: string[]; daysFrom: "reading" | "words" | "none"; companies: Set<number>; readTogether?: string };
const emails: E[] = [];
for (const m of messages) {
  const from = addr(m.from_address);
  const at = Date.parse(m.date_iso);
  if (m.is_from_spartan || NOT_CLIENT.test(from) || !(at >= FROM)) continue;
  const x = reading.get(m.message_id);
  const dec = decision.get(m.message_id);
  const together = /read together with the later email (\S+)/.exec(String(dec?.decision?.reason ?? ""))?.[1];
  const days = new Set<string>();
  for (const q of x?.requests ?? []) for (const d of [val(q.date), val(q.target?.date)]) if (isDay(d)) days.add(d);
  let daysFrom: E["daysFrom"] = days.size ? "reading" : "none";
  if (!x && !together) {
    for (const d of factsOf(m.subject, m.body, m.date_iso).days) days.add(d);
    if (days.size) daysFrom = "words";
  }
  const side = (threads.get(m.thread_id) ?? []).filter((y: any) => !y.is_from_spartan && Date.parse(y.date_iso) <= at).flatMap((y: any) => [addr(y.from_address), ...[].concat(y.to_addresses ?? []).map((t: any) => addr(t))]);
  const cs = new Set<number>([...(companiesByEmail.get(from) ?? []), ...(FREE.has(domain(from)) ? [] : companiesByDomain.get(domain(from)) ?? []), ...companiesOf(side, companies)]);
  emails.push({ id: m.message_id, thread: m.thread_id, at, from, subject: String(m.subject ?? ""), intent: String(x?.intent ?? (together ? "read-together" : dec ? dec.kind : "unread")), days: [...days], daysFrom, companies: cs, readTogether: together });
}
emails.sort((a, b) => a.at - b.at);
const byCompany = new Map<number, E[]>(), byFrom = new Map<string, E[]>(), byThread = new Map<string, E[]>();
for (const e of emails) { for (const c of e.companies) push(byCompany, c, e); push(byFrom, e.from, e); push(byThread, e.thread, e); }

// --- signals per (email, order) -----------------------------------------------------------------
const sigs = new Map<string, Map<number, Set<string>>>();
const add = (e: E, o: number, s: string) => { if (!sigs.has(e.id)) sigs.set(e.id, new Map()); const m = sigs.get(e.id)!; if (!m.has(o)) m.set(o, new Set()); m.get(o)!.add(s); };
const holds = (e: E, o: O) => !e.days.length || e.days.some((d) => o.all.has(d));
// With no day to go by, only a job still running or ahead: an old order's reference is history.
const current = (e: E, o: O) => e.days.length ? holds(e, o) : [...o.all].some((d) => d >= ldn(e.at - 7 * 864e5));

const threadRefs = new Map<string, { ours: Map<number, number>; any: Set<number>; po: Set<number> }>();
const poIndex = new Map<string, O[]>();
for (const o of byId.values()) {
  if (o.po.length >= 5) push(poIndex, o.po.toUpperCase(), o);
  for (const p of o.name.toUpperCase().split(/[^A-Z0-9-]+/)) if (p.length >= 5 && /\d{3}/.test(p)) push(poIndex, p, o);
}
for (const [tid, ms] of threads) {
  const ours = new Map<number, number>(); const any = new Set<number>(); const po = new Set<number>();
  for (const m of ms) {
    const text = `${m.subject ?? ""}\n${m.body ?? ""}`;
    const found = [...[...text.matchAll(R_RE)].map((x) => byNumber.get(x[1])), ...[...text.matchAll(J_RE)].map((x) => byJob.get(x[1]))].filter(Boolean) as O[];
    for (const o of found) { any.add(o.id); if (m.is_from_spartan && !ours.has(o.id)) ours.set(o.id, Date.parse(m.date_iso)); }
    for (const x of text.matchAll(PO_RE)) for (const o of poIndex.get(x[0].toUpperCase()) ?? []) po.add(o.id);
  }
  threadRefs.set(tid, { ours, any, po });
}

for (const e of emails) {
  const refs = threadRefs.get(e.thread)!;
  for (const id of refs.any) { const o = byId.get(id)!; if (current(e, o)) add(e, id, "number in thread"); }
  for (const [id, at] of refs.ours) if (at > e.at) add(e, id, "we wrote its number after");
  for (const id of refs.po) { const o = byId.get(id)!; if (current(e, o) && (e.companies.has(o.company_id) || !e.companies.size)) add(e, id, "PO/ref in thread"); }
  if (e.days.length) for (const o of byContact.get(e.from) ?? []) if (o.status !== -1 && o.created <= e.at && e.days.some((d) => o.days.has(d))) add(e, o.id, "sender is its contact, on a day asked");
}

const couldBe = (e: E, o: O) => e.companies.has(o.company_id) || o.contact === e.from || threadRefs.get(e.thread)!.any.has(o.id) || threadRefs.get(e.thread)!.po.has(o.id);
let unattributed = 0;
for (const a of acts) {
  const o = byId.get(a.order)!;
  const pool = new Set<E>([...(byCompany.get(o.company_id) ?? []), ...(o.contact ? byFrom.get(o.contact) ?? [] : [])]);
  const cands = [...pool].filter((e) => e.at <= a.at && a.at - e.at <= LONG && !e.readTogether && couldBe(e, o)).sort((x, y) => x.at - y.at);
  const withDay = cands.filter((e) => e.days.length && e.days.some((d) => o.all.has(d)));
  const noDays = cands.filter((e) => !e.days.length && a.at - e.at <= WINDOW && current(e, o));
  const e = withDay.length ? withDay[withDay.length - 1] : noDays.length ? noDays[noDays.length - 1] : null;
  if (!e) { unattributed++; continue; }
  add(e, o.id, `staff ${a.what.startsWith("create") ? "created it" : a.what === "stamp" ? "last changed it" : "acted on it"} ${withDay.length ? "(day match)" : "(no days read)"}`);
}

// --- labels -----------------------------------------------------------------------------------
const STRONG = /^(staff created it \(day match\)|staff acted on it \(day match\)|staff last changed it \(day match\)|we wrote its number after|number in thread|PO\/ref in thread)$/;
const linkNow = new Map<string, any[]>();
for (const l of links) push(linkNow, l.thread_id, l);
const rows: any[] = [];
for (const e of emails.filter((x) => !x.readTogether)) {
  const m = sigs.get(e.id) ?? new Map<number, Set<string>>();
  const cands = [...m.entries()].map(([id, s]) => { const o = byId.get(id)!; const sig = [...s]; return { id, r: `R${o.number}`, company: coName.get(o.company_id), new: o.created > e.at, by_bot: o.creator === BOT, cancelled: o.status === -1, sig, strong: sig.filter((x) => STRONG.test(x)).length, n: sig.length }; })
    .sort((a, b) => b.strong - a.strong || b.n - a.n);
  const top = cands.length ? cands.filter((c) => c.strong === cands[0].strong && c.n === cands[0].n) : [];
  const kind = !cands.length ? "no-order-signal" : top.length > 1 ? "several" : top[0].new ? "new-job" : "existing";
  const confidence = !cands.length ? null : top[0].strong >= 2 || top[0].sig.some((s) => /we wrote its number after|number in thread/.test(s)) ? "strong" : top[0].strong === 1 ? "medium" : "weak";
  const d = decision.get(e.id);
  rows.push({
    message_id: e.id, thread_id: e.thread, at: new Date(e.at).toISOString(), from: e.from, subject: e.subject.slice(0, 120), intent: e.intent, days: e.days, days_from: e.daysFrom,
    companies: [...e.companies].map((c) => coName.get(c)), company_ids: [...e.companies],
    truth: { kind, confidence, orders: top.map((c) => c.id), candidates: cands.slice(0, 5) },
    prod: d ? { kind: d.kind, found: d.decision?.found ?? null, order_id: d.decision?.order_id ?? null, wrote: [...new Set([...((d.executed ?? []).map?.((x: any) => Number(x?.detail?.order_id)) ?? []), ...(d.decision?.ops ?? []).map((x: any) => Number(x?.op?.order_id))].filter((x) => x > 0))], reason: String(d.decision?.reason ?? d.decision?.reasons?.join("; ") ?? d.decision?.why?.join("; ") ?? "").slice(0, 160), company: d.company } : null,
    link_now: (linkNow.get(e.thread) ?? []).filter((l) => l.state === "linked" || l.state === "relinked").map((l) => Number(l.order_id)),
  });
}
// Adjudications (data/gold/adjudications.jsonl) replace the label they were judged against, before
// inheritance, so a corrected email also corrects the later ones that inherit from it. A judgement
// read case by case outranks every signal counted above; "unsure" marks an email no one could
// settle from its own words, and fitting and scoring leave it out.
const ADJ = "data/gold/adjudications.jsonl";
let adjudicated = 0;
if (existsSync(ADJ)) {
  const adj = new Map(readFileSync(ADJ, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => { const a = JSON.parse(l); return [a.message_id, a]; }));
  for (const r of rows) {
    const a = adj.get(r.message_id);
    if (!a) continue;
    adjudicated++;
    const os = ((a.orders ?? []) as string[]).map((n) => byNumber.get(String(n).replace(/^R/, ""))).filter((o): o is O => !!o);
    const kind = a.answer === "link" ? (os.length > 1 ? "several" : "existing") : a.answer === "new" ? "new-job" : a.answer === "none" ? "not-a-job" : "unsure";
    const cands = os.length ? os.map((o) => ({ id: o.id, r: `R${o.number}`, new: o.created > Date.parse(r.at), sig: ["adjudicated"], strong: 0, n: 1 }))
      : a.answer === "new" ? r.truth.candidates.filter((c: any) => c.new) : [];
    r.truth = { kind, confidence: "adjudicated", orders: cands.map((c: any) => c.id), candidates: cands, knowable: a.knowable, why: a.why };
  }
}
const firstBy = new Map<string, any>();
for (const r of rows) {
  const prev = firstBy.get(r.thread_id);
  if (r.truth.kind === "no-order-signal" && prev) {
    const o = byId.get(prev.truth.orders[0])!;
    if (!r.days.length || r.days.some((d: string) => o.all.has(d))) r.truth = { kind: o.created > Date.parse(r.at) ? "new-job" : "existing", confidence: "inherited", orders: [o.id], candidates: [{ id: o.id, r: `R${o.number}`, new: o.created > Date.parse(r.at), sig: [`thread's earlier email`], strong: 0, n: 1 }] };
  }
  if ((r.truth.kind === "existing" || r.truth.kind === "new-job") && r.truth.confidence !== "weak" && r.truth.orders.length === 1) firstBy.set(r.thread_id, r);
}
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const count = (f: (r: any) => string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = f(r); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
console.log(`snapshot ${meta.taken_at}; window from ${meta.from}`);
console.log(`client emails: ${rows.length}; staff booking actions: ${acts.length}, attributed ${acts.length - unattributed}, unattributed ${unattributed}; adjudicated ${adjudicated}`);
console.log("label x confidence:", JSON.stringify(count((r) => `${r.truth.kind}/${r.truth.confidence}`)));
console.log("days from:", JSON.stringify(count((r) => r.days_from)));
console.log("by month:", JSON.stringify(count((r) => `${r.at.slice(0, 7)} ${r.truth.kind === "no-order-signal" ? "none" : "label"}`).sort()));
console.log(`wrote ${OUT}`);
if (process.argv.includes("--measure")) {
  const by = Object.fromEntries(count((r) => `${r.truth.kind}/${r.truth.confidence}`));
  const firm = rows.filter((r) => ["existing", "new-job", "several"].includes(r.truth.kind) && ["strong", "medium", "inherited"].includes(r.truth.confidence)).length;
  const { recordMeasurement } = await import("../_gateMeasure.mjs");
  recordMeasurement("matcher_gold_set", {
    dataset: `production read-only snapshot ${meta.taken_at}: every stored client email from ${meta.from.slice(0, 10)}, OnSinch timeline over the same window`,
    instrument: "scripts/gold/truth.mts",
    denominator: "client emails (not ours, not system mail) since the window start",
    emails: rows.length, labelled_strong_medium_or_inherited: firm, staff_actions: acts.length, staff_actions_attributed: acts.length - unattributed, by_label: by,
  });
}
