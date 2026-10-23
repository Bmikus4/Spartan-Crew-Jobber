// ============================================================================
// The job matcher's evidence (app/lib/match/match.ts) on a small world: what is gathered, what is
// never offered, and the level each family reads, including null when the facts are absent.
// Offline.  npx tsx test/matchEvidence.ts
// ============================================================================
import { corpus } from "../app/lib/match/ngram";
import { indexWorld, match, type MatchMsg } from "../app/lib/match/match";
import { factsOf, newestWords, daysIn } from "../app/lib/match/facts";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };

const slot = (id: number, b: string, e: string, size: number, place: number, cancelled = false) => ({ id, beginning: b, end: e, size, cancelled, SlotLocation: { place_id: place } });
const order = (id: number, number: string, company: number, user: number, created: string, name: string, slots: any[], extra: any = {}) =>
  ({ id, number, company_id: company, user_id: user, created, modified: created, status: 0, name, intern_name: extra.po ?? "", Job: [{ id: id + 4000, SlotTeam: [{ id, Slot: slots }] }] });
const companies = [
  { id: 10, name: "Acme Events", email_invoice: "accounts@acme.co.uk", Client: [{ id: 100, email: "jo@acme.co.uk" }, { id: 101, email: "ann@acme.co.uk" }] },
  { id: 20, name: "Other Ltd", Client: [{ id: 200, email: "bob@other.com" }] },
];
const places = [{ id: 1, name: "Christie's London", zip: "SW1Y 6QT" }, { id: 2, name: "Roundhouse", zip: "NW1 8EH" }];
const orders = [
  order(1000, "11001", 10, 100, "2026-10-01T09:00:00Z", "Acme Events - E15482 @ Christie's London", [slot(1, "2026-10-20T08:00:00Z", "2026-10-20T12:00:00Z", 4, 1)], { po: "E15482" }),
  order(1001, "11002", 10, 101, "2026-10-02T09:00:00Z", "Acme Events @ Roundhouse", [slot(2, "2026-10-20T17:00:00Z", "2026-10-20T21:00:00Z", 2, 2)]),
  order(1002, "11003", 10, 100, "2026-10-15T12:00:00Z", "Acme Events @ Somewhere", [slot(3, "2026-10-20T08:00:00Z", "2026-10-20T12:00:00Z", 6, 1)]),
  order(1003, "11004", 20, 200, "2026-10-01T09:00:00Z", "Other Ltd @ Christie's London", [slot(4, "2026-10-20T08:00:00Z", "2026-10-20T12:00:00Z", 4, 1)]),
  ...[0, 1, 2, 3].map((k) => order(1100 + k, `1120${k}`, 20, 200, "2026-09-01T09:00:00Z", `Other Ltd - SNWF2026 @ Hall ${k}`, [slot(10 + k, "2026-11-0" + (k + 1) + "T08:00:00Z", "2026-11-0" + (k + 1) + "T12:00:00Z", 2, 2)])),
];
const ix = indexWorld(companies, orders, places, corpus([...places.map((p) => p.name), ...orders.map((o) => o.name), ...companies.map((c) => c.name)]));
const msg = (over: Partial<MatchMsg>): MatchMsg => ({ id: "m1", at: Date.parse("2026-10-14T10:00:00Z"), from: "jo@acme.co.uk", to: ["bookings@spartancrew.co.uk"], subject: "Re: Christie's 20th", body: "Hi, can we make it 6 crew on the 20th at 09:00 please? PO E15482", ours: false, ...over });
const email = msg({});
const res = match({ email, thread_id: "t1", thread: [email], reading: { source: "model", intent: "change", asks: [{ action: "change_crew", date: "2026-10-20", start: "09:00", crew: 6, venue: "Christies" }], po: "E15482" }, link: null, precedents: [] }, ix);
const cand = (id: number) => res.candidates.find((c) => c.order_id === id);

