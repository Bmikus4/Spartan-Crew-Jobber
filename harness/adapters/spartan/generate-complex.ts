// ============================================================================
// Complex orders (Ben, 10-11: "It needs to be able to update and create complex orders
// perfectly ... 500 on each type"). Two sets of 500, seeded like the simple set:
//   create: multi-day runs, build and derig, two shifts in a day, two venues, booking forms,
//           mixed sizes across the crew-chief line, night shifts with a PO, a named chief.
//   update: a shift picked by name or by its old start among several that day, two changes
//           in one email, crew across the chief line both ways, a shift moved to another
//           day, a shift added at one venue of a two-venue order, one of several cancelled,
//           crew stood down, a shift with a second trade, every shift of an order at once.
// Every expected answer is the change ops would make with the operations the bot has.
// ============================================================================
import type { Op, PositionSpec } from "../../../app/lib/v2/bot/ops";
import { positionsFor } from "../../../app/lib/v2/interpret/plan";
import { addMinutes } from "../../../app/lib/v2/interpret/ground";
import { UNIQUE_PLACES, type OrderSpec, type Place } from "./world";
import {
  generateFrom, pick, int, dayWords, rangeWords, crewWords, shiftTimes, g, req, ex, sender, order, slotsOf, mail, write, addDays, jobDay,
  type Template, type Ctx, type Built, type SpartanCase,
} from "./generate";

type Shift = { date: string; start: string; end: string; crew: number; place: Place };
const placeTwo = (ctx: Ctx): [Place, Place] => { const a = pick(ctx.r, UNIQUE_PLACES); return [a, pick(ctx.r, UNIQUE_PLACES.filter((p) => p.id !== a.id))]; };
const dayTimes = (ctx: Ctx) => { const start = pick(ctx.r, ["07:00", "08:00", "09:00", "10:00"]); return { start, end: addMinutes(start, 60 * pick(ctx.r, [4, 5, 6, 8])) }; };

/** One create_order for these shifts, as the planner should build it. */
function createOp(s: ReturnType<typeof sender>, shifts: Shift[], po?: string): Op {
  return { kind: "create_order", company_id: String(s.c.id), company_name: s.c.name, client_email: s.addr, job_name: "", ...(po ? { po } : {}),
    shifts: shifts.map((x) => ({ name: "Crew", date: x.date, start: x.start, end: x.end, place_id: String(x.place.id), place_label: x.place.name, positions: positionsFor(x.crew)! })) };
}

/** A booking written as one line per shift, each read back as its own request. */
function listBooking(ctx: Ctx, shifts: Shift[], opts: { intro?: string; form?: boolean; po?: string; chief?: boolean } = {}): Built {
  const { r } = ctx;
  const s = sender(r);
  const reqs = [];
  const lines: string[] = [];
  const venues = new Set(shifts.map((x) => x.place.id));
  for (const x of shifts) {
    const day = dayWords(x.date, r), rg = rangeWords(x.start, x.end, r);
    if (opts.form) {
      const nq = `No. of crew: ${x.crew}`;
      lines.push(`Date: ${day}\nVenue: ${x.place.name}\nCall time: ${rg.a}\nFinish: ${rg.b}\n${nq}`);
      reqs.push(req({ date: g(x.date, day), start: g(x.start, rg.a), end: g(x.end, rg.b), crew: g(x.crew, nq), venue: g(x.place.name, x.place.name) }));
    } else {
      const cw = crewWords(x.crew, r);
      const at = venues.size > 1 ? ` at ${x.place.name}` : "";
      lines.push(`${day}: ${rg.text}, ${cw}${at}`);
      reqs.push(req({ date: g(x.date, day), start: g(x.start, rg.a), end: g(x.end, rg.b), crew: g(x.crew, cw), venue: g(x.place.name, x.place.name) }));
    }
  }
  const head = opts.intro ?? (venues.size > 1 ? "Could we book the following please:" : `Could we book the following at ${shifts[0].place.name} please:`);
  const poLine = opts.po ? `\n\nPO: ${opts.po}` : "";
  const text = `${head}\n\n${lines.join(opts.form ? "\n\n" : "\n")}${poLine}`;
  return {
    template: "", branch: "", rules: [],
    input: { message: mail(ctx, s, `Crew booking - ${shifts[0].place.name}`, text, false), orders: [], threadOrderId: null, company_id: s.c.id,
      oracle: ex("booking", reqs, opts.po ? g(opts.po, `PO: ${opts.po}`) : null) },
    expected: write(["booking"], [createOp(s, shifts, opts.po)]),
  };
}

