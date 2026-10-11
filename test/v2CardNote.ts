// ============================================================================
// A TV card's line never shows the system's own reasoning (Ben, 10-11), on every decision
// production had made by then: 70 cards, 20 of which printed text like `request 1 crew:
// "another 3 crew" reads as null, not 3` before cardNote.ts.
//
// Offline.  npx tsx test/v2CardNote.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { cardNote, checkOf, NOTE_MAX } from "../app/lib/feed/cardNote";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

// Words and shapes that are the engine talking to itself.
const INTERNAL = /reads as|\bnull\b|\bundefined\b|request \d|shift \d{4,}|slot|\(\s*[0-9a-f]{12,}\s*\)|shadow|operation|grounded|\bop\b|\d{4}-\d{2}-\d{2}|\{|\}|the client wrote|is not one the system/i;

const rows = JSON.parse(readFileSync(new URL("./fixtures/v2-cards.json", import.meta.url), "utf8")) as any[];
console.log(`[1] all ${rows.length} production decisions of 9-11 Oct`);
let leaks = 0, long = 0, empty = 0;
for (const r of rows) {
  for (const written of [false, true]) {
    const n = cardNote({ decision: r.decision, grounded: r.grounded, executed: r.executed, written });
    if (INTERNAL.test(n)) { leaks++; if (leaks <= 5) console.log(`      leak: ${n}`); }
    if (n.length > NOTE_MAX) long++;
    if (!n.trim()) empty++;
  }
}
ok(leaks === 0, "no line carries internal text", `${leaks}`);
ok(long === 0, `no line is longer than ${NOTE_MAX}`, `${long}`);
ok(empty === 0, "every card says something", `${empty}`);

console.log("\n[2] the lines ops read for the shapes measured");
const g = (requests: any[], intent = "booking") => ({ intent, requests, problems: [] });
const handoff = (reasons: string[], reply = false) => ({ kind: "handoff" as const, reasons, ...(reply ? { reply } : {}) });
const eq = (got: string, want: string, label: string) => ok(got === want, label, got === want ? "" : `got "${got}"`);
eq(cardNote({ decision: handoff(["no venue in the email"], true), grounded: g([{ action: "new_shift", date: "2026-10-22", start: "08:00", end: "16:00", crew: 4, problems: [] }]) as any, executed: null, written: false }),
  "New booking 08:00-16:00 · No venue given", "a booking with no venue");
eq(cardNote({ decision: handoff(['request 1 crew: "another 3 crew" reads as null, not 3']), grounded: g([{ action: "new_shift", problems: [] }]) as any, executed: null, written: false }),
  'New booking · Check the crew count: "another 3 crew"', "a count the code could not read quotes the client, not the code");
eq(cardNote({ decision: handoff(["R40101: 2 shifts on 2026-10-21 could be the one meant"]), grounded: g([{ action: "change_times", start: "10:00", target: { quote: "Wednesday", date: "2026-10-21" }, problems: [] }], "change") as any, executed: null, written: false }),
  "Start to 10:00 · 2 shifts that day, pick one", "a change with two shifts that day");
eq(cardNote({ decision: handoff(["the client asked for a quote"], true), grounded: g([{ action: "new_shift", start: "07:00", problems: [] }], "quote_request") as any, executed: null, written: false }),
  "Quote request from 07:00 · Price it and send the quote", "a quote");
eq(cardNote({ decision: handoff(["sent with a later email (1a11afc6bff4c2f4); the system read only the later one"]), grounded: null, executed: null, written: false }),
  "Read the email", "a message id never reaches the screen");
const write = { kind: "write" as const, ops: [{ source: "s", op: { kind: "set_position_times", order_id: 1, slot_id: 2, date: "2026-10-11", start: "17:00", end: "23:00" } as any }], why: ["R11224 shift 41611: times to 17:00-23:00"] };
eq(cardNote({ decision: write, grounded: null, executed: [{ status: "verified" } as any], written: true }), "Times now 17:00-23:00", "a write that ran");
eq(cardNote({ decision: write, grounded: null, executed: null, written: false }), "Times now 17:00-23:00 · Not written, do it by hand", "a write that did not run");
const two = { ...write, ops: [...write.ops, write.ops[0]] };
eq(cardNote({ decision: two, grounded: null, executed: [{ status: "verified" } as any, { status: "failed", reasons: ["x"] } as any], written: false }),
  "Times now 17:00-23:00 · System stopped partway, check OnSinch", "a write that stopped partway says so");
eq(cardNote({ decision: { kind: "write", ops: [{ source: "s", op: { kind: "add_position", order_id: 1, shift_id: 2, date: "2026-10-12", start: "17:45", end: "21:45", position: { size: 1, profession_id: "3" } } as any }], why: [] }, grounded: null, executed: [{ status: "verified" } as any], written: true }),
  "1 Carpenter added", "a profession added names the profession");

console.log("\n[3] an unknown reason is never shown as text");
ok(checkOf("a reason added to the planner next month (shift 99999)") === "Read the email", "falls back to Read the email");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
