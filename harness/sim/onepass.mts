// ============================================================================
// THE ONE-PASS STATE, scored on the simulator's end moment. Seconds, $0, reads .tmp-data/sim/.
// ----------------------------------------------------------------------------
//   input   end.json (run.mts: the TV's cards, links, readings, the bot's orders at the end),
//           the snapshot (messages, orders, companies, staff timeline)
//   through app/lib/v2/threadState.ts, the same function the minute sync would run
//   output  .tmp-data/sim/onepass.json:
//             tv          what the TV would hold: every need, with its R and J or the reason
//                         it has none
//             precision   every thread whose order is known by its link, found again with the
//                         link hidden: how often the finder names the WRONG order
//             cards       each current card, what it becomes, and why
//
//   npx tsx harness/sim/onepass.mts
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { threadState, findOrder, companiesOf, type StateWorld } from "../../app/lib/v2/threadState";

const L = (n: string) => JSON.parse(readFileSync(`.tmp-data/sim/${n}.json`, "utf8"));
const end = L("end"), meta = L("meta");
const at = Date.parse(end.at);

const orders = new Map<number, any>();
for (const o of L("orders") as any[]) if (Date.parse(o.created) <= at) orders.set(Number(o.id), o);
for (const o of end.bot_orders as any[]) orders.set(Number(o.id), o);
for (const id of end.deleted as number[]) orders.delete(Number(id));
const numberToId = new Map([...orders.values()].map((o) => [String(o.number), Number(o.id)]));
const staffEdits = (L("timeline") as any[]).filter((x) => Number(x.creator) !== 2257 && Date.parse(x.created) <= at).map((x) => {
  const d = (() => { try { return JSON.parse(x.data); } catch { return {}; } })();
  const path = /Order:(\d+)/.exec(String(d?.data?.path ?? ""));
  const id = path ? Number(path[1]) : d?.model === "Order" ? numberToId.get(String(d.id)) : undefined;
  return id ? { order_id: id, at: Date.parse(x.created) } : null;
}).filter((x): x is { order_id: number; at: number } => !!x);
const world: StateWorld = { orders: [...orders.values()], companies: L("companies"), staffEdits };

const byThread = new Map<string, any[]>();
for (const m of L("messages") as any[]) {
  if (Date.parse(m.date_iso) > at) continue;
  const a = byThread.get(m.thread_id) ?? []; a.push(m); byThread.set(m.thread_id, a);
}
// The requests: grounded where grounding passed, and every email's own reading besides. A
// reading grounding stopped on ("Call time 2 PM" read as null) still names its day and venue,
// and the day is what an order is found by (SN ExCeL: R10522 on Saturday the 17th at Excel).
const requestsOf = new Map<string, any[]>();
const add = (id: string, rs: any[]) => requestsOf.set(id, [...(requestsOf.get(id) ?? []), ...rs]);
for (const g of end.grounded as any[]) add(g.thread_id, g.requests ?? []);
const v = (x: any) => (x && typeof x === "object" && "value" in x ? x.value : x) ?? undefined;
for (const r of L("readings") as any[]) {
  if (Date.parse(r.sent_at) > at) continue;
  add(r.thread_id, ((r.extraction?.requests ?? []) as any[]).map((q) => ({ date: v(q.date), start: v(q.start), crew: typeof v(q.crew) === "number" ? v(q.crew) : undefined, venue: v(q.venue), target: q.target ? { date: v(q.target.date), start: v(q.target.start) } : undefined }))
    .filter((q) => typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date)));
}
const liveLink = new Map<string, number>();
for (const l of [...end.links].sort((a: any, b: any) => Date.parse(a.first_seen) - Date.parse(b.first_seen))) if (["linked", "relinked"].includes(l.state) && Number(l.order_id) > 0) liveLink.set(l.thread_id, Number(l.order_id));

const threadIn = (id: string, need: any, link = true) => ({
  thread_id: id,
  messages: (byThread.get(id) ?? []).sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso)).map((m) => ({
    message_id: m.message_id, from: m.from_address ?? "", to: m.to_addresses ?? [], at: Date.parse(m.date_iso), subject: m.subject ?? "", body: m.body ?? "",
    ours: !!m.is_from_spartan || /@spartancrew\.co\.uk$/i.test(m.from_address ?? ""),
  })),
  requests: requestsOf.get(id) ?? [],
  link: link && liveLink.has(id) ? { order_id: liveLink.get(id)! } : null,
  need,
});

const cards = (end.cards as any[]).map((c) => {
  const it = c.items.find((i: any) => /^needs-(created|updated)$/.test(i.kind) && !i.green);
  const need = !c.green && it ? { kind: it.kind, at: it.at } : null;
  const s = threadState(threadIn(c.thread_id, need), world);
  return { thread_id: c.thread_id, company: c.company, subject: c.subject, was: { kinds: c.items.map((i: any) => i.kind), open: !c.green, r: c.r_number ?? null, j: c.j_number ?? null }, is: s.state, r: s.order?.r ?? null, j: s.order?.j ?? null, by: s.order?.by ?? null, why: s.why };
});