console.log("\n[1] gathering");
ok(!!cand(1000) && !!cand(1001), "both of the sender's company's orders that day are offered");
ok(!cand(1002), "an order made after the email is never offered (L1)");
ok(!cand(1003), "another company's order is not offered when nothing points at it");
ok(res.companies.some((c) => c.id === 10 && c.route === "address"), "the company is reached by the sender's exact address", JSON.stringify(res.companies));
ok(!ix.byCode.has("2026"), "a year shared by many order names is not a code");

console.log("\n[2] the order the email is about");
const a = cand(1000)!.cmp;
ok(a.reference === "PO in the newest words", "reference", String(a.reference));
ok(a.person === "sender is the contact", "person", String(a.person));
ok(a.time === "day and start", "time: 09:00 London on the 20th", String(a.time));
ok(a.size === "crew within 2", "size: 6 asked against 4 booked", String(a.size));
ok(String(a.place).startsWith("venue name 0."), "place: Christies against Christie's London", String(a.place));
ok(a.company === "address" && a.state === "live", "company route and state", `${a.company} / ${a.state}`);

console.log("\n[3] the other order that day");
const b = cand(1001)!.cmp;
ok(b.reference === "none", "a reference is written, and it is not this order's", String(b.reference));
ok(b.person === "contact is a colleague", "person: the contact is at the sender's domain", String(b.person));
ok(b.time === "day, other time", "time: same day, 18:00 against 09:00", String(b.time));
ok(b.place === "different venue", "place", String(b.place));

console.log("\n[4] absent facts are null, not against");
const bare = msg({ id: "m2", subject: "Thanks", body: "Thank you, see you then." });
const r2 = match({ email: bare, thread_id: "t2", thread: [bare], reading: null, link: null, precedents: [] }, ix);
const c2 = r2.candidates.find((c) => c.order_id === 1000)!;
ok(c2.cmp.time === null && c2.cmp.place === null && c2.cmp.size === null && c2.cmp.reference === null, "no day, venue, crew or reference written: all null", JSON.stringify(c2.cmp));

console.log("\n[5] the code reader");
ok(!/wrote/.test(newestWords("New ask\n*On Tue, 21 Jul 2026 at 15:16, Bookings Spartan Crew <\nbookings@spartancrew.co.uk> wrote:*\n> old")), "a quote header broken over two lines is cut");
ok(JSON.stringify(daysIn("crew on 10th please", "2026-08-03T10:00:00Z")) === JSON.stringify(["2026-08-10"]), "a bare '10th' is a day", JSON.stringify(daysIn("crew on 10th please", "2026-08-03T10:00:00Z")));
ok(daysIn("build 11th-14th October", "2026-10-01T10:00:00Z").length === 4, "a range in one month gives each day", JSON.stringify(daysIn("build 11th-14th October", "2026-10-01T10:00:00Z")));
const f = factsOf("Re: PO", "PO number is UKPO26-13426 for R11549 at SW1X 7LA", "2026-10-14T10:00:00Z");
ok(f.r.includes("11549") && f.codes.includes("UKPO26-13426") && f.postcodes.includes("SW1X 7LA"), "R number, code and postcode read", JSON.stringify({ r: f.r, c: f.codes, p: f.postcodes }));
const html = newestWords(`<html><body><div dir="ltr">Can we add 2 crew?</div><div class="gmail_quote"><div>On Mon wrote: crew for R10950 on 12th</div></div></body></html>`);
ok(html === "Can we add 2 crew?", "an HTML body is cut at its quoted part (Harbour Scenic's quoted R10950)", JSON.stringify(html));
const s = factsOf("Re: Price quote - R10931", "Please book R10909 as well", "2026-09-10T10:00:00Z");
ok(s.r.join() === "10909" && s.subjectR.join() === "10931", "an R in the subject is kept apart from one in the words (Wall to Wall)", JSON.stringify({ r: s.r, subjectR: s.subjectR }));

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
