// ============================================================================
// THE JOB MATCHER'S EVIDENCE: for one client email, every OnSinch order it could be about, each
// with one level per family of evidence. Pure: data in, data out; no read, no model, no weight.
// ----------------------------------------------------------------------------
// The plan (doc "Spartan Job Matcher Plan", 22 Oct): code gathers wide and compares every fact,
// a weight table scores the levels (fitted from the gold set, never written by hand here), and
// Astra decides with all of it in front of it. So this file decides nothing. It must not miss
// the true order (measured: candidate recall on the gold set), and a level is null when the
// facts to compare do not exist: absent evidence is not evidence against.
//
// Gathering, from the email's moment only (an order made after it is never offered: L1):
//   companies   the sender's exact address, invoice email, domain, domain label, company name;
//               the thread's other client-side addresses; companies whose orders name the sender
//               as contact; the linked order's company; companies of orders the thread names
//   orders      every order of those companies with a shift on an asked day or in the window
//               from 7 days before the email to 120 after; any order whose R, J, PO or code the
//               thread carries; orders whose contact is on the thread; the linked order; the
//               orders the sender's earlier emails were about (precedents)
// ============================================================================
import { utcToLondon } from "../v2/bot/ops";
import { CONSUMER_DOMAINS, domainOfEmail } from "../engine/resolve";
import { factsOf, refsIn, codeKey, type Facts } from "./facts";
import { similarity, gramContainment, type Corpus } from "./ngram";

export type MatchMsg = { id: string; at: number; from: string; to: string[]; cc?: string[]; subject: string; body: string; ours: boolean; attachments?: string[] };
/** One thing the reader says the client asked for; every field optional. */
export type Ask = { action?: string; date?: string; target_date?: string; start?: string; end?: string; crew?: number; venue?: string };
/** The reader's values (a model's, or the code's own from the words) for the email being matched. */
export type Reading = { source: "model" | "words"; intent?: string | null; asks: Ask[]; po?: string | null };
/** An earlier email whose orders are known (a decided link, or a gold label in replay). */
export type Precedent = { at: number; from: string; thread_id: string; company_id: number | null; order_ids: number[] };
export type MatchInput = {
  email: MatchMsg;
  thread_id: string;
  /** The thread up to and including the email, oldest first, ours included. */
  thread: MatchMsg[];
  reading: Reading | null;
  link: { order_id: number; source: string } | null;
  precedents: Precedent[];
};

export type Place = { id: number; name: string; alias?: string; address?: string; zip?: string };
export type MatchIndex = {
  companies: any[];
  orders: any[];
  places: Map<number, Place>;
  corpus: Corpus;
  byId: Map<number, any>;
  byNumber: Map<string, any>;
  byJob: Map<string, any>;
  byCode: Map<string, any[]>;
  byCompany: Map<number, any[]>;
  byContact: Map<string, any[]>;
  contactOf: Map<number, string>;
  /** Exact Client email -> companies, invoice email -> companies, non-consumer domain -> companies. */
  byEmail: Map<string, Set<number>>;
  byInvoice: Map<string, Set<number>>;
  byDomain: Map<string, Set<number>>;
};

export const FAMILIES = ["reference", "person", "precedent", "company", "time", "coverage", "size", "place", "subject", "thread", "state", "age"] as const;
export type Family = (typeof FAMILIES)[number];
export type Candidate = { order_id: number; r: string; j: string | null; company_id: number; via: string[]; cmp: Record<Family, string | null> };
export type Match = {
  facts: Facts;
  days: string[];
  companies: Array<{ id: number; route: string }>;
  candidates: Candidate[];
  context: { candidates: number; density: number; intent: string | null; asks_new: boolean; reading: "model" | "words" | "none" };
};

const TEST_COMPANY = 515;
const WINDOW_BEFORE = 7 * 864e5, WINDOW_AFTER = 120 * 864e5;
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); };
const addTo = (m: Map<string, Set<number>>, k: string, v: number) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(v); };
const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
const ours = (a: string) => /@spartancrew\.co\.uk$/i.test(a);
const freeMail = (d: string) => !d.includes(".") || CONSUMER_DOMAINS.has(d);
const flat = (s: unknown) => lc(s).replace(/[^a-z0-9]/g, "");
const label = (d: string) => d.split(".")[0];

