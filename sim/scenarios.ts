// ============================================================================
// The 100 bookings.
// ----------------------------------------------------------------------------
// STRATIFIED, not random. A hundred random enquiries would be a hundred draws
// from the middle of the distribution: single block, 4-8 crew, times stated,
// known venue. Every rule in this engine lives at a boundary — the band edges at
// 4/10/20, the day rate at exactly 8h, the merge key, the four hold conditions —
// and a boundary is not something a sample finds, it is something a design puts
// a case on either side of.
//
// So the cells are chosen: each group below fixes every factor but one and walks
// that one across its range, including both sides of each edge. Volume is spent
// on the places the answer can change, and the mundane middle gets the handful of
// cases it takes to show it still works.
//
// Venues are REAL rows from the live tenant, the traps included: 601 places share
// the name "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL"
// with every other field null, beside ONE row (id 49) that carries the address,
// the postcode and the alias. An enquiry naming that building is the case where
// ranking by match quality picks a shell and ranking by context picks the venue.
// ============================================================================
import type { SimCase } from "./types";

// -------------------------------------------------------------------- fixtures
/** id 49 — the row that knows the address. The 601 shells carry this exact text. */
export const EXCEL_SHELL_TEXT = "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL";
export const EXCEL_ID = 49;
/** id 2, alias "RAH" — the short form a client actually types. */
export const RAH_ALIAS = "RAH";
export const RAH_ID = 2;
/** id 7 / id 13 — rich rows, used where the venue is not what is being tested. */
export const O2 = "The O2, Peninsula Square, SE10 0DX";
export const SHARD = "The Shard, 32 London Bridge Street, SE1 9SG";
export const OLYMPIA = "Olympia London, Hammersmith Road, London W14 8UX";
/** Not in the tenant — must be provisioned on write. */
export const NEW_VENUE = "Thornbury Assembly Rooms, 14 Kestrel Way, Thornbury BS35 2QQ";
/** The Walthamstow failure: a street name with nothing to separate it from any other. */
export const NO_DISCRIMINATOR = "Westbridge Manor Hall, High Street";

const D1 = "2026-06-10";
const D2 = "2026-06-11";
const D3 = "2026-07-02";

const cases: SimCase[] = [];
const add = (c: SimCase) => { cases.push(c); return c; };

// ============================================================ A — chief bands
// The whole billing consequence of Q9(a) is here: the client's number is the
// number that turns up, and the chiefs come OUT of it. Both sides of 4, 10 and 20.
for (const size of [1, 2, 3, 4, 5, 9, 10, 11, 19, 20, 21, 40]) {
  add({
    id: `A-band-${size}`,
    label: `${size} crew, band edge`,
    tags: ["chief-band", `size-${size}`],
    client: "history",
    venue: O2,
    blocks: [{ size, date: D1, start: "08:00", end: "16:00", task: "Exhibition build" }],
  });
}

