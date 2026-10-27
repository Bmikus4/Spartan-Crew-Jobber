// ============================================================================
// The system's own failures are reported to the owner, not left only as cards for staff.
// ----------------------------------------------------------------------------
// Addendum F30: operational failures must never be visible to the team; alerts go to the
// owner. In the live week 10-14..10-21, 5 of the 81 listed cards were the system failing (two
// "could not plan" reads of OnSinch, three writes stopped part-way), and nobody was told.
// A linked order that cannot be read is a booking gone (reasons.ts:27), not a fault, and a
// policy or a client's missing detail is the client's need: neither is reported.
// npx tsx test/systemFailureToOwner.ts
// ============================================================================
import { systemFailureOf } from "../app/lib/v2/reasons";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const handoff = (reason: string) => ({ kind: "handoff", reasons: [reason] }) as any;
const write = { kind: "write", ops: [], why: [] } as any;

ok(!!systemFailureOf(handoff("the system could not plan this email (GET /orders answered 503, so what it holds is unknown)"), null), "a planner that could not read OnSinch is reported");
ok(!!systemFailureOf(handoff("this email was not decided when it arrived; the system is reading it again"), null), "an email the intake failed to decide is reported");
ok(!!systemFailureOf(write, [{ status: "verified" }, { status: "mismatch" }] as any), "a write that stopped part-way is reported");
ok(systemFailureOf(handoff("this thread is linked to order 16614, which the system could not read: no order is named"), null) === null, "a linked order that is gone is not a fault");
ok(systemFailureOf(handoff("2026-10-20 is within 7 days of the email: a person creates it"), null) === null, "a policy hand-off is the client's need, not a fault");
ok(systemFailureOf(write, [{ status: "verified" }, { status: "verified" }] as any) === null, "a write that landed is not reported");
ok(systemFailureOf(write, [{ status: "blocked" }] as any) === null, "a write refused before anything was sent is a rule, not a part-way failure");
// The shapes the live data holds (red-team-B H6, 10-26): the 3 crew-chief stops were one op each, status mismatch.
ok(!!systemFailureOf(write, [{ status: "mismatch", reasons: ["stopped part-way: #1 position 2/crew_chief: blocked"] }] as any), "a single op that stopped part-way (the live week's 3 crew-chief stops) is reported");
ok(!!systemFailureOf(write, [{ status: "blocked", reasons: ["bot error before submit: locator.waitFor: Timeout 30000ms exceeded."] }] as any), "the bot's own error on OnSinch's page is reported");
ok(!!systemFailureOf(write, [{ status: "blocked", reasons: ["form changed: protocol update needed"] }] as any), "a changed OnSinch form is reported");
ok(systemFailureOf(write, [{ status: "blocked", reasons: ["signed-on crew: 3 on position 9; ops must make this change"] }] as any) === null, "signed-on crew is a rule sending the change to ops, not a fault");
// red-team-B2 B2-8: two more blocked shapes the data holds are the system's own making.
ok(!!systemFailureOf(write, [{ status: "blocked", reasons: ['company: 2 options match /^Acme$/ for "Acme"'] }] as any), "several company options on OnSinch's page is the bot failing there");
ok(!!systemFailureOf(write, [{ status: "blocked", reasons: ["sam@client.example is not a contact of Client Ltd"] }] as any), "a plan naming a contact the company lacks is the system's own failure");
ok(systemFailureOf(write, [{ status: "blocked", reasons: ["4 workers on position 9, cut to 2: a worker must be dropped first"] }] as any) === null, "workers on a position is a rule, not a fault");

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