const run = (ctx: Ctx, n: number, place: Place, crew = () => pick(ctx.r, [2, 3, 4, 5, 6])): Shift[] => {
  const d0 = jobDay(ctx), t = dayTimes(ctx);
  return Array.from({ length: n }, (_, k) => ({ date: addDays(d0, k), ...t, crew: crew(), place }));
};

export const CREATE: Template[] = [
  { name: "multi-day run", branch: "P26", rules: ["P1.R13"], n: 80, build: (ctx) => listBooking(ctx, run(ctx, int(ctx.r, 3, 5), pick(ctx.r, UNIQUE_PLACES))) },
  {
    name: "build and derig", branch: "P26", rules: ["P1.R13"], n: 60, build: (ctx) => {
      const place = pick(ctx.r, UNIQUE_PLACES), d1 = jobDay(ctx), t = dayTimes(ctx);
      return listBooking(ctx, [{ date: d1, ...t, crew: pick(ctx.r, [4, 6, 8]), place }, { date: addDays(d1, int(ctx.r, 1, 3)), start: "22:00", end: "02:00", crew: pick(ctx.r, [2, 3, 4]), place }]);
    },
  },
  {
    name: "two shifts in one day", branch: "P26", rules: ["P1.R13"], n: 60, build: (ctx) => {
      const place = pick(ctx.r, UNIQUE_PLACES), d = jobDay(ctx);
      return listBooking(ctx, [{ date: d, start: "07:00", end: "12:00", crew: pick(ctx.r, [4, 5, 6]), place }, { date: d, start: pick(ctx.r, ["17:00", "18:00"]), end: "23:00", crew: pick(ctx.r, [2, 3]), place }]);
    },
  },
  {
    name: "two venues", branch: "P26", rules: ["P1.R13"], n: 50, build: (ctx) => {
      const [a, b] = placeTwo(ctx), d = jobDay(ctx);
      return listBooking(ctx, [{ date: d, ...dayTimes(ctx), crew: pick(ctx.r, [2, 3, 4]), place: a }, { date: addDays(d, 1), ...dayTimes(ctx), crew: pick(ctx.r, [2, 5]), place: b }]);
    },
  },
  { name: "booking form", branch: "P26", rules: ["P1.R13", "P1.R16"], n: 60, build: (ctx) => listBooking(ctx, run(ctx, int(ctx.r, 2, 3), pick(ctx.r, UNIQUE_PLACES)), { form: true, intro: "Please see our crew request below." }) },
  {
    name: "mixed sizes across the chief line", branch: "P26", rules: ["P1.R16"], n: 50, build: (ctx) => {
      const place = pick(ctx.r, UNIQUE_PLACES), sizes = [pick(ctx.r, [2, 3]), pick(ctx.r, [4, 5, 6]), pick(ctx.r, [8, 9])];
      return listBooking(ctx, run(ctx, 3, place).map((x, k) => ({ ...x, crew: sizes[k] })));
    },
  },
  {
    name: "night shifts with a PO", branch: "P26", rules: ["P1.R12"], n: 50, build: (ctx) => {
      const place = pick(ctx.r, UNIQUE_PLACES), d = jobDay(ctx);
      return listBooking(ctx, [0, 1].map((k) => ({ date: addDays(d, k), start: "22:00", end: "02:00", crew: pick(ctx.r, [3, 4, 6]), place })), { po: String(int(ctx.r, 10000, 99999)) });
    },
  },
  {
    name: "a named crew chief", branch: "P26", rules: ["P1.R16"], n: 40, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), place = pick(r, UNIQUE_PLACES), date = jobDay(ctx), t = dayTimes(ctx), n = int(r, 4, 9);
      const day = dayWords(date, r), rg = rangeWords(t.start, t.end, r), cw = `${n} crew`;
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, `Crew - ${place.name}`, `Could we book ${cw} including a crew chief at ${place.name} on ${day}, ${rg.text}?`, false), orders: [], threadOrderId: null, company_id: s.c.id,
          oracle: ex("booking", [req({ date: g(date, day), start: g(t.start, rg.a), end: g(t.end, rg.b), crew: g(n, cw), crew_chief: g(true, "crew chief"), venue: g(place.name, place.name) })]) },
        expected: write(["booking"], [createOp(s, [{ date, ...t, crew: n, place }])]),
      };
    },
  },
  { name: "long run of shifts", branch: "P26", rules: ["P1.R13"], n: 50, build: (ctx) => listBooking(ctx, run(ctx, int(ctx.r, 6, 8), pick(ctx.r, UNIQUE_PLACES))) },
];

