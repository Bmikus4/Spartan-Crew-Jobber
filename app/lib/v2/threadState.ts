// ============================================================================
// ONE STATE PER THREAD, derived every minute from everything known about it, never stored as
// a verdict that a later email or a staff edit can leave behind.
// ----------------------------------------------------------------------------
// The TV's cards were decided once, per email, and frozen. Measured 10-16 in the simulator
// (harness/sim): of 14 open cards, 11 had no R or J number, and every one of those 11 was
// settled by data the per-email decision never reads: the thread was our own request to a
// supplier, our reply after the client's email said the work was done, staff had booked or
// edited the client's order since, or the thread itself named the order.
//
// So a thread's state is a function of the whole thread and of OnSinch now:
//   order      the order the thread is about, by the strongest evidence that exists:
//              link > an R/J number written in the thread (ours or quoted) > the thread's PO
//              on an order > day + one more fact (evidence.ts) > an order staff made for the
//              client after the email, on a day it asks for. Never a day alone (Ben, 10-15).
//   state      done | needs-updated (an order, with its R and J) | needs-created (no order and
//              nobody has answered) | answered (no order, a person replied after the client)
//              | not-a-job (our own request to a supplier)
// The TV and the labels read this, so they cannot disagree with each other or with OnSinch.
// ============================================================================
import { evidenceMatch, wantOf, BOT_USER } from "./evidence";
import { CONSUMER_DOMAINS, domainOfEmail, type CompanyRec } from "../engine/resolve";

export type ThreadMsg = { message_id: string; from: string; to: string[]; at: number; subject: string; body: string; ours: boolean };
export type Grounded = { date?: string; start?: string; crew?: number; place_id?: number; venue?: string; target?: { date?: string; start?: string } };
export type OrderRef = { id: number; r: string; j: string | null; by: string };
export type ThreadState = {
  thread_id: string;
  order: OrderRef | null;
  /** Every order holding part of what the thread asked for, when it took more than one. */
  orders?: OrderRef[];
  company_ids: number[];
  state: "done" | "needs-updated" | "needs-created" | "answered" | "not-a-job";
  why: string;
};
export type StateWorld = {
  orders: any[];
  companies: CompanyRec[];
  /** Staff rows only (creator is not the bot): which order, when. */
  staffEdits: Array<{ order_id: number; at: number }>;
  /** The moment being judged; a stamp later than it is not yet known. Absent: now. */
  now?: number;
};
export type ThreadIn = {
  thread_id: string;
  messages: ThreadMsg[];
  /** Every grounded request read from the thread's emails. */
  requests: Grounded[];
  /** The live job_links row, if any. */
  link: { order_id: number } | null;
  /** The need the per-email decision raised, and when its email arrived. */
  need: { kind: "needs-created" | "needs-updated"; at: number } | null;
};

