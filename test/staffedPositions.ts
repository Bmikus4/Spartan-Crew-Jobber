// Staffed positions (Ben, 10-15: every change is made, staffed positions included). The bot
// waits only on a cut below the workers on a position, and only workers count, never offers.
//
// Offline.  npx tsx test/staffedPositions.ts
import { staffedRefusal, ON_POSITION } from "../app/lib/v2/bot/run";
import type { Op } from "../app/lib/v2/bot/ops";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const times: Op = { kind: "set_position_times", order_id: 1, slot_id: 9, date: "2026-11-02", start: "08:00", end: "16:00" };
const size = (n: number): Op => ({ kind: "set_position_size", order_id: 1, slot_id: 9, size: n });
const cancel: Op = { kind: "cancel_position", order_id: 1, slot_id: 9 };

ok(staffedRefusal(times, 3).length === 0, "a time change on a position with 3 workers is made (10 of the 13 refusals 10-12..10-15)");
ok(staffedRefusal(size(4), 3).length === 0 && staffedRefusal(size(3), 3).length === 0, "a cut that leaves a seat for every worker is made");
ok(staffedRefusal(size(2), 3).length === 1, "a cut below the workers waits until the bot can drop one");
ok(staffedRefusal(cancel, 1).length === 1 && staffedRefusal(cancel, 0).length === 0, "a cancel waits only while a worker is on the position");
ok(!ON_POSITION.has(2) && [0, 1, 3].every((s) => ON_POSITION.has(s)), "an offer (status 2) is not a worker; assigned, confirmed and the unexplained 1 are");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