/** Indexes over OnSinch's companies, orders (nested) and places, built once per run. */
export function indexWorld(companies: any[], orders: any[], places: Array<{ id: number; name: string; alias?: string; address?: string; zip?: string }>, corpus: Corpus): MatchIndex {
  const ix: MatchIndex = {
    companies, orders, corpus, places: new Map(places.map((p) => [Number(p.id), { ...p, id: Number(p.id) }])),
    byId: new Map(), byNumber: new Map(), byJob: new Map(), byCode: new Map(), byCompany: new Map(), byContact: new Map(), contactOf: new Map(),
    byEmail: new Map(), byInvoice: new Map(), byDomain: new Map(),
  };
  const userEmail = new Map<number, string>();
  for (const c of companies) {
    const id = Number(c.id);
    for (const cl of c.Client ?? []) {
      const e = lc(cl.email);
      userEmail.set(Number(cl.id), e);
      if (ours(e)) continue;
      addTo(ix.byEmail, e, id);
      const d = domainOfEmail(e);
      if (!freeMail(d)) addTo(ix.byDomain, d, id);
    }
    addTo(ix.byInvoice, lc(c.email_invoice), id);
  }
  for (const o of orders) {
    const id = Number(o.id);
    ix.byId.set(id, o);
    ix.byNumber.set(String(o.number), o);
    for (const j of ([] as any[]).concat(o.Job ?? [])) ix.byJob.set(String(j.id), o);
    push(ix.byCompany, Number(o.company_id), o);
    const contact = userEmail.get(Number(o.user_id)) ?? "";
    ix.contactOf.set(id, contact);
    if (contact) push(ix.byContact, contact, o);
    for (const k of codesOf(o)) push(ix.byCode, k, o);
  }
  // A code identifies a job only while it is rare: "2026" sits in 83 order names (SNWF2026 and
  // the like) and every thread's quoted dates carry it, so it offered every order (22 Oct).
  for (const [k, os] of ix.byCode) if (os.length > MAX_CODE_ORDERS || /^(19|20)\d\d$/.test(k)) ix.byCode.delete(k);
  return ix;
}

const MAX_CODE_ORDERS = 3;
/** An order's PO and the code-like tokens of its name, as codeKey writes them. */
function codesOf(o: any): string[] {
  const out = new Set<string>();
  const po = codeKey(o.intern_name);
  if (po.length >= 4) out.add(po);
  for (const t of String(o.name ?? "").toUpperCase().split(/[^A-Z0-9-]+/)) if (t.length >= 4 && /\d{3}/.test(t)) out.add(codeKey(t));
  return [...out];
}

type Slot = { day: string; start: string; end: string; size: number; place: number; cancelled: boolean };
function slotsOf(o: any): Slot[] {
  const out: Slot[] = [];
  for (const j of ([] as any[]).concat(o?.Job ?? [])) for (const t of ([] as any[]).concat(j?.SlotTeam ?? [])) for (const s of ([] as any[]).concat(t?.Slot ?? [])) {
    if (!s?.beginning) continue;
    const b = utcToLondon(s.beginning), e = utcToLondon(s.end ?? s.beginning);
    out.push({ day: b.date, start: b.time, end: e.time, size: Number(s.size) || 0, place: Number(s.SlotLocation?.place_id) || 0, cancelled: s.cancelled === true || t?.cancelled === true });
  }
  return out;
}
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dayShift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const londonDay = (ms: number) => utcToLondon(new Date(ms).toISOString()).date;

/** The companies the email's people could be, each by the strongest route that reaches it. */
function companiesFor(input: MatchInput, ix: MatchIndex): Map<number, string> {
  const routes = new Map<number, string>();
  const put = (ids: Iterable<number> | undefined, route: string) => { for (const id of ids ?? []) if (!routes.has(id)) routes.set(id, route); };
  const byAddress = (a: string, prefix: string) => {
    const d = domainOfEmail(a);
    put(ix.byEmail.get(a), `${prefix}address`);
    put(ix.byInvoice.get(a), `${prefix}invoice email`);
    if (freeMail(d)) return;
    put(ix.byDomain.get(d), `${prefix}domain`);
    if (label(d).length >= 5) for (const [dd, ids] of ix.byDomain) if (label(dd) === label(d)) put(ids, `${prefix}domain label`);
    if (label(d).length >= 6) put(ix.companies.filter((c) => flat(c.name).startsWith(label(d))).map((c) => Number(c.id)), `${prefix}company name`);
  };
  const from = lc(input.email.from);
  byAddress(from, "");
  const side = new Set<string>();
  for (const m of input.thread) if (!m.ours) for (const a of [m.from, ...m.to, ...(m.cc ?? [])]) { const x = lc(a); if (x && !ours(x) && x !== from) side.add(x); }
  for (const a of side) byAddress(a, "participant ");
  put((ix.byContact.get(from) ?? []).map((o) => Number(o.company_id)), "sender is a contact");
  return routes;
}