const R_RE = /\b(?:R|order\s*(?:no\.?|number|#)?\s*)[\s#:-]?(1\d{4})\b/gi;
const J_RE = /\bJ[\s#:-]?(1\d{4,5})\b/g;
const PO_RE = /\b(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,}\b/gi;
const live = (o: any) => o && Number(o.status) !== -1;
const jOf = (o: any): string | null => { const j = ([] as any[]).concat(o?.Job ?? [])[0]; return j?.id ? `J${j.id}` : null; };
const ref = (o: any, by: string): OrderRef => ({ id: Number(o.id), r: `R${o.number}`, j: jOf(o), by });

/** The order this thread is about, or null; `ambiguous` finds are no answer. */
export function findOrder(t: ThreadIn, w: StateWorld, companyIds: number[]): OrderRef | null {
  const byId = new Map(w.orders.map((o) => [Number(o.id), o]));
  const byNumber = new Map(w.orders.map((o) => [String(o.number), o]));
  const byJob = new Map<string, any>();
  for (const o of w.orders) for (const j of [].concat(o?.Job ?? []) as any[]) byJob.set(String(j.id), o);

  const want = wantOf(t.requests);
  const asked = new Set(want.days);
  const holds = (o: any) => !asked.size || daysOn(o).some((d) => asked.has(d));
  // The link is the thread's order while it holds a day the thread asks for. A link that holds
  // none is weighed with the rest: R11500 was linked to the Cytiva thread (10-14) from a screen
  // find, and the bot wrote Cytiva's shift into it while staff's R11555 held the job.
  const linked = t.link ? byId.get(Number(t.link.order_id)) : null;
  if (live(linked) && holds(linked)) return ref(linked, "link");

  const text = t.messages.map((m) => `${m.subject}\n${m.body}`).join("\n");
  const named = new Map<number, any>();
  for (const x of text.matchAll(R_RE)) { const o = byNumber.get(x[1]); if (live(o)) named.set(Number(o.id), o); }
  for (const x of text.matchAll(J_RE)) { const o = byJob.get(x[1]); if (live(o)) named.set(Number(o.id), o); }
  const mine = (o: any) => !companyIds.length || companyIds.includes(Number(o.company_id));
  const namedMine = [...named.values()].filter(mine);
  // One number named, holding the days asked: that order. Several: the days decide among them
  // (Harbour Scenic names its September R10950 and its October R11508).
  const namedHolding = namedMine.filter(holds);
  if (namedHolding.length === 1) return ref(namedHolding[0], "its number in the thread");

  const clientOrders = w.orders.filter((o) => live(o) && companyIds.includes(Number(o.company_id)));
  // A PO or project reference the thread carries, on exactly one of the client's orders.
  const tokens = new Set([...text.matchAll(PO_RE)].map((x) => x[0].toUpperCase()));
  const poHits = clientOrders.filter((o) => {
    const po = String(o.intern_name ?? "").trim().toUpperCase();
    if (po.length >= 5 && tokens.has(po)) return true;
    return String(o.name ?? "").toUpperCase().split(/[^A-Z0-9-]+/).some((p) => p.length >= 5 && /\d/.test(p) && tokens.has(p));
  }).filter(holds);
  if (poHits.length === 1) return ref(poHits[0], "its PO or project reference in the thread");

  // The day and one more fact; the venue the client names counts when the order's own name
  // carries it ("Creative Technology @ Cytiva, Amersham Place").
  const venues = new Set(t.requests.flatMap((r) => words(r.venue)));
  // Among several named orders holding the days, those; else every order of the client's (SN
  // ExCeL names R10304 and quotes, and R10522 holds the Saturday call).
  const pool = namedHolding.length > 1 ? namedHolding : clientOrders;
  const scored = pool.map((o) => {
    const ev = asked.size ? evidenceMatch(want, [o], { staffOnly: false }) : null;
    if (!ev || ev === "ambiguous") return null;
    const at = String(o.name ?? "").split("@").slice(1).join("@");
    const by = [...ev.evidence, ...(venues.size && words(at).some((x) => venues.has(x)) && !ev.evidence.includes("venue") ? ["venue name"] : [])];
    return { o, by };
  }).filter((x): x is { o: any; by: string[] } => !!x);
  if (scored.length) {
    const best = Math.max(...scored.map((x) => x.by.length));
    let top = scored.filter((x) => x.by.length === best);
    // Equal evidence: the order holding more of the days asked. SN ExCeL asks for the 17th,
    // 18th, 20th and 21st; COG's R10522 holds all four, its R10304 three.
    if (top.length > 1) {
      const held = (o: any) => new Set(daysOn(o).filter((d) => asked.has(d))).size;
      const most = Math.max(...top.map((x) => held(x.o)));
      top = top.filter((x) => held(x.o) === most);
      if (top.length === 1) return ref(top[0].o, `the day and ${top[0].by.join(" + ")}, and the most days asked`);
    }
    if (top.length === 1) return ref(top[0].o, `the day and ${top[0].by.join(" + ")}`);
  }

  // No "an order staff made for this client after the email, on a day it asks for": the
  // client and the day are not two facts for a client running several jobs a week. It found
  // R11588 (Microsoft, Excel, 10-22) for Creative Technology's NVIDIA Berlin stand-down.
  return live(linked) ? ref(linked, "link (it holds none of the days asked)") : null;
}

const STOP = new Set(["the", "and", "hotel", "london", "house", "centre", "center", "hall", "venue", "place", "street", "road", "park"]);
const words = (s: unknown): string[] => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4 && !STOP.has(x));
const daysOn = (o: any): string[] => ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []))
  .flatMap((s: any) => ([] as any[]).concat(s.Slot ?? [])).filter((s: any) => s?.cancelled !== true && s?.beginning).map((s: any) => londonDate(s.beginning));
const londonDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/**
 * Every company the thread's client addresses could be. Booking an order needs ONE company
 * (resolve.ts: an ambiguous domain is a coin flip on whose account it lands); FINDING one does
 * not, because the order's own day and facts decide among them. Measured 10-16:
 * wackerglobalevents.com is on Wacker Global Events and on Slam Dunk LTD, so the card said "not
 * in OnSinch" while R11347 held Saturday's three O2 calls; izzabelle@eventconcept.com writes
 * from .com while OnSinch holds eventconcept.co.uk.
 */
export function companiesOf(addresses: string[], companies: CompanyRec[]): number[] {
  const label = (d: string) => d.split(".")[0];
  const flat = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const out = new Set<number>();
  for (const a of addresses) {
    const d = domainOfEmail(a);
    if (!d.includes(".") || CONSUMER_DOMAINS.has(d) || /spartancrew\.co\.uk$/.test(d)) continue;
    const exact = companies.filter((c) => (c.Client ?? []).some((cl) => domainOfEmail(cl.email) === d));
    const byLabel = exact.length || label(d).length < 5 ? [] : companies.filter((c) => (c.Client ?? []).some((cl) => label(domainOfEmail(cl.email)) === label(d)));
    const byName = exact.length || byLabel.length || label(d).length < 6 ? [] : companies.filter((c) => flat(c.name).startsWith(label(d)));
    for (const c of [...exact, ...byLabel, ...byName]) out.add(Number(c.id));
  }
  return [...out];
}