// ---- updates -------------------------------------------------------------------------------------

const timesOps = (o: OrderSpec, n: number, date: string, start: string, end: string): Op[] =>
  slotsOf(o, n).map((sl) => ({ kind: "set_position_times" as const, order_id: o.id, slot_id: sl.id, date, start, end }));
const teamId = (o: OrderSpec, n: number) => o.id * 10 + n;
const CHIEF: PositionSpec = { size: 1, profession_id: "36", role: "crew_chief" };

/** The ops that take shift n of an order from its crew to `total`, keeping one chief on 4-9 and none on 1-3. */
function crewOps(o: OrderSpec, n: number, total: number): Op[] {
  const sh = o.shifts[n], slots = slotsOf(o, n);
  const hasChief = sh.crew >= 4, wantsChief = total >= 4;
  const crewSlot = slots.find((x) => x.role === 0 && x.profession_id === 1)!;
  const ops: Op[] = [];
  if (wantsChief && !hasChief) ops.push({ kind: "add_position", order_id: o.id, shift_id: teamId(o, n), date: sh.date, start: sh.start, end: sh.end, position: CHIEF });
  if (!wantsChief && hasChief) ops.push({ kind: "cancel_position", order_id: o.id, slot_id: slots.find((x) => x.role === 1)!.id });
  ops.push({ kind: "set_position_size", order_id: o.id, slot_id: crewSlot.id, size: wantsChief ? total - 1 : total });
  return ops;
}

function client(ctx: Ctx, shifts: Omit<OrderSpec["shifts"][number], "place">[], place?: Place) {
  const s = sender(ctx.r), p = place ?? pick(ctx.r, UNIQUE_PLACES);
  const o = order(ctx, 0, s.c.id, shifts.map((x) => ({ place: p, ...x })));
  return { s, p, o };
}
const changeCase = (ctx: Ctx, s: ReturnType<typeof sender>, o: OrderSpec, subject: string, text: string, oracle: ReturnType<typeof ex>, ops: Op[], orders: OrderSpec[] = [o]): Built => ({
  template: "", branch: "", rules: [],
  input: { message: mail(ctx, s, subject, text), orders, threadOrderId: null, company_id: s.c.id, oracle },
  expected: write(["change"], ops),
});

