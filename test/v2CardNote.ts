// ============================================================================
// A TV card says what the job is and what needs doing, in plain sentences, and never the system's own reasoning
// (Ben, 10-11; the owner, 30 Oct: "plain and explain things outright"), on every decision production had made by
// 11 Oct: 70 cards, 20 of which printed text like `request 1 crew: "another 3 crew" reads as null, not 3` before
// cardNote.ts. Pinned: no line carries internal text or the email's own words; every shift is listed; the check
// is one sentence; an unknown reason is never shown as text.
//
// Offline.  npx tsx test/v2CardNote.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { cardNote, checkOf } from "../app/lib/feed/cardNote";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

// Words and shapes that are the engine talking to itself, or the email's words quoted back.
const INTERNAL = /reads as|\bnull\b|\bundefined\b|request \d|shift \d{4,}|slot|\(\s*[0-9a-f]{12,}\s*\)|shadow|operation|grounded|\bop\b|\d{4}-\d{2}-\d{2}|\{|\}|the client wrote|is not one the system|"|\d\d:\d\d(?![ap]m)|\+\d+ more/i;

const rows = JSON.parse(readFileSync(new URL("./fixtures/v2-cards.json", import.meta.url), "utf8")) as any[];
console.log(`[1] all ${rows.length} production decisions of 9-11 Oct`);
let leaks = 0, empty = 0, unsentenced = 0;
for (const r of rows) {
  for (const written of [false, true]) {
    const n = cardNote({ decision: r.decision, grounded: r.grounded, executed: r.executed, written });
    const text = [n.ask, n.check].filter(Boolean).join(" ");
    if (INTERNAL.test(text)) { leaks++; if (leaks <= 5) console.log(`      leak: ${text}`); }
    if (!text.trim() && r.decision.kind !== "none") empty++;
    if ([n.ask, n.check].some((x) => x && !/^[A-Z0-9].*[.!?]$/.test(x))) unsentenced++;
  }
}
ok(leaks === 0, "no line carries internal text, a raw time or the email's words", `${leaks}`);
ok(empty === 0, "every card says something", `${empty}`);
ok(unsentenced === 0, "every line is a sentence", `${unsentenced}`);

console.log("\n[2] the sentences ops read for the shapes measured");
const g = (requests: any[], intent = "booking") => ({ intent, requests, problems: [] });
const handoff = (reasons: string[], reply = false) => ({ kind: "handoff" as const, reasons, ...(reply ? { reply } : {}) });
const eq = (got: { ask: string | null; check: string | null }, want: { ask: string | null; check: string | null }, label: string) =>
  ok(got.ask === want.ask && got.check === want.check, label, got.ask === want.ask && got.check === want.check ? "" : `got ${JSON.stringify(got)}`);
eq(cardNote({ decision: handoff(["the client confirmed 2026-11-16, 2026-11-18, and no order holds it yet"]), grounded: g([{ action: "new_shift", date: "2026-11-16", start: "18:00", end: "00:00", crew: 4, problems: [] }, { action: "new_shift", date: "2026-11-18", start: "17:00", end: "20:00", crew: 4, problems: [] }]) as any, executed: null, written: false }),
  { ask: "Book 8 crew on Mon 16 and Wed 18 Nov. The client has confirmed.", check: "No order holds it yet." }, "a confirmed booking: every shift, and that the client confirmed");
eq(cardNote({ decision: handoff(["the email says 4 crew, the shift has 6"]), grounded: g([{ action: "change_crew", crew_add: 2, crew: 6, target: { quote: "x", date: "2026-11-04", start: "07:45" }, problems: [] }], "change") as any, executed: null, written: false, fresh: false }),
  { ask: "Add 2 crew on Wed 4 Nov (the 7:45am call), making 6.", check: "The email says 4 crew; the shift has 6." }, "crew added to one call, with the new total");
eq(cardNote({ decision: handoff(["no venue in the email"]), grounded: g([{ action: "cancel_shift", date: "2026-11-06", problems: [] }, { action: "cancel_shift", date: "2026-11-09", problems: [] }], "cancellation") as any, executed: null, written: false, fresh: false }),
  { ask: "Cancel both shifts, Fri 6 and Mon 9 Nov.", check: "The email does not say where." }, "two shifts cancelled, named together");
eq(cardNote({ decision: handoff(["no crew count the client wrote"]), grounded: g([{ action: "new_shift", date: "2026-10-22", start: "08:00", end: "16:00", problems: [] }]) as any, executed: null, written: false }),
  { ask: "Book crew on Thu 22 Oct, 8am to 4pm.", check: "The email does not say how many crew." }, "what is missing is said outright");
eq(cardNote({ decision: handoff(['request 1 crew: "another 3 crew" reads as null, not 3']), grounded: g([{ action: "new_shift", problems: [] }]) as any, executed: null, written: false }),
  { ask: "Book a new order.", check: "The crew count in the email could not be read: check it." }, "a count the code could not read is named, not quoted");
eq(cardNote({ decision: handoff(["the client asked for a quote"], true), grounded: g([{ action: "new_shift", date: "2026-10-23", start: "07:00", end: "12:00", problems: [] }], "quote_request") as any, executed: null, written: false }),
  { ask: "Send a quote for crew on Fri 23 Oct, 7am to noon.", check: null }, "a quote says what to price");
eq(cardNote({ decision: handoff(["sent with a later email (1a11afc6bff4c2f4); the system read only the later one"]), grounded: null, executed: null, written: false }),
  { ask: null, check: "Read the email." }, "a message id never reaches the screen");
