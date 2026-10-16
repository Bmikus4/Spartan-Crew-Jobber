// Times a client did not write (Ben, 10-15): 08:00 for no start; for no end the length 7 of
// the client's last 10 shifts share, most specific history first, else 4 hours.
//
// Offline.  npx tsx test/assume.ts
import { pastShifts, usualMinutes, fillTimes } from "../app/lib/v2/interpret/assume";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

// day n of November 2026, a shift at place p from London hh:00 for len hours (GMT in November).
const order = (n: number, p: number, hh: number, len: number, creator = 110) => ({
  creator, Job: [{ SlotTeam: [{ Slot: [{ beginning: `2026-11-${String(n).padStart(2, "0")}T${String(hh).padStart(2, "0")}:00:00+00:00`, end: new Date(Date.parse(`2026-11-${String(n).padStart(2, "0")}T${String(hh).padStart(2, "0")}:00:00+00:00`) + len * 3600e3).toISOString(), SlotLocation: { place_id: p } }] }] }],
});

const eightAtBDC = Array.from({ length: 10 }, (_, k) => order(k + 1, 29, 8, k < 8 ? 8 : 5));
const h = pastShifts(eightAtBDC);
ok(h.length === 10 && h[0].start === "08:00" && h[0].minutes === 480 && h[0].place_id === 29, "a past shift is its start, its length and its place", h[0]);
ok(usualMinutes(h, { place_id: 29, start: "08:00" })?.minutes === 480, "8 of 10 at the venue and start agree: 8 hours");

const split = Array.from({ length: 10 }, (_, k) => order(k + 1, 29, 8, k < 6 ? 8 : 5));
ok(usualMinutes(pastShifts(split), { place_id: 29, start: "08:00" }) === null, "6 of 10 is not enough: no usual length");

const nine = Array.from({ length: 9 }, (_, k) => order(k + 1, 29, 8, 8));
const others = Array.from({ length: 10 }, (_, k) => order(k + 11, 40, 18, 3));
const fallback = usualMinutes(pastShifts([...nine, ...others]), { place_id: 29, start: "08:00" });
ok(fallback?.minutes === 180 && /last 10 shifts were 3h$/.test(fallback.basis), "9 shifts at the venue are too few to decide: the client's last 10 overall decide, and the reason says so", fallback);
ok(usualMinutes(pastShifts(others), { place_id: 29 })?.minutes === 180, "no history at the venue: the client's last 10 shifts decide");

const bots = Array.from({ length: 10 }, (_, k) => order(k + 1, 29, 8, 8, 2257));
ok(pastShifts(bots).length === 0, "the bot's own orders are not history");

const f1 = fillTimes({ start: "08:00" }, h, { place_id: 29, place_name: "Business Design Centre" });
ok(f1.end === "16:00" && /8 of the client's last 10 shifts at Business Design Centre starting 08:00 were 8h/.test(f1.assumed[0]), "no end: the usual 8 hours, and why", f1);
const f2 = fillTimes({}, [], {});
ok(f2.start === "08:00" && f2.end === "12:00" && f2.assumed.length === 2, "nothing written and no history: 08:00 for 4 hours, both said", f2);
const f3 = fillTimes({ end: "17:00", duration: 300 }, [], {});
ok(f3.start === "12:00" && f3.end === "17:00" && f3.assumed.length === 0, "an end and a length give the start: nothing assumed", f3);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