export function match(input: MatchInput, ix: MatchIndex, asAt: (o: any) => any = (o) => o): Match {
  const at = input.email.at;
  const facts = factsOf(input.email.subject, input.email.body, new Date(at).toISOString());
  const reading = input.reading;
  const asks = reading?.asks ?? [];
  const modelDays = [...new Set(asks.flatMap((a) => [a.date, a.target_date]).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const days = reading?.source === "model" ? modelDays : [...new Set([...modelDays, ...facts.days])].sort();
  const from = lc(input.email.from);

  // Everything the thread wrote, ours included, and ours alone.
  const before = input.thread.filter((m) => m.at <= at);
  const threadRefs = refsIn(before.map((m) => `${m.subject}\n${m.body}`).join("\n"));
  const ourRefs = refsIn(before.filter((m) => m.ours).map((m) => `${m.subject}\n${m.body}`).join("\n"));
  const side = new Set<string>();
  for (const m of before) if (!m.ours) for (const a of [m.from, ...m.to, ...(m.cc ?? [])]) { const x = lc(a); if (x && !ours(x)) side.add(x); }

  // ---- gather -------------------------------------------------------------------------------
  const routes = companiesFor(input, ix);
  const via = new Map<number, Set<string>>();
  const offer = (o: any, why: string) => {
    if (!o) return;
    const id = Number(o.id);
    if (Date.parse(o.created) > at) return; // L1: made after the email, so it cannot be what the email is about
    if (Number(o.company_id) === TEST_COMPANY && !routes.has(TEST_COMPANY)) return; // L1: the test company only for its own senders
    if (!via.has(id)) via.set(id, new Set());
    via.get(id)!.add(why);
  };
  const asked = new Set(days);
  const lo = londonDay(at - WINDOW_BEFORE), hi = londonDay(at + WINDOW_AFTER);
  const inWindow = (o: any) => slotsOf(o).some((s) => asked.has(s.day) || (s.day >= lo && s.day <= hi));
  for (const cid of routes.keys()) for (const o of ix.byCompany.get(cid) ?? []) if (inWindow(o)) offer(o, `client: ${routes.get(cid)}`);
  for (const n of threadRefs.r) offer(ix.byNumber.get(n), "R in thread");
  for (const n of threadRefs.j) offer(ix.byJob.get(n), "J in thread");
  for (const c of threadRefs.codes) for (const o of ix.byCode.get(codeKey(c)) ?? []) offer(o, "code in thread");
  if (reading?.po) for (const o of ix.byCode.get(codeKey(reading.po)) ?? []) offer(o, "PO read");
  for (const a of side) for (const o of ix.byContact.get(a) ?? []) if (inWindow(o)) offer(o, "contact on thread");
  if (input.link) offer(ix.byId.get(input.link.order_id), "thread link");
  for (const p of input.precedents) if (p.from === from || p.thread_id === input.thread_id) for (const id of p.order_ids) offer(ix.byId.get(id), "precedent");

  // ---- compare ------------------------------------------------------------------------------
  const startsAsked = new Map<string, Set<string>>(); // day -> starts
  const crewAsked = new Map<string, number[]>(); // day -> counts
  for (const a of asks) {
    const d = a.date ?? a.target_date;
    if (!d) continue;
    if (a.start) { if (!startsAsked.has(d)) startsAsked.set(d, new Set()); startsAsked.get(d)!.add(a.start); }
    if (a.crew) push(crewAsked, d, a.crew);
  }
  // The code's own reading gives times and counts with no day: they stand for every day named.
  if (reading?.source !== "model") for (const d of days) {
    for (const t of facts.times) { if (!startsAsked.has(d)) startsAsked.set(d, new Set()); startsAsked.get(d)!.add(t); }
    for (const n of facts.counts) push(crewAsked, d, n);
  }
  const ends = new Map<string, string>(); // "day|start" -> end
  for (const a of asks) if ((a.date ?? a.target_date) && a.start && a.end) ends.set(`${a.date ?? a.target_date}|${a.start}`, a.end);
  const venues = [...new Set(asks.map((a) => a.venue).filter((v): v is string => !!v && v.trim().length >= 3))];
  const newestRef = { r: new Set(facts.r), j: new Set(facts.j), codes: new Set(facts.codes.map(codeKey)) };
  const threadCodes = new Set(threadRefs.codes.map(codeKey));
  const anyRefs = threadRefs.r.length + threadRefs.j.length + threadRefs.codes.length > 0 || !!reading?.po;
  const senderPrec = input.precedents.filter((p) => p.from === from && p.at < at);
  const threadPrec = input.precedents.filter((p) => p.thread_id === input.thread_id && p.at < at);
  const companyList = [...routes].map(([id, route]) => ({ id, route }));

  const candidates: Candidate[] = [];
  for (const [id, why] of via) {
    const o = asAt(ix.byId.get(id));
    if (!o) continue;
    const slots = slotsOf(o);
    const live = slots.filter((s) => !s.cancelled);
    const number = String(o.number), jobs = ([] as any[]).concat(o.Job ?? []).map((j: any) => String(j.id));
    // Only codes that still identify a job (indexWorld drops the common ones).
    const po = ix.byCode.has(codeKey(o.intern_name)) ? codeKey(o.intern_name) : "";
    const nameCodes = codesOf(o).filter((c) => c !== po && ix.byCode.has(c));
    const contact = ix.contactOf.get(id) ?? "";

    // reference
    let reference: string | null = null;
    if (newestRef.r.has(number) || jobs.some((j) => newestRef.j.has(j))) reference = "R or J in the newest words";
    else if (facts.subjectR.includes(number) || jobs.some((j) => facts.subjectJ.includes(j))) reference = "R or J in the subject";
    else if (ourRefs.r.includes(number) || jobs.some((j) => ourRefs.j.includes(j))) reference = "R or J in our reply";
    else if (threadRefs.r.includes(number) || jobs.some((j) => threadRefs.j.includes(j))) reference = "R or J in the thread";
    else if (po.length >= 4 && (newestRef.codes.has(po) || codeKey(reading?.po) === po)) reference = "PO in the newest words";
    else if (po.length >= 4 && threadCodes.has(po)) reference = "PO in the thread";
    else if (nameCodes.some((c) => threadCodes.has(c))) reference = "reference in the order name";
    else if (facts.r.length || facts.j.length) reference = "names another order";
    else if (facts.subjectR.length || facts.subjectJ.length) reference = "subject names another order";
    else if (anyRefs) reference = "none";

    // person
    const cd = domainOfEmail(contact);
    const person = !contact ? null : contact === from ? "sender is the contact" : side.has(contact) ? "contact is on the thread"
      : !freeMail(cd) && cd === domainOfEmail(from) ? "contact is a colleague" : "none";

    // precedent (the sender's earlier emails)
    const precedent = !senderPrec.length ? null : senderPrec.some((p) => p.order_ids.includes(id)) ? "sender's earlier email was about it"
      : senderPrec.some((p) => p.company_id === Number(o.company_id)) ? "sender books this client" : "none";

    const company = routes.get(Number(o.company_id)) ?? "not reached by address";

    // time and coverage
    let time: string | null = null, coverage: string | null = null, size: string | null = null;
    if (days.length) {
      const onDay = live.filter((s) => asked.has(s.day));
      if (!onDay.length) time = live.some((s) => asked.has(dayShift(s.day, 1)) || asked.has(dayShift(s.day, -1))) ? "next or previous day" : "no asked day";
      else {
        // 0 no start asked for these days; 1 asked, none near; 2 within an hour; 3 same start; 4 same start and end.
        let rank = onDay.some((s) => startsAsked.has(s.day)) ? 1 : 0;
        for (const s of onDay) for (const st of startsAsked.get(s.day) ?? []) {
          const end = ends.get(`${s.day}|${st}`);
          rank = Math.max(rank, s.start === st && end && s.end === end ? 4 : s.start === st ? 3 : Math.abs(mins(s.start) - mins(st)) <= 60 ? 2 : 1);
        }
        time = ["day, no time asked", "day, other time", "day, start within an hour", "day and start", "day, start and end"][rank];
      }
      if (days.length >= 2) {
        const held = days.filter((d) => live.some((s) => s.day === d)).length;
        coverage = held === days.length ? "every asked day" : held ? "some asked days" : "no asked day";
      }
      if (crewAsked.size && onDay.length) {
        let lvl = 0;
        for (const [d, ns] of crewAsked) {
          const day = onDay.filter((s) => s.day === d);
          if (!day.length) continue;
          const byStart = new Map<string, number>();
          for (const s of day) byStart.set(s.start, (byStart.get(s.start) ?? 0) + s.size);
          const total = day.reduce((a, s) => a + s.size, 0);
          for (const n of ns) {
            const l = [...byStart.values()].includes(n) ? 4 : total === n ? 3 : Math.min(...[...byStart.values(), total].map((x) => Math.abs(x - n))) <= 2 ? 2 : 1;
            lvl = Math.max(lvl, l);
          }
        }
        size = lvl ? ["", "crew differs by more than 2", "crew within 2", "crew equal for the day", "crew equal on a shift"][lvl] : null;
      }
    }

    // place
    let place: string | null = null;
    const places = [...new Set(live.map((s) => s.place).filter(Boolean))].map((p) => ix.places.get(p)).filter((p): p is Place => !!p);
    if (venues.length || facts.postcodes.length) {
      if (facts.postcodes.length && places.some((p) => p.zip && facts.postcodes.includes(String(p.zip).toUpperCase().replace(/\s+/g, " ").trim()))) place = "same postcode";
      else if (venues.length) {
        const atName = String(o.name ?? "").split("@").slice(1).join("@");
        let best = 0;
        for (const v of venues) {
          for (const p of places) {
            best = Math.max(best, similarity(v, p.name, ix.corpus), p.alias ? similarity(v, p.alias, ix.corpus) : 0);
            if (p.name.trim().length >= 6) best = Math.max(best, gramContainment(p.name, v, ix.corpus) * 0.95);
          }
          if (atName.trim()) best = Math.max(best, similarity(v, atName, ix.corpus));
        }
        place = best >= 0.92 ? "venue name 0.92 and up" : best >= 0.75 ? "venue name 0.75 to 0.92" : best >= 0.5 ? "venue name 0.5 to 0.75" : "different venue";
      } else place = "different postcode";
    }

    // subject against the order's name
    const subj = facts.subject.replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, " ").trim();
    const ss = subj.length >= 4 ? similarity(subj, o.name, ix.corpus) : null;
    const subject = ss === null ? null : ss >= 0.6 ? "subject like the order name" : ss >= 0.4 ? "subject partly like it" : ss >= 0.2 ? "subject faintly like it" : "subject unlike it";

    // thread
    const thread = input.link?.order_id === id ? (input.link.source === "bot write" ? "linked by a bot write" : "linked")
      : threadPrec.some((p) => p.order_ids.includes(id)) ? "an earlier email here was about it"
      : input.link || threadPrec.length ? "thread is about another order" : null;

    const status = Number(o.status);
    const state = status === -1 ? "cancelled" : status === -2 ? "closed" : o.quote || o.provisional ? "quote or provisional" : "live";
    const ageH = (at - Date.parse(o.created)) / 3600e3;
    const age = ageH <= 48 ? "made in the 48 hours before" : ageH <= 14 * 24 ? "made in the 14 days before" : "older";

    candidates.push({ order_id: id, r: `R${number}`, j: jobs[0] ? `J${jobs[0]}` : null, company_id: Number(o.company_id), via: [...why], cmp: { reference, person, precedent, company, time, coverage, size, place, subject, thread, state, age } });
  }

  const density = new Set(candidates.filter((c) => c.cmp.time && !/no asked day|next or previous/.test(c.cmp.time)).map((c) => c.order_id)).size;
  const asksNew = asks.some((a) => a.action === "new_shift") || /booking|quote/.test(String(reading?.intent ?? ""));
  return { facts, days, companies: companyList, candidates, context: { candidates: candidates.length, density, intent: reading?.intent ?? null, asks_new: asksNew, reading: reading ? reading.source : "none" } };
}
