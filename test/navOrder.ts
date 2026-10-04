// ============================================================================
// The rail's order is a stored list of ids applied to the tools the app has.
// ----------------------------------------------------------------------------
// Saving the rows themselves works until the app changes: a tool added after someone
// drags never appears for them, and a withdrawn one keeps rendering. Both are silent,
// because a rail built from stale storage looks like a rail.
//
// NEGATIVE CONTROLS (each applied to app/lib/navOrder.ts, run, confirmed red, reverted):
//   - the trailing `for` loop in applyOrder deleted      : [1] "a tool added later" failed
//   - reorder's `from < to ? 1 : 0` hard-coded to 0      : [2] "dragging down" failed
// Run: npx tsx test/navOrder.ts
// ============================================================================
import { applyOrder, reorder } from "../app/lib/navOrder";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).join(",");
const rows = (...xs: string[]) => xs.map((id) => ({ id }));

console.log("\n[1] applyOrder");
{
  ok(ids(applyOrder(rows("live", "dashboard", "jobs"), [])) === "live,dashboard,jobs", "nothing stored: the default order");
  ok(ids(applyOrder(rows("live", "dashboard", "jobs"), ["jobs", "live", "dashboard"])) === "jobs,live,dashboard", "a stored order is applied");
  ok(ids(applyOrder(rows("live", "dashboard"), ["gone", "dashboard", "live"])) === "dashboard,live", "a tool that no longer exists is dropped");
  const got = ids(applyOrder(rows("live", "dashboard", "jobs", "new"), ["jobs", "dashboard"]));
  ok(got === "jobs,dashboard,live,new", "a tool added later still appears, in its default place", got);
}

console.log("\n[2] reorder");
{
  const got = reorder(["a", "b", "c", "d"], "a", "c").join(",");
  ok(got === "b,c,a,d", "dragging down lands after the target", got);
  ok(reorder(["a", "b", "c", "d"], "d", "b").join(",") === "a,d,b,c", "dragging up lands before the target");
  ok(reorder(["a", "b"], "a", "a").join(",") === "a,b", "dropping on itself changes nothing");
  ok(reorder(["a", "b"], "x", "a").join(",") === "a,b", "an unknown id changes nothing");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
