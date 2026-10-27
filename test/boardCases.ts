// ============================================================================
// Email to board, in the gate and free (addendum Prompt 13 step 6): synthetic emails, each with a
// checked-in reading, go through production's own decideMessage (ground, plan), the TV's card
// (feed/v2.ts through harness/real/system.ts cardOf) and the Gmail label (mail/threadLabels.ts).
// ----------------------------------------------------------------------------
// No client data: the client, its orders and the venue are made up. What each case asserts is the
// board a coordinator should see: the card kind (none, needs-created, needs-updated, reply-with-work)
// and the label. The 20 real cases run outside the gate, by harness/board/run.ts.
// npx tsx --require ./test/fixtures/pg.ts test/boardCases.ts
// ============================================================================
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import type { World } from "../app/lib/v2/interpret/plan";
import { labelsFor } from "../app/lib/mail/threadLabels";
import { cardOf } from "../harness/real/system";
import { boardOf, type BoardCard } from "../harness/board/board";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
const SENT = "2026-10-15T09:00:00Z";

// Northwind Events (900): R30001 holds 4 crew 08:00-16:00 at Hall One (77) on Fri 20 Nov.
const slot = (id: number, day: string, start: string, end: string, size: number, place = 77) =>
  ({ id, beginning: `${day}T${start}:00+00:00`, end: `${day}T${end}:00+00:00`, size, profession_id: 1, role: 0, slotlocation_id: 800 + place, SlotLocation: { place_id: place } });
const order = (id: number, number: string, slots: any[]) =>
  ({ id, number, company_id: 900, status: 1, intern_name: "", name: `Northwind @ Hall One`, creator: 110, created: "2026-10-01T10:00:00Z", Job: [{ id: id + 1, SlotTeam: [{ id: id + 2, name: "Crew", Slot: slots }] }] });
const R1 = order(30001, "30001", [slot(61, "2026-11-20", "08:00", "16:00", 4)]);
const R2 = order(30002, "30002", [slot(62, "2026-11-27", "07:30", "15:30", 3)]);
const world: World = {
  companies: async () => [{ id: 900, name: "Northwind Events", Client: [{ id: 1, email: "ops@northwind.example" }] }],
  placesNamed: async (n) => (/^hall one$/i.test(n.trim()) ? [{ id: 77, name: "Hall One" }] : []),
  allPlaces: async () => [{ id: 77, name: "Hall One", address: "1 Example Road" }],
  companyOrders: async () => [R1, R2],
  orderByNumber: async (n) => [R1, R2].find((o) => o.number === n) ?? null,
  orderById: async (id) => [R1, R2].find((o) => o.id === id) ?? null,
};

