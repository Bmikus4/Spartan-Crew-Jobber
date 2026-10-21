// The API create body (apiCreate.ts): Orders To Confirm, every position hidden, the shift made
// with its plain crew, and the chief and professions left for the builder.
import { createBody, firstRow } from "../app/lib/v2/bot/apiCreate";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const shift = (positions: any[]) => ({ name: "Install", date: "2027-12-17", start: "07:00", end: "15:00", place_id: "5", place_label: "Spartan Crew", positions });
const op: any = { kind: "create_order", company_id: "515", company_name: "TEST", client_email: "a@b.c", job_name: "TEST @ Spartan Crew", po: "PO1", specification: "4 crew",
  shifts: [shift([{ size: 1, profession_id: "36", role: "crew_chief" }, { size: 3, profession_id: "1" }, { size: 1, profession_id: "3" }]), shift([{ size: 2, profession_id: "3" }])] };
const [b] = createBody(op, { user_id: "1591", card: 354 });
ok(b.request_approval === true, "approval is asked: the only lever that files an order in Orders To Confirm (measured 10-13)");
ok(b.user_id === 1591 && b.Job.pricelist_category_id === 354 && b.intern_name === "PO1" && b.specification === "4 crew", "contact, rate card, PO and description are all filled");
ok(b.SlotTeam.length === 2 && b.SlotTeam.every((t: any) => t.hidden === true), "one team per shift, every one hidden from workers");
ok(b.SlotTeam[0].profession_id === 1 && b.SlotTeam[0].size === 3, "a shift is made with its plain crew; the chief is added inside it afterwards", b.SlotTeam[0]);
ok(b.SlotTeam[1].profession_id === 3 && b.SlotTeam[1].size === 2, "a shift of carpenters alone is made with the carpenters", b.SlotTeam[1]);
ok(b.SlotTeam[0].beginning === "2027-12-17T07:00:00+00:00" || /2027-12-17T07:00/.test(b.SlotTeam[0].beginning), "times are London times", b.SlotTeam[0].beginning);
ok(firstRow(shift([{ size: 1, profession_id: "36", role: "crew_chief" }])) === null, "a chief alone has no position to make the shift with");
// Ben, 10-15: an assumed card is flagged. The API gives no client default (10-21), so every card is one.
const [f] = createBody(op, { user_id: "1591", card: 354, card_from: "the client's last order" });
ok(f.specification === "4 crew\nCHECK price list: card 354, from the client's last order; the client's default was not read" && f.Job.pricelist_category_id === 354, "the order says which price list was assumed and from where", f.specification);
const [h] = createBody({ ...op, specification: undefined }, { user_id: "1591", card: 355, card_from: "house card" });
ok(/^CHECK price list: card 355, from house card/.test(h.specification), "the house card is flagged too, even with no description", h.specification);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