export const UPDATE: Template[] = [
  {
    name: "change the derig by name", branch: "P9", rules: ["P1.R14"], n: 50, build: (ctx) => {
      const d = jobDay(ctx);
      const { s, o } = client(ctx, [{ date: d, start: "07:00", end: "12:00", crew: 5, name: "Install" }, { date: d, start: "18:00", end: "23:00", crew: 3, name: "Derig" }]);
      const t = pick(ctx.r, [{ start: "19:00", end: "23:00" }, { start: "20:00", end: "00:00" }, { start: "22:00", end: "02:00" }]);
      const day = dayWords(d, ctx.r), rg = rangeWords(t.start, t.end, ctx.r), tq = `the derig on ${day}`;
      return changeCase(ctx, s, o, "Derig times", `Could ${tq} be ${rg.text} instead please?`,
        ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: tq, date: g(d, day), start: null } })]), timesOps(o, 1, d, t.start, t.end));
    },
  },
  {
    name: "change one of two shifts by its start", branch: "P9", rules: ["P1.R15"], n: 40, build: (ctx) => {
      const d = jobDay(ctx);
      const { s, o } = client(ctx, [{ date: d, start: "08:00", end: "12:00", crew: 4 }, { date: d, start: "14:00", end: "18:00", crew: 2 }]);
      const n = int(ctx.r, 0, 1), old = o.shifts[n], end = addMinutes(old.end, 60 * pick(ctx.r, [1, 2]));
      const day = dayWords(d, ctx.r), oq = pick(ctx.r, n ? ["2pm", "14:00"] : ["8am", "08:00"]), eq = pick(ctx.r, [end, `${Number(end.slice(0, 2)) % 12 || 12}pm`]);
      return changeCase(ctx, s, o, "Finish time", `Can the ${oq} shift on ${day} finish at ${eq} instead?`,
        ex("change", [req({ action: "change_times", end: g(end, eq), target: { quote: `the ${oq} shift on ${day}`, date: g(d, day), start: g(old.start, oq) } })]), timesOps(o, n, d, old.start, end));
    },
  },
  {
    name: "two changes on two days", branch: "X10", rules: ["P1.R13"], n: 50, build: (ctx) => {
      const d = jobDay(ctx);
      const { s, o } = client(ctx, [{ date: d, ...dayTimes(ctx), crew: 4 }, { date: addDays(d, 1), ...dayTimes(ctx), crew: 5 }]);
      const t = dayTimes(ctx), total = pick(ctx.r, [6, 7, 8]);
      const w1 = dayWords(d, ctx.r), w2 = dayWords(addDays(d, 1), ctx.r), rg = rangeWords(t.start, t.end, ctx.r), cq = `${total} crew`;
      return changeCase(ctx, s, o, "Two changes", `Two changes please. On ${w1} can the crew do ${rg.text}? And on ${w2} please make it ${cq}.`,
        ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: w1, date: g(d, w1), start: null } }), req({ action: "change_crew", date: g(addDays(d, 1), w2), crew: g(total, cq) })]),
        [...timesOps(o, 0, d, t.start, t.end), ...crewOps(o, 1, total)]);
    },
  },
  ...(["up", "down"] as const).map((way): Template => ({
    name: `crew ${way} across the chief line`, branch: "P16", rules: ["P1.R16"], n: way === "up" ? 40 : 30, build: (ctx) => {
      const from = way === "up" ? pick(ctx.r, [2, 3]) : pick(ctx.r, [4, 5, 6]), total = way === "up" ? pick(ctx.r, [4, 5, 6]) : pick(ctx.r, [2, 3]);
      const d = jobDay(ctx);
      const { s, o } = client(ctx, [{ date: d, ...dayTimes(ctx), crew: from }]);
      const day = dayWords(d, ctx.r), cq = `${total} crew`;
      return changeCase(ctx, s, o, "Crew numbers", `Can we make it ${cq} on ${day} please?`, ex("change", [req({ action: "change_crew", date: g(d, day), crew: g(total, cq) })]), crewOps(o, 0, total));
    },
  })),
  ...(["same times", "new times"] as const).map((how): Template => ({
    name: `move a shift to another day, ${how}`, branch: "P10", rules: ["P1.R14"], n: how === "same times" ? 50 : 40, build: (ctx) => {
      const d = jobDay(ctx), t0 = dayTimes(ctx);
      const { s, o } = client(ctx, [{ date: d, ...t0, crew: pick(ctx.r, [2, 3, 5]) }]);
      const nd = addDays(d, pick(ctx.r, [1, 2, 7])), w0 = dayWords(d, ctx.r), w1 = dayWords(nd, ctx.r);
      if (how === "same times") {
        return changeCase(ctx, s, o, "Date change", `Could we move the shift on ${w0} to ${w1} please? Same times.`,
          ex("change", [req({ action: "change_times", date: g(nd, w1), target: { quote: `the shift on ${w0}`, date: g(d, w0), start: null } })]), timesOps(o, 0, nd, t0.start, t0.end));
      }
      const t = dayTimes(ctx), rg = rangeWords(t.start, t.end, ctx.r);
      return changeCase(ctx, s, o, "Date change", `Could we move the shift on ${w0} to ${w1}, ${rg.text}?`,
        ex("change", [req({ action: "change_times", date: g(nd, w1), start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: `the shift on ${w0}`, date: g(d, w0), start: null } })]), timesOps(o, 0, nd, t.start, t.end));
    },
  })),
  {
    name: "add a shift at one venue of two", branch: "P21", rules: ["P1.R13"], n: 40, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), [a, b] = placeTwo(ctx), d = jobDay(ctx);
      const o = order(ctx, 0, s.c.id, [{ date: d, ...dayTimes(ctx), crew: 3, place: a }, { date: addDays(d, 1), ...dayTimes(ctx), crew: 3, place: b }]);
      const at = pick(r, [a, b]), nd = addDays(d, 2), t = dayTimes(ctx), crew = pick(r, [2, 3, 4]);
      const day = dayWords(nd, r), rg = rangeWords(t.start, t.end, r), cw = crewWords(crew, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, `Re: R${o.number}`, `Please add a shift to R${o.number} at ${at.name} on ${day}, ${rg.text}, ${cw}.`), orders: [o], threadOrderId: null, company_id: s.c.id,
          oracle: ex("booking", [req({ date: g(nd, day), start: g(t.start, rg.a), end: g(t.end, rg.b), crew: g(crew, cw), venue: g(at.name, at.name) })]) },
        expected: write(["booking", "change"], [{ kind: "add_shift", order_id: o.id, location_id: 70000 + at.id, name: "Crew", date: nd, start: t.start, end: t.end, positions: positionsFor(crew)! }]),
      };
    },
  },
  {
    name: "cancel one shift of several", branch: "P19", rules: ["P1.R13"], n: 40, build: (ctx) => {
      const d = jobDay(ctx);
      const { s, o } = client(ctx, [0, 1, 2].map((k) => ({ date: addDays(d, k), ...dayTimes(ctx), crew: pick(ctx.r, [2, 4, 5]) })));
      const n = int(ctx.r, 0, 2), day = dayWords(addDays(d, n), ctx.r);
      return {
        ...changeCase(ctx, s, o, "Cancellation", `Please cancel the shift on ${day}; the other days are unchanged.`,
          ex("cancellation", [req({ action: "cancel_shift", date: g(addDays(d, n), day) })]), slotsOf(o, n).map((sl) => ({ kind: "cancel_position" as const, order_id: o.id, slot_id: sl.id }))),
        expected: write(["cancellation", "change"], slotsOf(o, n).map((sl) => ({ kind: "cancel_position" as const, order_id: o.id, slot_id: sl.id }))),
      };
    },
  },
  {
    name: "stand crew down", branch: "P13", rules: ["P1.R16"], n: 40, build: (ctx) => {
      const d = jobDay(ctx), from = pick(ctx.r, [6, 7, 8]), less = int(ctx.r, 1, 2);
      const { s, o } = client(ctx, [{ date: d, ...dayTimes(ctx), crew: from }]);
      const day = dayWords(d, ctx.r), q = pick(ctx.r, [`stand down ${less} crew`, `${less} fewer crew`, `release ${less} crew`]);
      return changeCase(ctx, s, o, "Crew numbers", `Could we ${q.startsWith(String(less)) ? `have ${q}` : q} on ${day} please?`,
        ex("change", [req({ action: "change_crew", date: g(d, day), crew_remove: g(less, q) } as any)]), crewOps(o, 0, from - less));
    },
  },
  {
    name: "times on a shift with a second trade", branch: "P10", rules: ["P1.R14"], n: 30, build: (ctx) => {
      const d = jobDay(ctx);
      const { s, o } = client(ctx, [{ date: d, ...dayTimes(ctx), crew: 5, extra: { profession_id: 7, size: 2 } }]);
      const t = dayTimes(ctx), day = dayWords(d, ctx.r), rg = rangeWords(t.start, t.end, ctx.r);
      return changeCase(ctx, s, o, "Times", `Could the crew and carpenters on ${day} do ${rg.text} instead?`,
        ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: day, date: g(d, day), start: null } })]), timesOps(o, 0, d, t.start, t.end));
    },
  },
  {
    name: "every shift of an order at once", branch: "X10", rules: ["P1.R13"], n: 50, build: (ctx) => {
      const d = jobDay(ctx), k = int(ctx.r, 2, 3);
      const { s, o } = client(ctx, Array.from({ length: k }, (_, i) => ({ date: addDays(d, i), ...dayTimes(ctx), crew: 3 })));
      const t = dayTimes(ctx), rg = rangeWords(t.start, t.end, ctx.r);
      const ws = o.shifts.map((x) => dayWords(x.date, ctx.r));
      return changeCase(ctx, s, o, "All shifts", `Can all the shifts (${ws.join(", ")}) be ${rg.text} instead?`,
        ex("change", o.shifts.map((x, i) => req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: ws[i], date: g(x.date, ws[i]), start: null } }))),
        o.shifts.flatMap((x, i) => timesOps(o, i, x.date, t.start, t.end)));
    },
  },
];