// THE FINDER'S PRECISION, on production's own data: every live link production holds (the
// truth), found again from the thread with the link hidden, over the snapshot's orders alone (no
// simulated bot orders, which would double staff's real re-keys of the bot's orders).
const prodOrders = (L("orders") as any[]).filter((o) => Date.parse(o.created) <= at);
const prodWorld: StateWorld = { orders: prodOrders, companies: world.companies, staffEdits };
const prodIds = new Set(prodOrders.map((o) => Number(o.id)));
const precision = (L("links") as any[]).filter((l) => ["linked", "relinked"].includes(l.state) && Number(l.order_id) > 0).map((l) => {
  const truth = Number(l.order_id);
  if (!prodIds.has(truth)) return { thread_id: l.thread_id, truth, found: null, by: null, right: null, note: "the linked order is not in the snapshot" };
  const t = threadIn(l.thread_id, null, false);
  const f = findOrder(t, prodWorld, companiesOf(t.messages.filter((m) => !m.ours).flatMap((m) => [m.from, ...m.to]), world.companies));
  return { thread_id: l.thread_id, truth, truth_r: `R${l.r_number}`, found: f?.id ?? null, found_r: f?.r ?? null, by: f?.by ?? null, right: f ? f.id === truth : null };
});

// Is "we started the thread" safe to read as "not a client's job"? Every thread whose first
// message is ours, and how many of them the finder ties to a real order anyway.
const startedByUs = [...byThread.keys()].map((id) => threadIn(id, null)).filter((t) => t.messages[0]?.ours);
const startedWithOrder = startedByUs.map((t) => {
  const f = findOrder(t, world, companiesOf(t.messages.filter((m) => !m.ours).flatMap((m) => [m.from, ...m.to]), world.companies));
  return f ? { thread_id: t.thread_id, subject: t.messages[0].subject, r: f.r, by: f.by } : null;
}).filter(Boolean);

// The TV's Needs Action list at the end of the replay (run.mts): the baseline.
const openIds = new Set(((L("result") as any).open as any[]).map((c) => c.thread_id));
const wasOpen = cards.filter((c) => openIds.has(c.thread_id));
const tv = cards.filter((c) => /^needs-/.test(c.is));
const out = {
  at: end.at, window: { from: meta.from, to: meta.taken_at },
  before: { open: wasOpen.length, with_r_and_j: wasOpen.filter((c) => c.was.r && c.was.j).length },
  after: { open: tv.length, with_r_and_j: tv.filter((c) => c.r && c.j).length, states: cards.reduce((a: any, c) => ((a[c.is] = (a[c.is] ?? 0) + 1), a), {}) },
  precision_rows: precision,
  precision: { threads: precision.length, checked: precision.filter((p) => p.note === undefined).length, found: precision.filter((p) => p.found).length, right: precision.filter((p) => p.right === true).length, none: precision.filter((p) => p.note === undefined && !p.found).length, wrong: precision.filter((p) => p.right === false) },
  // A card that was done and is now a need, or a need that was found an order it was not shown.
  reopened: cards.filter((c) => !c.was.open && /^needs-/.test(c.is)),
  started_by_us: { threads: startedByUs.length, with_an_order: startedWithOrder.length, examples: startedWithOrder.slice(0, 12) },
  tv, cards: wasOpen,
};
writeFileSync(".tmp-data/sim/onepass.json", JSON.stringify(out, null, 2));
for (const c of wasOpen) console.log(`${c.thread_id} ${c.was.kinds.join("+").padEnd(14)} ${(c.company ?? "").slice(0, 20).padEnd(20)} -> ${c.is.padEnd(13)} ${(c.r ?? "-").padEnd(7)} ${(c.j ?? "-").padEnd(7)} ${c.why}`);
console.log(JSON.stringify({ before: out.before, after: out.after, precision: { ...out.precision, wrong: out.precision.wrong.length }, reopened: out.reopened.length, started_by_us: { threads: out.started_by_us.threads, with_an_order: out.started_by_us.with_an_order } }, null, 1));

