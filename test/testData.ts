// What counts as test data (lib/testData.ts), and what a clear may never touch.
import { isTestSender, isTestId, isTestCompanyName, orderVerdict, companyVerdict, maybeSweep, AUTOMATION_USER } from "../app/lib/testData";
import { coerceSettings } from "../app/lib/settingsDb";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

console.log("[1] test senders, ids and companies");
for (const a of ["benjamintmikus@gmail.com", "BenjaminTMikus@Gmail.com", "ben@samuraisolutions.co.uk", "sam@test-eventz.co.uk", "fine@example.com", "verify@verify.example", "x@foo.test", "x@bar.invalid"])
  ok(isTestSender(a), `${a} is a test sender`);
for (const a of ["jeff@samuraievents.co.uk", "accounts@samuraievents.co.uk", "chris@contest.com", "joe@testing.co.uk", "anna@examples.org", "bookings@spartancrew.co.uk", "", null])
  ok(!isTestSender(a), `${a} is not a test sender`);
for (const id of ["e2e-1-3", "bench-create-4", "vercel-bench-create-2", "spartan-pipeline-test-20260828a", "harness-x"]) ok(isTestId(id), `${id} is a synthetic id`);
// Gmail ids are hex, and hex holds "e2e" often: 1a10c2e2eeff6d32 is a real Blackout thread.
for (const id of ["1a10c2e2eeff6d32", "1a0441ad250f8712", "mail-123"]) ok(!isTestId(id), `${id} is a real id`);
for (const n of ["TEST - Eventz", "(TEST) Anders+Kern UK Ltd", "test", "ZZ PROBE DO NOT CREATE"]) ok(isTestCompanyName(n), `"${n}" is a test company`);
for (const n of ["MARIOTESTINOSTUDIO", "Testino Studio", "Contest Events", "Global Expos Ltd."]) ok(!isTestCompanyName(n), `"${n}" is not a test company`);

console.log("[2] an order goes only if the automation made it for a test");
const cos = new Set([515]);
const none = new Set<number>();
ok(orderVerdict({ id: 1, creator: AUTOMATION_USER, name: "BOT BENCH 1 - safe to delete", company_id: 515 }, cos, none)?.go === true, "a bench order on TEST - Eventz goes");
ok(orderVerdict({ id: 2, creator: 110, name: "Test @ Test HQ", company_id: 515 }, cos, none)?.go === false, "a staff member's test order on TEST - Eventz stays");
ok(orderVerdict({ id: 3, creator: AUTOMATION_USER, name: "Jamie TEST - Do not Delete - Sprinter", company_id: 515 }, cos, none)?.go === false, "anything named do not delete stays, whoever made it");
ok(orderVerdict({ id: 4, creator: AUTOMATION_USER, name: "EMS Events @ Mansion House", company_id: 128 }, cos, none) === null, "an automation order for a real client is not a test at all");
ok(orderVerdict({ id: 5, creator: AUTOMATION_USER, name: "Global Expos @ ExCeL", company_id: 831 }, cos, new Set([5]))?.go === true, "an automation order made for a test email goes, on any company");
ok(orderVerdict({ id: 6, creator: 413, name: "Studio XAG @ hq", company_id: 838 }, cos, new Set([6]))?.go === false, "a real order a test email reached stays");

console.log("[3] a company goes only if nothing real points at it");
const base = { name: "Global Expos Ltd.", clients: 0, orders: 0, testRefs: 1, realRefs: 0, testMentions: 1, realMentions: 0 };
ok(!!companyVerdict(base), "made for test emails only: goes");
ok(!companyVerdict({ ...base, clients: 1 }), "a company with a contact stays");
ok(!companyVerdict({ ...base, orders: 1 }), "a company with an order left stays");
ok(!companyVerdict({ ...base, realRefs: 1 }), "a company a real email points at stays");
ok(!companyVerdict({ ...base, testRefs: 0, testMentions: 0, realMentions: 1, name: "MLCCL" }), "named only in a real client's email: stays");
ok(!companyVerdict({ ...base, testRefs: 0, testMentions: 0 }), "pointed at by nothing: stays (not known to be a test)");
ok(!!companyVerdict({ ...base, name: "ZZ PROBE DO NOT CREATE", testRefs: 0, testMentions: 0 }), "a test name goes with nothing pointing at it");
ok(!!companyVerdict({ ...base, name: "Probe Co", email_invoice: "fine@example.com", testRefs: 0, testMentions: 0 }), "a test invoice address goes");

console.log("[4] the switch");
void (async () => {
  let touched = 0;
  const sql: any = new Proxy(() => {}, { apply: () => { touched++; return Promise.resolve([]); } });
  const t: any = async () => { touched++; return { status: 200, data: [] }; };
  ok((await maybeSweep(sql, t, false)) === "off" && touched === 0, "switched off, the sweep reads and removes nothing");
  const recent: any = Object.assign(() => Promise.resolve([{ at: new Date(Date.now() - 5 * 60e3).toISOString() }]), {});
  ok((await maybeSweep(recent, t, true)) === "not due", "switched on, a sweep 5 minutes after the last waits");
  ok(coerceSettings({ test_data_autoclear: true }).test_data_autoclear === true && coerceSettings({ test_data_autoclear: "yes" }).test_data_autoclear === undefined, "the switch saves, and only as a boolean");
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