// ---- the thread already linked to an order (threadOrder.ts, 10-11) -----------------------------

UPDATE.push(
  {
    name: "change on a linked thread, two orders that day", branch: "P4", rules: ["P1.R14"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), [a, b] = placeTwo(ctx), d = jobDay(ctx);
      const mine = order(ctx, 0, s.c.id, [{ date: d, ...dayTimes(ctx), crew: 3, place: a }]);
      const other = order(ctx, 1, s.c.id, [{ date: d, ...dayTimes(ctx), crew: 2, place: b }]);
      const t = dayTimes(ctx), day = dayWords(d, r), rg = rangeWords(t.start, t.end, r);
      const built = changeCase(ctx, s, mine, "Re: Crew booking", `Could we change the times for ${day} to ${rg.text} please?`,
        ex("change", [req({ action: "change_times", start: g(t.start, rg.a), end: g(t.end, rg.b), target: { quote: day, date: g(d, day), start: null } })]), timesOps(mine, 0, d, t.start, t.end), [mine, other]);
      return { ...built, input: { ...built.input, threadOrderId: mine.id } };
    },
  },
  {
    name: "new shift on a linked thread", branch: "P4", rules: ["P1.R13"], n: 15, build: (ctx) => {
      const { r } = ctx;
      const { s, p, o } = client(ctx, [{ date: jobDay(ctx), ...dayTimes(ctx), crew: 4 }]);
      const nd = addDays(o.shifts[0].date, 1), crew = pick(r, [2, 3]), day = dayWords(nd, r), rg = rangeWords("22:00", "02:00", r), cw = crewWords(crew, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, "Re: Crew booking", `Please can you add a derig on ${day}, ${rg.text}, ${cw}?`), orders: [o], threadOrderId: o.id, company_id: s.c.id,
          oracle: ex("booking", [req({ date: g(nd, day), start: g("22:00", rg.a), end: g("02:00", rg.b), crew: g(crew, cw) })]) },
        expected: write(["booking", "change"], [{ kind: "add_shift", order_id: o.id, location_id: 70000 + p.id, name: "Crew", date: nd, start: "22:00", end: "02:00", positions: positionsFor(crew)! }]),
      };
    },
  },
  {
    name: "new shift on a linked thread whose order cannot be read", branch: "P4", rules: [], n: 10, build: (ctx) => {
      const { r } = ctx;
      const s = sender(r), place = pick(r, UNIQUE_PLACES), d = jobDay(ctx), t = dayTimes(ctx), crew = pick(r, [2, 3, 4]);
      const day = dayWords(d, r), rg = rangeWords(t.start, t.end, r), cw = crewWords(crew, r);
      return {
        template: "", branch: "", rules: [],
        input: { message: mail(ctx, s, "Re: Crew booking", `Could we add ${cw} at ${place.name} on ${day}, ${rg.text}?`), orders: [], threadOrderId: ctx.idBase + 3, company_id: s.c.id,
          oracle: ex("booking", [req({ date: g(d, day), start: g(t.start, rg.a), end: g(t.end, rg.b), crew: g(crew, cw), venue: g(place.name, place.name) })]) },
        // Booking afresh would put a second order on a job that already has one.
        expected: { kind: "handoff", intents: ["booking", "change"], ops: [] },
      };
    },
  },
);
for (const [name, n] of [["two changes on two days", 40], ["every shift of an order at once", 40], ["change the derig by name", 40], ["move a shift to another day, same times", 45], ["cancel one shift of several", 35]] as const) UPDATE.find((t) => t.name === name)!.n = n;

export const generateCreate =(total = 500, seed = 20261011): SpartanCase[] => generateFrom(CREATE, total, seed, "C");
export const generateUpdate = (total = 500, seed = 20261012): SpartanCase[] => generateFrom(UPDATE, total, seed, "U");
