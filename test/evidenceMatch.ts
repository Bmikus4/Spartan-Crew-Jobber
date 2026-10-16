// Which order a request is already in: the day plus one more fact, never the day alone
// (Ben, 10-15). Cases from the 13 open needs on the TV, 10-16.
//
// Offline.  npx tsx test/evidenceMatch.ts
import { evidenceMatch, wantOf } from "../app/lib/v2/evidence";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

// London time in October is UTC+1.
const slot = (day: string, startUtc: string, endUtc: string, size: number, place = 7060) => ({ beginning: `${day}T${startUtc}:00+00:00`, end: `${day}T${endUtc}:00+00:00`, size, SlotLocation: { place_id: place } });
const order = (id: number, number: string, creator: number, slots: any[]) => ({ id, number, creator, status: 0, Job: [{ SlotTeam: [{ Slot: slots }] }] });

// Bearded Kitten 10-14: the bot's create failed; staff keyed R11545 with both days.
const R11545 = order(16601, "11545", 110, [slot("2026-10-22", "07:30", "11:30", 2), slot("2026-10-22", "07:30", "11:30", 1), slot("2026-10-23", "12:30", "18:30", 2)]);
const other = order(16590, "11530", 110, [slot("2026-10-22", "17:00", "21:00", 3, 999)]);
const want = wantOf([{ date: "2026-10-22", start: "08:30", crew: 3 }, { date: "2026-10-23", start: "13:30", crew: 2 }]);
const hit = evidenceMatch(want, [R11545, other], { staffOnly: true });
ok(hit !== null && hit !== "ambiguous" && hit.order.number === "11545" && hit.evidence.includes("start time"), "staff's order on the day with the same start is found", hit);

const dayOnly = evidenceMatch(wantOf([{ date: "2026-10-22", start: "06:00", crew: 9 }]), [other], { staffOnly: true });
ok(dayOnly === null, "the same day and nothing else in common is no match (never the date alone)", dayOnly);

const bot = evidenceMatch(want, [{ ...R11545, creator: 2257 }], { staffOnly: true });
ok(bot === null, "staffOnly: the bot's own order is not 'staff got there first'");

const twin = evidenceMatch(want, [R11545, { ...R11545, id: 16602, number: "11546" }], { staffOnly: true });
ok(twin === "ambiguous", "two orders equally like it are no answer");

const named = evidenceMatch({ ...wantOf([]), r_numbers: ["11530"] }, [R11545, other]);
ok(named !== null && named !== "ambiguous" && named.order.number === "11530", "a written R number names its order outright");

const cancelled = evidenceMatch(want, [{ ...R11545, status: -1 }], { staffOnly: true });
ok(cancelled === null, "a cancelled order is not where the booking is");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