// --thread <id>: one thread's inputs and the finder's answer, for tracing a card.
const ti = process.argv.indexOf("--thread");
if (ti > 0) {
  const id = process.argv[ti + 1], t = threadIn(id, null);
  const cs = companiesOf(t.messages.filter((m) => !m.ours).flatMap((m) => [m.from, ...m.to]), world.companies);
  console.log(JSON.stringify({ companies: cs, link: t.link, found: findOrder(t, world, cs), days: [...new Set(t.requests.map((r: any) => r.date))], named: [...new Set([...t.messages.map((m) => `${m.subject} ${m.body}`).join(" ").matchAll(/b(?:R|J)[s#:-]?(1d{4,5})b/g)].map((x) => x[0]))] }));
}

// --series: the TV every simulated hour of the replay (run.mts frames), as the current code
// showed it and as the one state would, each judged with only what existed at that hour:
// orders created by then, emails and readings by then, staff edits and stamps by then.
if (process.argv.includes("--series")) {
  const snapOrders = L("orders") as any[];
  const groundedAt = (end.grounded as any[]).map((g) => ({ ...g, t: Date.parse(g.created_at) }));
  const readings = L("readings") as any[];
  const worldAt = (t: number): StateWorld => {
    const os = new Map<number, any>();
    for (const o of snapOrders) if (Date.parse(o.created) <= t) os.set(Number(o.id), o);
    for (const o of end.bot_orders as any[]) if (Date.parse(o.created) <= t) os.set(Number(o.id), o);
    return { orders: [...os.values()], companies: world.companies, staffEdits: staffEdits.filter((e) => e.at <= t), now: t };
  };
  const reqAt = (id: string, t: number) => [
    ...groundedAt.filter((g) => g.thread_id === id && g.t <= t).flatMap((g) => g.requests ?? []),
    ...readings.filter((r) => r.thread_id === id && Date.parse(r.sent_at) <= t).flatMap((r) => ((r.extraction?.requests ?? []) as any[])
      .map((q) => ({ date: v(q.date), start: v(q.start), crew: typeof v(q.crew) === "number" ? v(q.crew) : undefined, venue: v(q.venue), target: q.target ? { date: v(q.target.date), start: v(q.target.start) } : undefined }))
      .filter((q) => typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date))),
  ];
  const series = (end.frames as any[]).map((f) => {
    const t = Date.parse(f.at), w = worldAt(t);
    const links = new Map<string, number>();
    for (const l of f.links as any[]) if (["linked", "relinked"].includes(l.state) && Number(l.order_id) > 0) links.set(l.thread_id, Number(l.order_id));
    const now = f.open.map((c: any) => {
      if (!c.need) return { ...c, is: "check", why: "the bot's own write, to check" };
      const base = threadIn(c.thread_id, c.need);
      const ti = { ...base, messages: base.messages.filter((m) => m.at <= t), requests: reqAt(c.thread_id, t), link: links.has(c.thread_id) ? { order_id: links.get(c.thread_id)! } : null };
      const s = threadState(ti, w);
      return { ...c, is: s.state, r1: s.order?.r ?? null, j1: s.order?.j ?? null, why: s.why };
    });
    const tvNow = now.filter((c: any) => c.is === "check" || /^needs-/.test(c.is));
    return {
      at: f.at,
      current: { open: f.open.length, without_r_j: f.open.filter((c: any) => !(c.r && c.j)).length },
      one: { open: tvNow.length, without_r_j: tvNow.filter((c: any) => c.is === "check" ? !(c.r && c.j) : !(c.r1 && c.j1)).length },
      residue: tvNow.filter((c: any) => c.is === "check" ? !(c.r && c.j) : !(c.r1 && c.j1)).map((c: any) => ({ thread_id: c.thread_id, is: c.is, why: c.why, company: c.company, subject: c.subject })),
    };
  });
  // Each card the one state would still show without an R and J: when it appeared, how long.
  const runs = new Map<string, { thread_id: string; first: string; last: string; hours: number; why: string; company: string; subject: string }>();
  for (const f of series) for (const c of f.residue) {
    const r = runs.get(c.thread_id) ?? { thread_id: c.thread_id, first: f.at, last: f.at, hours: 0, why: c.why, company: c.company, subject: c.subject };
    r.last = f.at; r.hours++; r.why = c.why; runs.set(c.thread_id, r);
  }
  const sum = (k: "current" | "one", m: "open" | "without_r_j") => series.reduce((a, f) => a + f[k][m], 0);
  const out2 = {
    hours: series.length,
    current: { card_hours_without_r_j: sum("current", "without_r_j"), max_at_once: Math.max(...series.map((f) => f.current.without_r_j)), hours_with_any: series.filter((f) => f.current.without_r_j > 0).length, card_hours_open: sum("current", "open") },
    one_state: { card_hours_without_r_j: sum("one", "without_r_j"), max_at_once: Math.max(...series.map((f) => f.one.without_r_j)), hours_with_any: series.filter((f) => f.one.without_r_j > 0).length, card_hours_open: sum("one", "open") },
    residue: [...runs.values()].sort((a, b) => b.hours - a.hours),
    series: series.map(({ residue: _r, ...f }) => f),
  };
  writeFileSync(".tmp-data/sim/series.json", JSON.stringify(out2, null, 2));
  console.log(JSON.stringify({ hours: out2.hours, current: out2.current, one_state: out2.one_state, residue: out2.residue.slice(0, 20) }, null, 1));
}
