// ============================================================================
// The bot's browser-free parts: London time, idempotency keys, builder field mapping,
// the NewOrder variables check, form contracts and the submission guard.
//
// Offline.  npx tsx test/v2BotPure.ts
// ============================================================================
import { londonToUtc, shiftWindow, opKey, builderEdit, checkNewOrder, shiftCreateFields, positionCreateFields, rowsFor, type Op } from "../app/lib/v2/bot/ops";
import { checkContract, parseBody, unexpectedChanges, asMap, canonical, type Contract } from "../app/lib/v2/bot/contract";
import { mismatches, liveFormValues } from "../app/lib/v2/bot/run";
import { saveUrl, cancelUrl } from "../app/lib/v2/bot/builder";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const BOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "lib", "v2", "bot");

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

console.log("London time");
ok(londonToUtc("2027-12-01", "08:00") === "2027-12-01T08:00:00.000Z", "winter: London 08:00 is 08:00Z");
ok(londonToUtc("2026-07-01", "08:00") === "2026-07-01T07:00:00.000Z", "summer: London 08:00 is 07:00Z");
ok(throws(() => londonToUtc("2026-10-25", "01:30")), "fall-back 01:30 happens twice: refused");
ok(londonToUtc("2026-10-25", "02:30") === "2026-10-25T02:30:00.000Z", "fall-back day, after the change: GMT");
ok(throws(() => londonToUtc("2026-03-29", "01:30")), "spring-forward 01:30 does not exist: refused");
const w = shiftWindow("2026-10-10", "22:00", "02:00");
ok(w.beginning === "2026-10-10T21:00:00.000Z" && w.end === "2026-10-11T01:00:00.000Z", "a shift past midnight ends the next day", JSON.stringify(w));

console.log("keys");
const a: Op = { kind: "set_position_size", order_id: 1, slot_id: 2, size: 3 };
ok(opKey("m1", a) === opKey("m1", { slot_id: 2, size: 3, kind: "set_position_size", order_id: 1 }), "key ignores property order");
ok(opKey("m1", a) !== opKey("m2", a), "same op from another message is another key");
ok(opKey("m1", a) !== opKey("m1", { ...a, size: 4 }), "different content is another key");

console.log("builder mapping");
ok(JSON.stringify(builderEdit(a).set) === JSON.stringify({ "data[Slot][size]": "3" }), "size -> data[Slot][size]");
ok(throws(() => builderEdit({ ...a, size: 0 })), "size 0 refused");
const t = builderEdit({ kind: "set_position_times", order_id: 1, slot_id: 2, date: "2027-12-01", start: "22:00", end: "02:00" }).set;
ok(t["data[Slot][beginning][date]"] === "01.12.2027" && t["data[Slot][end][date]"] === "02.12.2027" && t["data[Slot][end][time]"] === "2:00", "overnight times write the next day's end date", JSON.stringify(t));
ok(throws(() => builderEdit({ kind: "set_po", order_id: 1, po: "Legal Geek" })), "a PO with no digit is refused (Legal Geek)");

