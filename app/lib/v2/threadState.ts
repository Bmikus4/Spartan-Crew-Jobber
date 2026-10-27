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
//   order      the order the thread is about, by the ladder in identity/index.ts (one rule for
//              the planner and the TV). Never a day alone (Ben, 10-15). [DECISIONS V1]
//   state      done | needs-updated (an order, with its R and J) | needs-created (no order and
//              nobody has answered) | answered (no order, a person replied after the client)
//              | not-a-job (our own request to a supplier)
// The TV and the labels read this, so they cannot disagree with each other or with OnSinch.
// ============================================================================
import { wantOf, BOT_USER } from "./evidence";
import { identify, covered, refsIn, type OrderRef } from "./identity";
import { CONSUMER_DOMAINS, domainOfEmail, type CompanyRec } from "../onsinch/resolve";

export type ThreadMsg = { message_id: string; from: string; to: string[]; at: number; subject: string; body: string; ours: boolean };
export type Grounded = { date?: string; start?: string; crew?: number; place_id?: number; venue?: string; target?: { date?: string; start?: string } };
export type { OrderRef };
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

/** The order this thread is about, or null: identity/index.ts decides; of several, only the lead. */
export function findOrder(t: ThreadIn, w: StateWorld, companyIds: number[]): OrderRef | null {
  const text = t.messages.map((m) => `${m.subject}\n${m.body}`).join("\n");
  const id = identify({ refs: refsIn(t.messages), requests: t.requests, link: t.link ? Number(t.link.order_id) : null, text }, w.orders, { companyIds });
  return id.kind === "one" ? id.order : id.kind === "several" ? id.lead ?? null : null;
}

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

/** Every dated request held by the client's orders (identity/index.ts covered), or null. `after`: the need's email. */
export function coveredBy(t: ThreadIn, w: StateWorld, companyIds: number[], after?: number): OrderRef[] | null {
  return covered(t.requests, w.orders, { companyIds, after });
}

/** A staff hand on the order since `at`, by its own stamps: some edits never reach the timeline. */
export function stampedSince(o: any, at: number, now = Infinity): boolean {
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
    const all = coveredBy(t, w, companyIds, t.need.at);
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