/**
 * Every dated request in an order of the client's, by its day and one more fact: the orders
 * that hold them, or null when one is in none. A quote can be booked as several orders
 * (Subfrantic 10-16: R11698 for Job 1, R11701 and R11705 for Job 2's two options).
 */
export function coveredBy(t: ThreadIn, w: StateWorld, companyIds: number[]): OrderRef[] | null {
  const dated = t.requests.filter((r) => r.date);
  if (!dated.length) return null;
  const pool = w.orders.filter((o) => live(o) && companyIds.includes(Number(o.company_id)));
  const out = new Map<number, OrderRef>();
  for (const r of dated) {
    const hit = pool.map((o) => ({ o, ev: evidenceMatch(wantOf([r]), [o]) })).filter((x) => x.ev && x.ev !== "ambiguous");
    if (!hit.length) return null;
    for (const x of hit) out.set(Number(x.o.id), ref(x.o, `the day and ${(x.ev as { evidence: string[] }).evidence.join(" + ")}`));
  }
  return [...out.values()];
}

/** A staff hand on the order since `at`, by its own stamps: some edits never reach the timeline. */
function stampedSince(o: any, at: number, now = Infinity): boolean {
  const parts = [o, ...([] as any[]).concat(o?.Job ?? [])];
  for (const j of ([] as any[]).concat(o?.Job ?? [])) for (const t of ([] as any[]).concat(j?.SlotTeam ?? [])) parts.push(t, ...([] as any[]).concat(t?.Slot ?? []));
  return parts.some((x) => x?.modifier && Number(x.modifier) !== BOT_USER && Date.parse(x.modified) > at && Date.parse(x.modified) <= now);
}

export function threadState(t: ThreadIn, w: StateWorld): ThreadState {
  const companyIds = companiesOf(t.messages.filter((m) => !m.ours).flatMap((m) => [m.from, ...m.to]), w.companies);
  const order = findOrder(t, w, companyIds);
  const lastOurs = [...t.messages].reverse().find((m) => m.ours)?.at ?? 0;
  const base = { thread_id: t.thread_id, order, company_ids: companyIds };
  if (!t.need) return { ...base, state: "done", why: "nothing asked for is outstanding" };
  if (t.need.kind === "needs-created") {
    const all = coveredBy(t, w, companyIds);
    if (all?.length) return { ...base, order: order ?? all[0], orders: all, state: "done", why: `already booked: ${all.map((o) => o.r).join(", ")}` };
  }

  if (order) {
    const edited = w.staffEdits.some((e) => e.order_id === order.id && e.at > t.need!.at) || stampedSince(w.orders.find((x) => Number(x.id) === order.id), t.need.at, w.now);
    if (edited) return { ...base, state: "done", why: `staff changed ${order.r} after the email` };
    if (t.need.kind === "needs-created") {
      // A link or a number says which order the thread is about, not that this booking is in
      // it: "can I book another 3 crew next Friday" arrives in the thread of the last job.
      const o = w.orders.find((x) => Number(x.id) === order.id);
      const on = new Set(([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => [].concat(j.SlotTeam ?? [])).flatMap((s: any) => [].concat(s.Slot ?? []))
        .filter((s: any) => s?.cancelled !== true && s?.beginning).map((s: any) => londonDate(s.beginning)));
      const missing = wantOf(t.requests).days.filter((d) => !on.has(d));
      const proves = /^the day and/.test(order.by);
      if (proves || !missing.length) return { ...base, state: "done", why: `already booked: ${order.r} (${order.by})` };
      return { ...base, state: "needs-updated", why: `${order.r} has no shift on ${missing.join(", ")} (${order.by})` };
    }
    return { ...base, state: "needs-updated", why: `${order.r} needs the change (${order.by})` };
  }
  if (t.messages[0]?.ours) return { ...base, state: "not-a-job", why: "we wrote first (our request to a supplier, or our outreach), and no order of theirs matches" };
  // Our reply after the email that raised the need: a person has it. A later client email that
  // asks nothing (contact details, thanks) does not take it back.
  if (lastOurs > t.need.at) return { ...base, state: "answered", why: "a person replied after the email" };
  return t.need.kind === "needs-created"
    ? { ...base, state: "needs-created", why: "no order holds it, and nobody has answered" }
    : { ...base, state: "needs-updated", why: "no order of the client's could be found for the change, and nobody has answered" };
}