console.log("NewOrder check");
const op: Extract<Op, { kind: "create_order" }> = { kind: "create_order", company_id: "515", company_name: "TEST - Eventz", client_email: "accounts@spartancrew.co.uk", job_name: "x", shifts: [{ name: "s", date: "2027-12-01", start: "08:00", end: "12:00", place_id: "5", place_label: "Spartan Crew", positions: [{ size: 2, profession_id: "1" }] }] };
const pos = { lockstatus: true, hidden: true, concept: true, beginning: "2027-12-01T08:00:00.000Z", end: "2027-12-01T12:00:00.000Z", size: 2, role: "WORKER", professionId: "1", location: { placeId: "5" } };
const vars = (p: object, extra: object = {}) => ({ input: { internName: "", companyId: "515", userId: "1591", quote: false, provisional: false, jobs: [{ shifts: [{ positions: [{ ...pos, ...p }] }] }], ...extra } });
ok(checkNewOrder(vars({}), op, "1591").length === 0, "the benched R11463 mutation passes", checkNewOrder(vars({}), op, "1591").join("; "));
ok(checkNewOrder(vars({ beginning: "2027-12-01T07:00:00.000Z" }), op, "1591").length === 1, "an hour off is caught");
ok(checkNewOrder(vars({ size: 3 }), op, "1591").length === 1, "a wrong crew size is caught");
ok(checkNewOrder(vars({}, { companyId: "137" }), op, "1591").length === 1, "a wrong company is caught");
ok(checkNewOrder(vars({ hidden: false }), op, "1591").length === 1, "a published position is caught");
ok(checkNewOrder(vars({ location: { placeId: "6922" } }), op, "1591").length === 1, "a wrong venue is caught");
ok(checkNewOrder(vars({}, { userId: "777" }), op, "1591").length === 1, "a wrong client contact is caught");
const ccOp = { ...op, shifts: [{ ...op.shifts[0], positions: [{ size: 1, profession_id: "36", role: "crew_chief" as const }, { size: 2, profession_id: "1" }] }] };
const ccVars = (chief: object) => ({ input: { internName: "", companyId: "515", userId: "1591", quote: false, provisional: false, jobs: [{ shifts: [{ positions: [{ ...pos }, { ...pos, size: 1, professionId: "36", role: "CREWBOSS", ...chief }] }] }] } });
ok(checkNewOrder(ccVars({}), ccOp, "1591").length === 0, "crew chief + crew passes in either row order", checkNewOrder(ccVars({}), ccOp, "1591").join("; "));
ok(checkNewOrder(ccVars({ role: "WORKER" }), ccOp, "1591").length === 1, "a crew chief sent as a staff member is caught");

console.log("contracts");
const c: Contract = {
  surface: "builder.Slot", benched_at: "2026-10-08", version: { appka: "3.2.137", scriptTag: "1790780529" },
  fields: [{ name: "data[Slot][size]", type: "text", required: true, hidden: false }, { name: "data[Slot][SlotRequirement][0][value]", type: "text", required: false, hidden: false }],
  fill: ["data[Slot][size]"], derived: [],
};
const same = { version: c.version, fields: [...c.fields, { name: "data[Slot][SlotRequirement][1][value]", type: "text", required: false, hidden: false }] };
ok(checkContract(c, same).tier === "ok", "an extra requirement row is not a form change");
ok(checkContract(c, { ...same, version: { ...c.version, appka: "3.2.138" } }).tier === "warn", "a version change alone warns");
ok(checkContract(c, { ...same, fields: [...same.fields, { name: "data[Slot][new_thing]", type: "text", required: false, hidden: true }] }).tier === "block", "a new field blocks");
ok(checkContract(c, { ...same, fields: [{ ...c.fields[0], required: false }, c.fields[1]] }).tier === "block", "a required flag change blocks");
ok(checkContract(c, { ...same, fields: [c.fields[1]] }).tier === "block", "a missing fill target blocks");