const write = { kind: "write" as const, ops: [{ source: "s", op: { kind: "set_position_times", order_id: 1, slot_id: 2, date: "2026-10-11", start: "17:00", end: "23:00" } as any }], why: ["R11224 shift 41611: times to 17:00-23:00"] };
eq(cardNote({ decision: write, grounded: null, executed: [{ status: "verified" } as any], written: true }), { ask: "The system did this: Change the times on Sun 11 Oct: 5pm to 11pm.", check: null }, "a write that ran");
eq(cardNote({ decision: write, grounded: null, executed: null, written: false }), { ask: "Change the times on Sun 11 Oct: 5pm to 11pm.", check: "Not written: do it by hand." }, "a write that did not run");
const two = { ...write, ops: [...write.ops, write.ops[0]] };
eq(cardNote({ decision: two, grounded: null, executed: [{ status: "verified" } as any, { status: "failed", reasons: ["x"] } as any], written: false }),
  { ask: "Change the times on Sun 11 Oct: 5pm to 11pm.", check: "The system stopped partway: check OnSinch." }, "a write that stopped partway says so");

console.log("\n[3] an unknown reason is never shown as text");
ok(checkOf("a reason added to the planner next month (shift 99999)") === "Read the email.", "falls back to Read the email");

// A long job is summed up (Ben, 19 Nov: "Add (total number of crew) over (this many dates)"); a crew chief is inside
// the headcount, never "1 crew and 5 crew".
{
  const pos = (chief: number, crew: number, extra: any[] = []) => [...(chief ? [{ profession_id: "36", size: chief, role: "crew_chief" }] : []), { profession_id: "1", size: crew, role: "crew" }, ...extra];
  const sh = (date: string, start: string, end: string, positions: any[]) => ({ date, start, end, place_id: 1, positions });
  const write = (shifts: any[]) => ({ kind: "write" as const, ops: [{ op: { kind: "create_order", shifts } }], why: [] }) as any;
  const twelve = [
    sh("2026-12-04", "10:00", "12:00", pos(1, 5)), sh("2026-12-04", "10:00", "14:00", pos(1, 3)), sh("2026-12-04", "17:00", "19:00", pos(1, 3)),
    sh("2026-12-05", "01:00", "05:00", pos(2, 8)), sh("2026-12-05", "08:00", "10:00", pos(1, 7)), sh("2026-12-05", "08:00", "12:00", pos(1, 4)),
    sh("2026-12-11", "17:00", "19:00", pos(2, 16)), sh("2026-12-12", "01:00", "05:00", pos(2, 17)), sh("2026-12-17", "10:00", "15:00", pos(1, 7)),
    sh("2026-12-17", "17:00", "19:00", pos(1, 5)), sh("2026-12-18", "01:00", "05:00", pos(2, 8)), sh("2026-12-18", "08:00", "10:00", pos(1, 7)),
  ];
  const long = cardNote({ decision: write(twelve), grounded: null, executed: null, written: false });
  ok(long.ask === "Book 106 crew over 6 dates.", "a 12-shift order: Book 106 crew over 6 dates", String(long.ask));
  const short = cardNote({ decision: write([sh("2026-12-04", "10:00", "12:00", pos(1, 5)), sh("2026-12-05", "08:00", "12:00", pos(0, 4, [{ profession_id: "5", size: 2, role: "crew" }]))]), grounded: null, executed: null, written: false });
  ok(short.ask === "Book 12 crew on Fri 4 and Sat 5 Dec.", "two dates: Book 12 crew on Fri 4 and Sat 5 Dec, the chief inside the count", String(short.ask));
  const one = cardNote({ decision: write([sh("2026-12-04", "10:00", "12:00", pos(1, 5))]), grounded: null, executed: null, written: false });
  ok(one.ask === "Book 6 crew on Fri 4 Dec, 10am to noon.", "one shift: Book 6 crew on Fri 4 Dec, 10am to noon (never 1 crew and 5 crew)", String(one.ask));
  const req = (date: string, crew?: number) => ({ action: "new_shift", date, start: "09:00", end: "13:00", crew, problems: [] });
  const asks = cardNote({ decision: handoff(["a new booking from 2026-12-04, within 14 days of the email, is for staff to create"]), grounded: g([req("2026-12-04", 4), req("2026-12-05", 6), req("2026-12-06", 2), req("2026-12-07", 3)]) as any, executed: null, written: false });
  ok(/^Book 15 crew over 4 dates\./.test(asks.ask ?? ""), "four requested shifts: Book 15 crew over 4 dates", String(asks.ask));
  const unknown = cardNote({ decision: handoff(["a new booking from 2026-12-04, within 14 days of the email, is for staff to create"]), grounded: g([req("2026-12-04", 4), req("2026-12-05"), req("2026-12-05", 2), req("2026-12-06", 3)]) as any, executed: null, written: false });
  ok(/^Book 4 shifts on Fri 4, Sat 5 and Sun 6 Dec\./.test(unknown.ask ?? ""), "a missing count is never guessed: the shifts are counted instead", String(unknown.ask));
  const quote = cardNote({ decision: handoff(["the client asked for a quote"], true), grounded: g([req("2026-12-04", 4), req("2026-12-04", 6), req("2026-12-04", 2), req("2026-12-04", 3)], "quote_request") as any, executed: null, written: false });
  ok(/^Send a quote for 15 crew over 4 shifts on Fri 4 Dec\./.test(quote.ask ?? ""), "one date: over 4 shifts on Fri 4 Dec", String(quote.ask));
  ok(!INTERNAL.test([long.ask, short.ask, one.ask, asks.ask, unknown.ask, quote.ask].join(" ")), "no internal wording in any of them");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