// ==================================================== B — profession resolution
// 37 of the tenant's 43 professions used to fall through to general crew. Each of
// these is a wording a client actually uses, including the two that must NOT
// resolve upward: an unrecognised specialism goes to Crew, never to a guess.
// The expected id is labelled off the tenant list, and a 6h shift keeps every plant
// row on its hourly half so this group tests naming alone (group C tests the rate).
const PROFS: Array<[string, number, string]> = [
  ["crew", 1, "plain crew"],
  ["carpenters", 3, "carpenter by name"],
  ["chippies", 3, "carpenter by slang"],
  ["drivers", 9, "driver, plural — the stored name carries it"],
  ["AV techs", 16, "AV -> Crew AV tech"],
  ["CSCS labourers", 32, "CSCS Labourer"],
  ["crew chief", 36, "chief by name"],
  ["gang boss", 36, "chief by 'boss' — must NOT reach Crew Boss 55"],
  ["crew lead", 36, "chief by 'lead'"],
  ["forklift drivers", 11, "forklift is the counterbalance, not a van driver"],
  ["counterbalance operators", 11, "counterbalance, hourly at 6h"],
  ["telehandler operators", 4, "telehandler U<9M, hourly at 6h"],
  ["rough terrain telehandler", 17, "rough terrain, not the U<9M default"],
  ["PASMA team", 6, "PASMA is a real profession (6), not general crew"],
  ["IPAF 3a/3b operators", 5, "IPAF 3a/3b is a real profession (5), not general crew"],
  ["riggers", 1, "no rigger row in the tenant — resolves down to Crew"],
];
for (const [prof, expect_profession, label] of PROFS) {
  add({
    id: `B-prof-${prof.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label,
    tags: ["profession", prof],
    client: "history",
    venue: SHARD,
    blocks: [{ size: 6, prof, date: D1, start: "09:00", end: "15:00", task: "Get-in", expect_profession }],
  });
}

// ================================================== C — day rate / hourly twins
// Q8: day rate at 8h or more, hourly below, and ONLY off a stated shift. The
// untimed case is the one that matters — the 08:00-18:00 default is ten hours, so
// reading it would move every untimed plant request onto a day rate nobody asked for.
// hourly / day-rate twins, labelled: 4 <-> 23 telehandler U<9M, 11 <-> 22 counterbalance.
for (const [prof, tag, hourly, day] of [
  ["telehandler operators", "telehandler", 4, 23],
  ["counterbalance operators", "counterbalance", 11, 22],
] as const) {
  add({ id: `C-${tag}-7h`, label: `${tag}, 7h stated — hourly`, tags: ["day-rate", tag, "below-8h"], client: "history", venue: O2,
        blocks: [{ size: 2, prof, date: D1, start: "08:00", end: "15:00", task: "Plant", expect_profession: hourly }] });
  add({ id: `C-${tag}-8h`, label: `${tag}, exactly 8h — day rate`, tags: ["day-rate", tag, "edge-8h"], client: "history", venue: O2,
        blocks: [{ size: 2, prof, date: D1, start: "08:00", end: "16:00", task: "Plant", expect_profession: day }] });
  add({ id: `C-${tag}-10h`, label: `${tag}, 10h stated — day rate`, tags: ["day-rate", tag, "above-8h"], client: "history", venue: O2,
        blocks: [{ size: 2, prof, date: D1, start: "07:00", end: "17:00", task: "Plant", expect_profession: day }] });
  // The 08:00-18:00 default is ten hours. Reading it would move every untimed plant
  // request onto a day rate on the strength of a default nobody stated.
  add({ id: `C-${tag}-untimed`, label: `${tag}, no times — must stay hourly`, tags: ["day-rate", tag, "unstated"], client: "history", venue: O2,
        blocks: [{ size: 2, prof, date: D1, task: "Plant", expect_profession: hourly }] });
}

// ============================================================== D — time windows
add({ id: "D-both", label: "both times stated", tags: ["times", "stated"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "07:30", end: "17:30", task: "Build" }] });
add({ id: "D-start-only", label: "start only — 18:00 default said out loud", tags: ["times", "default-end"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "07:30", task: "Build" }] });
add({ id: "D-end-only", label: "end only — 08:00 default", tags: ["times", "default-start"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, end: "17:30", task: "Build" }] });
add({ id: "D-neither", label: "no times — both defaults", tags: ["times", "default-both"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, task: "Build" }] });
add({ id: "D-half-hour", label: "0.5h — implausibly short, booked as asked", tags: ["times", "implausible-short"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "09:00", end: "09:30", task: "Quick unload" }] });
add({ id: "D-15h", label: "15h — needs an eye, no split applied", tags: ["times", "long-shift"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "06:00", end: "21:00", task: "Long day" }] });
add({ id: "D-equal", label: "start equals finish — read as 24h", tags: ["times", "equal"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "09:00", end: "09:00", task: "Repeated time" }] });
add({ id: "D-overnight", label: "22:00-06:00 overnight", tags: ["times", "overnight"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "22:00", end: "06:00", task: "Night derig" }] });
add({ id: "D-2h", label: "2h — the corpus mode, no call-out floor", tags: ["times", "short-no-floor"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "14:00", end: "16:00", task: "Turnaround" }] });
add({ id: "D-3h50", label: "3h50 — just under 4h, still booked as asked", tags: ["times", "short-no-floor"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "11:50", task: "Morning call" }] });

// ================================================================ E — dates / TBC
add({ id: "E-tbc", label: "no date — TBC carried in the name", tags: ["date", "tbc"], client: "history", venue: O2,
      blocks: [{ size: 6, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "E-two-dates", label: "two dates, same window", tags: ["date", "multi-day"], client: "history", venue: O2,
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" },
               { size: 6, date: D2, start: "08:00", end: "16:00", task: "Derig" }] });
add({ id: "E-same-date-two-windows", label: "one date, two windows", tags: ["date", "two-windows"], client: "history", venue: O2,
      blocks: [{ size: 4, date: D1, start: "08:00", end: "12:00", task: "Get-in" },
               { size: 4, date: D1, start: "14:00", end: "18:00", task: "Get-out" }] });
add({ id: "E-tbc-plus-stated", label: "one block TBC, one dated", tags: ["date", "tbc-mixed"], client: "history", venue: O2,
      blocks: [{ size: 4, date: D1, start: "08:00", end: "16:00", task: "Build" },
               { size: 4, start: "08:00", end: "16:00", task: "Derig, date to follow" }] });
add({ id: "E-two-tbc", label: "two TBC blocks — nothing separates them", tags: ["date", "tbc-collision"], client: "history", venue: O2,
      blocks: [{ size: 3, start: "08:00", end: "16:00", task: "First visit" },
               { size: 3, start: "08:00", end: "16:00", task: "Second visit" }] });
add({ id: "E-far-date", label: "a date months out", tags: ["date", "far"], client: "history", venue: O2,
      blocks: [{ size: 6, date: D3, start: "08:00", end: "16:00", task: "Build" }] });

// ================================================================== F — venues
add({ id: "F-rich-row", label: "a venue that knows its address", tags: ["venue", "rich"], client: "history", venue: SHARD,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "F-excel-shell-trap", label: "ExCeL — 601 shells against one real row", tags: ["venue", "shell-trap"], client: "history", venue: EXCEL_SHELL_TEXT,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "F-alias", label: "venue by its alias (RAH)", tags: ["venue", "alias"], client: "history", venue: RAH_ALIAS,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "F-unknown", label: "a venue not in OnSinch — provisioned on write", tags: ["venue", "provision"], client: "history", venue: NEW_VENUE,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "F-no-venue", label: "no venue named at all", tags: ["venue", "absent"], client: "history",
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "F-no-discriminator", label: "a street name with nothing to separate it", tags: ["venue", "no-discriminator"], client: "history", venue: NO_DISCRIMINATOR,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "F-per-block-two-venues", label: "crew moves between two venues", tags: ["venue", "per-block"], client: "history", venue: EXCEL_SHELL_TEXT,
      blocks: [{ size: 4, date: D1, start: "08:00", end: "12:00", task: "Get-in", venue: EXCEL_SHELL_TEXT },
               { size: 2, date: D1, start: "14:00", end: "18:00", task: "Second site", venue: OLYMPIA }] });
add({ id: "F-per-block-same-venue", label: "per-block venue equals the job venue", tags: ["venue", "per-block-noop"], client: "history", venue: O2,
      blocks: [{ size: 4, date: D1, start: "08:00", end: "12:00", task: "Get-in", venue: O2 }] });
add({ id: "F-per-block-unresolved", label: "a block names a venue that does not resolve", tags: ["venue", "per-block-unresolved"], client: "history", venue: O2,
      blocks: [{ size: 4, date: D1, start: "08:00", end: "12:00", task: "Get-in", venue: "the loading bay round the back" }] });
add({ id: "F-same-window-two-venues", label: "same window, two venues — never merged", tags: ["venue", "split-by-place"], client: "history", venue: O2,
      blocks: [{ size: 3, date: D1, start: "08:00", end: "16:00", task: "Site A", venue: O2 },
               { size: 3, date: D1, start: "08:00", end: "16:00", task: "Site B", venue: OLYMPIA }] });

// ================================================================= G — merging
add({ id: "G-merge-identical", label: "3 + 3 same window and place — one team of 6", tags: ["merge", "sum"], client: "history", venue: O2,
      blocks: [{ size: 3, date: D1, start: "14:00", end: "18:00", task: "Call 1" },
               { size: 3, date: D1, start: "14:00", end: "18:00", task: "Call 2" }] });
add({ id: "G-merge-three", label: "2 + 2 + 2 same window — one team of 6", tags: ["merge", "sum"], client: "history", venue: O2,
      blocks: [{ size: 2, date: D1, start: "14:00", end: "18:00", task: "A" },
               { size: 2, date: D1, start: "14:00", end: "18:00", task: "B" },
               { size: 2, date: D1, start: "14:00", end: "18:00", task: "C" }] });
add({ id: "G-no-merge-prof", label: "same window, two professions — two teams", tags: ["merge", "split-by-profession"], client: "history", venue: O2,
      blocks: [{ size: 4, prof: "carpenters", date: D1, start: "08:00", end: "16:00", task: "Carpentry" },
               { size: 4, date: D1, start: "08:00", end: "16:00", task: "General" }] });
add({ id: "G-merge-crosses-band", label: "2 + 2 merges to 4 and trips the band", tags: ["merge", "band-interaction"], client: "history", venue: O2,
      blocks: [{ size: 2, date: D1, start: "09:00", end: "17:00", task: "A" },
               { size: 2, date: D1, start: "09:00", end: "17:00", task: "B" }] });
add({ id: "G-client-chief-credit", label: "8 crew + 1 chief the client named", tags: ["merge", "chief-credit"], client: "history", venue: O2,
      blocks: [{ size: 8, date: D1, start: "08:00", end: "16:00", task: "Build" },
               { size: 1, prof: "crew chief", date: D1, start: "08:00", end: "16:00", task: "Chief" }] });
add({ id: "G-client-chief-exact", label: "3 crew + 1 chief — nothing to carve", tags: ["merge", "chief-credit"], client: "history", venue: O2,
      blocks: [{ size: 3, date: D1, start: "08:00", end: "16:00", task: "Build" },
               { size: 1, prof: "crew chief", date: D1, start: "08:00", end: "16:00", task: "Chief" }] });

// ======================================================= H — client / rate card
add({ id: "H-history", label: "known client, card from history — writes", tags: ["rate-card", "history"], client: "history", venue: O2,
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "H-no-history", label: "known client, no orders — assumed card BOOKS and flags", tags: ["rate-card", "assumed"], client: "nohistory", venue: O2,
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "H-new-company", label: "client not in OnSinch — provisioned, BOOKS and flags", tags: ["rate-card", "new-company"], client: "new", venue: O2,
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "H-new-company-new-venue", label: "new client AND new venue", tags: ["rate-card", "new-company", "venue"], client: "new", venue: NEW_VENUE,
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "H-history-large", label: "known client, 24 crew", tags: ["rate-card", "history", "chief-band"], client: "history", venue: O2,
      blocks: [{ size: 24, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "H-no-history-large", label: "assumed card on a big order", tags: ["rate-card", "assumed"], client: "nohistory", venue: O2,
      blocks: [{ size: 24, date: D1, start: "08:00", end: "16:00", task: "Build" }] });

// =============================================================== I — amendments
const AM_BASE = { size: 8, date: D1, start: "08:00", end: "16:00", task: "Build" } as const;
add({ id: "I-grow", label: "8 -> 12, applied silently", tags: ["amendment", "grow"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, size: 12 }] } });
add({ id: "I-shrink-mild", label: "8 -> 6, applied with a note", tags: ["amendment", "shrink"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, size: 6 }] } });
add({ id: "I-shrink-deep", label: "8 -> 2, more than half, applied loudly", tags: ["amendment", "shrink-deep"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, size: 2 }] } });
add({ id: "I-shrink-to-zero", label: "emptying the order HOLDS", tags: ["amendment", "empty"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, size: 0 }] } });
add({ id: "I-cancellation-flag", label: "the model flags a cancellation — never acted on", tags: ["amendment", "cancellation"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, size: 8 }], cancellation: true } });
add({ id: "I-po-only", label: "a PO follow-up must NOT delete the order", tags: ["amendment", "po-only"], client: "history", venue: O2, po: "PO-99123",
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE }] } });
add({ id: "I-confirmed-order", label: "shrinking a block CREW ARE ON — must refuse", tags: ["amendment", "confirmed"], client: "history", venue: O2, orderConfirmed: true,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, size: 4 }] } });
add({ id: "I-add-block", label: "an amendment adds a second window", tags: ["amendment", "add-block"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE }, { size: 4, date: D1, start: "18:00", end: "22:00", task: "Evening derig" }] } });
add({ id: "I-change-times", label: "an amendment moves the shift", tags: ["amendment", "times"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, start: "10:00", end: "18:00" }] } });
add({ id: "I-change-profession", label: "an amendment changes the role", tags: ["amendment", "profession"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE, prof: "carpenters" }] } });
add({ id: "I-confirm-only-followup", label: "a bare thanks after an order", tags: ["amendment", "confirmation-only"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE }], amend: { blocks: [{ ...AM_BASE }], classification: "confirmation-only" } });
add({ id: "I-shrink-across-band", label: "12 -> 9 crosses a band downward", tags: ["amendment", "shrink", "band-interaction"], client: "history", venue: O2,
      blocks: [{ ...AM_BASE, size: 12 }], amend: { blocks: [{ ...AM_BASE, size: 9 }] } });

// ============================================================= J — cross-thread
add({ id: "J-twin-duplicate", label: "a twin thread, same window and size", tags: ["cross-thread", "duplicate"], client: "history", venue: O2, twin: "duplicate",
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "J-twin-extension", label: "a twin thread, a different window", tags: ["cross-thread", "extension"], client: "history", venue: O2, twin: "extension",
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "J-no-twin", label: "control — no other thread", tags: ["cross-thread", "control"], client: "history", venue: O2,
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "J-twin-then-amend", label: "a held twin, then a second email", tags: ["cross-thread", "duplicate", "amendment"], client: "history", venue: O2, twin: "duplicate",
      blocks: [{ size: 6, date: D1, start: "08:00", end: "16:00", task: "Build" }], amend: { blocks: [{ size: 9, date: D1, start: "08:00", end: "16:00", task: "Build" }] } });

// ============================================================ K — shape / edges
const LONG_TASK =
  "Rig: unloading vans, shunting cases, assist lighting tech putting out lights, hanging mirror balls, working at heights";
add({ id: "K-long-name", label: "task text of 118 chars — the only live 400", tags: ["shape", "name-cap"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: LONG_TASK }] });
add({ id: "K-name-exactly-80", label: "task text of exactly 80 chars", tags: ["shape", "name-cap"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "x".repeat(80) }] });
add({ id: "K-name-81", label: "task text of 81 chars", tags: ["shape", "name-cap"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "y".repeat(81) }] });
add({ id: "K-no-size", label: "no number anywhere — no order composes", tags: ["shape", "no-size"], client: "history", venue: O2,
      blocks: [{ date: D1, start: "08:00", end: "16:00", task: "Some crew please" }] });
add({ id: "K-size-zero", label: "a stated size of zero", tags: ["shape", "no-size"], client: "history", venue: O2,
      blocks: [{ size: 0, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "K-size-200", label: "200 crew — 3 chiefs, not 50", tags: ["shape", "huge"], client: "history", venue: O2,
      blocks: [{ size: 200, date: D1, start: "08:00", end: "16:00", task: "Build" }] });
add({ id: "K-eight-blocks", label: "eight blocks across two days", tags: ["shape", "many-blocks"], client: "history", venue: O2,
      blocks: [
        { size: 4, date: D1, start: "06:00", end: "10:00", task: "B1" },
        { size: 4, date: D1, start: "10:00", end: "14:00", task: "B2" },
        { size: 4, date: D1, start: "14:00", end: "18:00", task: "B3" },
        { size: 4, date: D1, start: "18:00", end: "22:00", task: "B4" },
        { size: 12, date: D2, start: "06:00", end: "10:00", task: "B5" },
        { size: 3, date: D2, start: "10:00", end: "14:00", task: "B6" },
        { size: 20, date: D2, start: "14:00", end: "18:00", task: "B7" },
        { size: 1, date: D2, start: "18:00", end: "22:00", task: "B8" },
      ] });
add({ id: "K-punctuation", label: "punctuation and an ampersand in the task", tags: ["shape", "text"], client: "history", venue: O2,
      blocks: [{ size: 5, date: D1, start: "08:00", end: "16:00", task: "Get-in / de-rig & make good (Hall 4)" }] });
add({ id: "K-not-a-job", label: "an invoice chase — not a job", tags: ["shape", "not-a-job"], client: "history", classification: "not-a-job",
      blocks: [] });
add({ id: "K-confirmation-only", label: "a bare acknowledgement", tags: ["shape", "confirmation-only"], client: "history", classification: "confirmation-only",
      blocks: [] });

// ==================================================== L — how the client wrote the date
// THE LAYER THIS RIG COULD NOT SEE. Every case above renders its date from the same
// field the scripted extractor reports, so the two agreed by construction and the
// reconciliation layer — the code that decides whether to trust a model's year — was
// never reached. Measured before these existed: the next-occurrence roll fired on 0 of
// 100 runs, and the rule that put 26 crew a year early on live order 15611 had no
// coverage here at all.
//
// The rig clock is 2026-05-01, so "12 September" with no year means September 2026.
// These four cases set the client's words apart from the model's guess on purpose, and
// assert the DATE rather than the booking outcome, because a case where the engine
// correctly changes a date would otherwise read as a disagreement with the oracle.

add({ id: "L-year-bare-agrees", label: "bare date, model already right — roll agrees, changes nothing",
      tags: ["dates", "bare-year"], client: "history", venue: O2,
      blocks: [{ size: 4, date: "2026-09-12", textDate: "12 September", expectDate: "2026-09-12",
                 start: "08:00", end: "18:00", task: "Build" }] });

add({ id: "L-year-bare-corrects", label: "bare date, model guessed a year already gone — roll must correct it",
      tags: ["dates", "bare-year", "correction"], client: "history", venue: O2,
      blocks: [{ size: 4, date: "2025-09-12", textDate: "12th September", expectDate: "2026-09-12",
                 start: "08:00", end: "18:00", task: "Build" }] });

add({ id: "L-year-stated-twice", label: "the year is written once and the same date again bare — the stated year wins",
      tags: ["dates", "stated-year", "regression-15611"], client: "history", venue: O2,
      // Live shape, order 15611: a summary line carrying the year plus a load-in line
      // without it. The bare mention used to win and drag the booking back a year.
      blocks: [{ size: 4, date: "2027-10-12", textDate: "October 12, 2027, load-in from 07:00 on October 12th",
                 expectDate: "2027-10-12", start: "07:00", end: "18:00", task: "Build" }] });

add({ id: "L-comma-count", label: "a guest count after a comma is not a year",
      tags: ["dates", "comma-trap"], client: "history", venue: O2,
      blocks: [{ size: 4, date: "2026-09-12", textDate: "12 September, 1000 guests expected",
                 expectDate: "2026-09-12", start: "08:00", end: "18:00", task: "Build" }] });

export const SCENARIOS = cases;

if (SCENARIOS.length !== 104) {
  // A design that quietly drifts off its own cell count is a design nobody can cite.
  throw new Error(`scenario count is ${SCENARIOS.length}, not 104 — fix the design, not this check`);
}

const seen = new Set<string>();
for (const c of SCENARIOS) {
  if (seen.has(c.id)) throw new Error(`duplicate scenario id ${c.id}`);
  seen.add(c.id);
}