console.log("submission guard");
const ct = "multipart/form-data; boundary=----X";
const mp = (pairs: [string, string][]) => pairs.map(([k, v]) => `------X\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("") + "------X--\r\n";
const before: [string, string][] = [["data[Slot][id]", "59383"], ["data[Slot][size]", "2"], ["data[Slot][beginning][time]", "8:00"], ["data[_Token][key]", "abc"]];
const sentOk = parseBody(mp([["data[Slot][id]", "59383"], ["data[Slot][size]", "3"], ["data[Slot][beginning][time]", "8:00"], ["data[_Token][key]", "def"]]), ct);
ok(sentOk.length === 4 && sentOk[1][1] === "3", "multipart body parses", JSON.stringify(sentOk));
ok(unexpectedChanges(before, sentOk, { "data[Slot][size]": "3" }, []).length === 0, "only the intended field moved: allowed");
const sentBad = parseBody(mp([["data[Slot][id]", "59383"], ["data[Slot][size]", "3"], ["data[Slot][beginning][time]", "9:00"]]), ct);
ok(unexpectedChanges(before, sentBad, { "data[Slot][size]": "3" }, []).some((x) => x.includes("beginning")), "a time that moved unasked is caught");
ok(unexpectedChanges(before, sentOk, { "data[Slot][size]": "4" }, []).some((x) => x.startsWith("intended")), "a value that did not take is caught");
const respelled: [string, string][] = [["data[Slot][end][date]", "01.12.2027"], ["data[Slot][end][time]", "08:00"]];
ok(unexpectedChanges([["data[Slot][end][date]", "1.12.2027"], ["data[Slot][end][time]", "8:00"]], respelled, {}, []).length === 0, "a date or time re-spelled by the page is not a change");
ok(unexpectedChanges([["data[Slot][end][date]", "1.12.2027"]], [["data[Slot][end][date]", "2.12.2027"]], {}, []).length === 1, "a date that really moved is a change");

console.log("read-back");
// R11464 (#16515) as the API returned it after the wizard bench, 10-08.
const r11464 = { company_id: 515, intern_name: "BENCH-2001", Job: [{ SlotTeam: [
  { Slot: [{ id: 59385, beginning: "2027-12-03T22:00:00+00:00", end: "2027-12-04T02:00:00+00:00", size: 2, profession_id: 1, hidden: true }] },
  { Slot: [{ id: 59384, beginning: "2027-12-02T07:30:00+00:00", end: "2027-12-02T15:00:00+00:00", size: 3, profession_id: 1, hidden: true }] },
] }] };
const create: Extract<Op, { kind: "create_order" }> = { kind: "create_order", company_id: "515", company_name: "TEST - Eventz", client_email: "accounts@spartancrew.co.uk", job_name: "x", po: "BENCH-2001", shifts: [
  { name: "Install", date: "2027-12-02", start: "07:30", end: "15:00", place_id: "5", place_label: "Spartan Crew", positions: [{ size: 3, profession_id: "1" }] },
  { name: "Derig", date: "2027-12-03", start: "22:00", end: "02:00", place_id: "5", place_label: "Spartan Crew", positions: [{ size: 2, profession_id: "1" }] },
] };
ok(mismatches(create, r11464).length === 0, "the R11464 create reads back as asked (shift order does not matter)", mismatches(create, r11464).join("; "));
const short = JSON.parse(JSON.stringify(r11464)); short.Job[0].SlotTeam[1].Slot[0].size = 2;
ok(mismatches(create, short).some((x) => x.includes("x3")), "a crew short on read-back is a mismatch");
const shown = JSON.parse(JSON.stringify(r11464)); shown.Job[0].SlotTeam[0].Slot[0].hidden = false;
ok(mismatches(create, shown).some((x) => x.includes("visible")), "a published position on read-back is a mismatch");
ok(mismatches({ kind: "set_position_size", order_id: 1, slot_id: 59384, size: 3 }, r11464).length === 0, "an edit already true reads as nothing to do");

console.log("pre-submit values");
const live = liveFormValues("Slot", 59385, r11464);
const form = asMap([["data[Slot][beginning][date]", "3.12.2027"], ["data[Slot][beginning][time]", "22:00"], ["data[Slot][end][date]", "4.12.2027"], ["data[Slot][end][time]", "2:00"], ["data[Slot][size]", "2"]]);
ok(Object.entries(live).every(([k, v]) => form.get(k) === canonical(k, v)), "OnSinch's UTC values match the form's London wall clock", JSON.stringify(live));
const summer = liveFormValues("Slot", 1, { Job: [{ SlotTeam: [{ Slot: [{ id: 1, beginning: "2026-07-01T07:00:00+00:00", end: "2026-07-01T15:00:00+00:00", size: 1 }] }] }] });
ok(summer["data[Slot][beginning][time]"] === "08:00", "in summer 07:00Z is the form's 8:00", summer["data[Slot][beginning][time]"]);

console.log("adding shifts and positions");
const shiftOp = { kind: "add_shift" as const, order_id: 16517, location_id: 17256, name: "Extra day", date: "2027-12-09", start: "21:30", end: "01:30",
  positions: [{ size: 1, profession_id: "36", role: "crew_chief" as const }, { size: 2, profession_id: "1" }] };
const sf = shiftCreateFields(shiftOp, rowsFor(shiftOp.positions)![0]);
ok(sf["data[SlotTeam][profession_id]"] === "1" && sf["data[SlotTeam][size]"] === "2" && sf["data[SlotTeam][end][date]"] === "10.12.2027", "the new-shift form gets the plain Crew row and an overnight end date", JSON.stringify(sf));
const pf = positionCreateFields("2027-12-09", "21:30", "01:30", shiftOp.positions[0]);
ok(pf["data[Slot][role]"] === "1" && pf["data[Slot][profession_id]"] === "36" && pf["data[Slot][beginning][time]"] === "21:30", "the crew chief position is role 1, profession 36, with the shift's window", JSON.stringify(pf));
ok(rowsFor([{ size: 1, profession_id: "36", role: "crew_chief" }]) === null, "a shift with no plain Crew position is not benched");
// R11466's Derig after the add bench, 10-08: the cancelled row must not count.
const derig = { Job: [{ SlotTeam: [{ id: 42280, Slot: [
  { id: 59389, beginning: "2027-12-09T21:30:00+00:00", end: "2027-12-10T01:30:00+00:00", size: 3, profession_id: 1, role: 0, cancelled: true },
  { id: 59390, beginning: "2027-12-09T21:30:00+00:00", end: "2027-12-10T01:30:00+00:00", size: 1, profession_id: 36, role: 1 },
  { id: 59397, beginning: "2027-12-09T21:30:00+00:00", end: "2027-12-10T01:30:00+00:00", size: 2, profession_id: 1, role: 0 },
] }] }] };
ok(mismatches(shiftOp, derig).length === 0, "a shift already holding exactly these positions reads as done (no duplicate)");
ok(mismatches({ ...shiftOp, positions: [{ size: 3, profession_id: "1" }] }, derig).length === 1, "a shift with a different crew count is not the same shift");
ok(mismatches({ kind: "add_position", order_id: 1, shift_id: 42280, date: "2027-12-09", start: "21:30", end: "01:30", position: { size: 3, profession_id: "1" } }, derig).length === 1, "a cancelled position does not satisfy an add");

console.log("guard URL patterns");
// The URLs OnSinch's builder actually called on 10-08. If a pattern stops matching them,
// the in-flight guard stops running without a word: the first cancels went out that way.
const SAVE = "https://spartancrew.onsinch.com/admin/orders/builder/16514?model=Slot&ajax=save_node&tab=tab_1_1&path=Order:16514.Job:16577.SlotLocation:17253.SlotTeam:42275.Slot:59383";
const CANCEL = "https://spartancrew.onsinch.com/admin/orders/builder/16517?ajax=cancel";
ok(saveUrl(16514, "Slot").test(SAVE), "the save pattern matches the real save URL");
ok(!saveUrl(16514, "Order").test(SAVE) && !saveUrl(1651, "Slot").test(SAVE), "and not another model's or order's");
ok(cancelUrl(16517).test(CANCEL), "the cancel pattern matches the real cancel URL");
ok(!cancelUrl(1651).test(CANCEL) && !cancelUrl(16517).test("https://spartancrew.onsinch.com/admin/orders/builder/165170ajax=cancel"), "and not a near miss");

console.log("template-string escapes");
// Inside a template string "\?" or "\s" silently becomes "?" or "s". A RegExp built from
// one must double every backslash; a single one is the bug, every time it has appeared.
// A control character in source (a "\b" that became a backspace on its way into a file)
// makes a regex silently match nothing; it happened once on 10-08 and is checked for too.
const V2 = join(BOT, "..");
for (const dir of readdirSync(V2)) {
  for (const f of readdirSync(join(V2, dir)).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(V2, dir, f), "utf8");
    const bad = [...src.matchAll(/new RegExp\(`([^`]*)`/g)].map((m) => m[1]).filter((body) => /(^|[^\\])\\[^\\$]/.test(body));
    ok(bad.length === 0, `${dir}/${f}: no single-backslash escape in a template RegExp`, bad.join(" | "));
    ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(src), `${dir}/${f}: no control characters`);
  }
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