/** One synthetic email, decided as intake decides it, and the board it makes. */
async function board(from: string, subject: string, text: string, x: any): Promise<{ card: BoardCard; label: string | null; code: string }> {
  let rec: any = null;
  await decideMessage({ message_id: "b1", thread_id: "tb", from_address: from, date_iso: SENT, subject, body: text, is_from_spartan: false },
    { extract: (async () => ({ x, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
      world, threadOrderId: async () => null, run: null, record: async (r: any) => { rec = r; }, trace: () => {} } as DecideDeps);
  const item = cardOf({ thread_id: "tb", message_id: "b1", sent_at: SENT, subject, from_address: from }, rec.kind, rec.decision, rec.executed, rec.interpretation?.grounded ?? null, rec.client.id);
  const card = boardOf(item);
  const label = item ? labelsFor({ thread_id: "tb", green: false, follow_up: false, r_number: null, items: [{ kind: item.replace(/\+work$/, ""), green: false }] } as any).order : null;
  return { card, label, code: rec.decision.code };
}
const X = (intent: string, requests: any[], extra: any = {}) => ({ intent, po: null, note: "", requests, ...extra });
const NEW = (q: { date: [string, string]; start?: [string, string]; end?: [string, string]; crew?: [number, string]; venue?: [string, string] }) =>
  ({ ...base, action: "new_shift", date: G(...q.date), ...(q.start ? { start: G(...q.start) } : {}), ...(q.end ? { end: G(...q.end) } : {}), ...(q.crew ? { crew: G(...q.crew) } : {}), ...(q.venue ? { venue: G(...q.venue) } : {}) });
const FRI = { quote: "Friday 20/11", date: G("2026-11-20", "20/11"), start: null };
const CLIENT = "ops@northwind.example";

(async () => {
  const cases: Array<[string, () => Promise<{ card: BoardCard; label: string | null; code: string }>, BoardCard, string | null]> = [
    ["a new booking three weeks out: a create, on the board to check", () => board(CLIENT, "Crew please",
      "Hi, can we book 4 crew at Hall One on 11/12 from 08:00 to 16:00?", X("booking", [NEW({ date: ["2026-12-11", "11/12"], start: ["08:00", "08:00"], end: ["16:00", "16:00"], crew: [4, "4 crew"], venue: ["Hall One", "Hall One"] })])),
      "needs-created", "Order Needs Created"],
    ["a new booking inside the two weeks: staff create it", () => board(CLIENT, "Crew please",
      "Hi, can we book 4 crew at Hall One on 23/10 from 08:00 to 16:00?", X("booking", [NEW({ date: ["2026-10-23", "23/10"], start: ["08:00", "08:00"], end: ["16:00", "16:00"], crew: [4, "4 crew"], venue: ["Hall One", "Hall One"] })])),
      "needs-created", "Order Needs Created"],
    ["a time change on a named order", () => board(CLIENT, "R30001",
      "For R30001 on Friday 20/11 can they start at 09:00 please", X("change", [{ ...base, action: "change_times", order: "R30001", target: FRI, start: G("09:00", "09:00") }])),
      "needs-updated", "Order Needs Updated"],
    ["more crew on a named order", () => board(CLIENT, "R30001",
      "For R30001 on Friday 20/11 please make it 6 crew", X("change", [{ ...base, action: "change_crew", order: "R30001", target: FRI, crew: G(6, "6 crew") }])),
      "needs-updated", "Order Needs Updated"],
    ["a cancellation of a named shift", () => board(CLIENT, "R30001",
      "Please cancel the Friday 20/11 shift on R30001, the event is off", X("cancellation", [{ ...base, action: "cancel_shift", order: "R30001", target: FRI }])),
      "needs-updated", "Order Needs Updated"],
    ["a quote with its shifts is booked to To Confirm, as ops book it", () => board(CLIENT, "Quote",
      "Could you quote 6 crew at Hall One on 11/12, 08:00 to 16:00?", X("quote_request", [NEW({ date: ["2026-12-11", "11/12"], start: ["08:00", "08:00"], end: ["16:00", "16:00"], crew: [6, "6 crew"], venue: ["Hall One", "Hall One"] })])),
      "needs-created", "Order Needs Created"],
    ["a thank-you: nothing on the board", () => board(CLIENT, "Re: crew", "Thanks so much, all good!", X("info_only", [])), "none", null],
    ["an unclear email: a reply, nothing for the board", () => board(CLIENT, "Re: crew", "Can we talk about next month?", X("unclear", [])), "none", null],
    ["staff's 07:30 against an asked 08:00 at the same venue: a person's, never a second booking", () => board(CLIENT, "Crew",
      "Hi, 3 crew at Hall One on 27/11 from 08:00 to 16:00 please", X("booking", [NEW({ date: ["2026-11-27", "27/11"], start: ["08:00", "08:00"], end: ["16:00", "16:00"], crew: [3, "3 crew"], venue: ["Hall One", "Hall One"] })])),
      "needs-updated", "Order Needs Updated"],
    ["two orders named in one email: a person's", () => board(CLIENT, "R30001 / R30002",
      "For R30001 and R30002, could the shift on Friday 20/11 start at 09:00?", X("change", [{ ...base, action: "change_times", target: FRI, start: G("09:00", "09:00") }])),
      "needs-updated", "Order Needs Updated"],
    ["a PO for a named order: written, nothing for a person beyond the check", () => board(CLIENT, "R30001", "Our PO for R30001 is NW-55123",
      X("info_only", [], { po: G("NW-55123", "NW-55123"), order: "R30001" })), "needs-updated", "Order Needs Updated"],
    ["a sender OnSinch does not hold, booking a job: a client to add, then the create", () => board("jo@stranger.example", "Crew",
      "Hi, from Stranger Shows Ltd: 4 crew at Hall One on 11/12, 08:00 to 16:00 please", X("booking", [NEW({ date: ["2026-12-11", "11/12"], start: ["08:00", "08:00"], end: ["16:00", "16:00"], crew: [4, "4 crew"], venue: ["Hall One", "Hall One"] })], { company: G("Stranger Shows Ltd", "Stranger Shows Ltd") })),
      "needs-created", "Order Needs Created"],
  ];
  for (const [name, run, card, label] of cases) {
    const got = await run();
    ok(got.card === card && got.label === label, name, got);
  }
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
