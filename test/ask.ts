// ============================================================================
// The canonical ask is a pure function of the stored reading, old rows included.
// ----------------------------------------------------------------------------
// v2_decisions has stored {extraction, grounded} since the rebuild, but the extraction's field set
// has grown (venue_id, company arrived later). The ask must come out the same shape from a reading
// recorded before those fields existed as from one recorded today, or the fold, the gold join and
// the labels all fork on age. Offline.  npx tsx test/ask.ts
// ============================================================================
import { canonicalAsk, ASK_VERSION } from "../app/lib/v2/ask";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

// A reading as stored LAST MONTH: no venue_id, no company, end derived from start+duration (no quote).
const oldRow = {
  extraction: {
    intent: "change" as const,
    po: { value: "PO-77", quote: "PO-77" },
    order: "R11000",
    requests: [{
      action: "change_times" as const,
      date: { value: "2026-10-03", quote: "Friday 3rd" }, start: { value: "08:00", quote: "8am start" },
      end: null, duration_minutes: { value: 240, quote: "4hr call" }, crew: null, crew_add: null,
      crew_remove: null, venue: null, crew_chief: null, trade: null, target: null,
    }],
    note: "",
  },
  grounded: {
    intent: "change" as const, po: "PO-77", order_id: 11000,
    requests: [{ action: "change_times" as const, date: "2026-10-03", start: "08:00", end: "12:00", duration: 240, problems: [] }],
    problems: [],
  },
};

// A reading as stored TODAY: the newer fields present, one request from history.
const newRow = {
  extraction: {
    intent: "booking" as const,
    po: null,
    company: { value: "Acme Events", quote: "Acme Events Ltd" },
    requests: [{
      action: "new_shift" as const,
      date: { value: "2026-11-10", quote: "Monday 10th" }, start: { value: "09:00", quote: "9am" },
      end: { value: "17:00", quote: "till 5pm" }, duration_minutes: null, crew: { value: 4, quote: "4 x crew" },
      crew_add: null, crew_remove: null, venue: null, venue_id: { value: 321, quote: "our warehouse" },
      crew_chief: null, trade: null, target: null,
    }],
    note: "",
  },
  grounded: {
    intent: "booking" as const, company_name: "Acme Events",
    requests: [{ action: "new_shift" as const, date: "2026-11-10", start: "09:00", end: "17:00", crew: 4, place_id: 321, history: true, problems: [] }],
    problems: [],
  },
};

console.log("\n[shape] a reading from last month and one from today compare field for field");
const a = canonicalAsk("m-old", oldRow as any)!;
const b = canonicalAsk("m-new", newRow as any)!;
const shape = (o: object) => Object.keys(o).sort().join(",");
ok(a.version === ASK_VERSION && b.version === ASK_VERSION, "both carry the schema version", [a.version, b.version]);
ok(shape({ ...a, po: 0, company: 0, order: 0, order_id: 0 }) === shape({ ...b, po: 0, company: 0, order: 0, order_id: 0 }),
  "the top-level field set is the same whatever the row's age", [shape(a), shape(b)]);
const vocab = ["date", "start", "end", "duration_minutes", "crew", "crew_add", "crew_remove", "venue", "crew_chief", "trade"];
ok(Object.keys(a.asks[0].values).every((k) => vocab.includes(k)) && Object.keys(b.asks[0].values).every((k) => vocab.includes(k)),
  "every value key is in the v1 vocabulary", [Object.keys(a.asks[0].values), Object.keys(b.asks[0].values)]);

console.log("\n[keys] the ask-pair key is the message and the reading's index");
ok(a.asks[0].key === "m-old:0" && b.asks[0].key === "m-new:0", "key is <message_id>:<idx>", [a.asks[0].key, b.asks[0].key]);

console.log("\n[tiers] every value carries its tier and its words");
ok(a.asks[0].values.date?.tier === "given" && a.asks[0].values.date?.proof === "Friday 3rd", "a value in the client's own words is given, with its quote", a.asks[0].values.date);
ok(b.asks[0].values.date?.tier === "read", "a request the grounding marked history is read", b.asks[0].values.date);
ok(a.asks[0].values.end?.value === "12:00" && a.asks[0].values.end?.proof === undefined, "a derived end has the value and no proof", a.asks[0].values.end);
ok(a.po?.value === "PO-77" && a.po?.proof === "PO-77", "the po carries its words", a.po);
ok(b.company?.value === "Acme Events" && b.company?.proof === "Acme Events Ltd", "the company carries its words", b.company);
ok(b.asks[0].place_id === 321, "a resolved venue id is kept on the ask", b.asks[0]);
ok(a.order === "R11000" && a.order_id === 11000, "the named booking and its id are kept", [a.order, a.order_id]);

console.log("\n[purity] the same stored row always gives the same ask");
ok(JSON.stringify(canonicalAsk("m-old", oldRow as any)) === JSON.stringify(a), "pure function of the row");
ok(canonicalAsk("m-x", null) === null && canonicalAsk("m-x", { extraction: null, grounded: null }) === null,
  "a row with no reading has no ask");
ok(canonicalAsk("m-y", { grounded: oldRow.grounded } as any)!.asks[0].values.date?.proof === undefined,
  "a row whose extraction is gone still canonicalises, without proofs");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exitCode = fails ? 1 : 0;
