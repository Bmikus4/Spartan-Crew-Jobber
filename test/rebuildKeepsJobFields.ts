// ============================================================================
// A rebuild keeps the job's supervisor and refuses to drop the job's admin note.
// ----------------------------------------------------------------------------
// Both live on `Job`, not the order, and carryForward read top-level fields only, so a
// delete-and-repost dropped them without a word while its comment said they were "set
// through" the job. OnSinch support (2026-10-05) named `admin_note` as the job's note
// field, which is what showed the gap.
//
// Offline.  npx tsx test/rebuildKeepsJobFields.ts
// ============================================================================
import { carryForward } from "../app/lib/engine/replaceOrder";
import { buildOrderBody } from "../app/lib/engine/format";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const desired = {
  name: "RedBeast @ Savoy Place", job_name: "Stand build", company_id: 512, user_id: 9, pricelist_category_id: 342,
  slot_teams: [{ name: "Crew", profession_id: 3, beginning: "2026-03-09T08:00:00+00:00", end: "2026-03-09T18:00:00+00:00", size: 4, place_id: 49 }],
} as unknown as DesiredOrder;

console.log("\n[1] the job's supervisor survives the rebuild");
{
  const { desired: out, carried, unsupported } = carryForward({ Job: [{ id: 7, supervisor_id: 413 }] }, desired);
  ok(out.supervisor_id === 413, "the live supervisor is carried", String(out.supervisor_id));
  ok(carried.includes("supervisor_id"), "and reported as carried");
  ok(buildOrderBody(out)[0].Job.supervisor_id === 413, "and reaches the POST body's Job");
  ok(unsupported.length === 0, "nothing stops the rebuild");
}
{
  const { desired: out } = carryForward({ Job: [{ id: 7, supervisor_id: 413 }] }, { ...desired, supervisor_id: 2257 } as DesiredOrder);
  ok(out.supervisor_id === 413, "a person's supervisor outranks the engine's default", String(out.supervisor_id));
}
{
  const { desired: out, carried } = carryForward({ Job: [{ id: 7, supervisor_id: null }] }, desired);
  ok(out.supervisor_id === undefined && !carried.includes("supervisor_id"), "no supervisor on the job, nothing carried");
}

console.log("\n[2] a hand-written job note stops the rebuild rather than vanishing");
{
  const { unsupported } = carryForward({ Job: [{ id: 7, admin_note: "Gate code 4411, ask for Dave" }] }, desired);
  ok(unsupported.includes("a job admin note"), "the note is named as what a rebuild cannot keep", unsupported.join(", "));
  ok(carryForward({ Job: { id: 7, admin_note: "single object form" } }, desired).unsupported.includes("a job admin note"), "Job as one object, not an array, is read too");
  ok(carryForward({ Job: [{ id: 7, admin_note: "   " }] }, desired).unsupported.length === 0, "a blank note is not a note");
  ok(carryForward({ Job: [{ id: 7 }] }, desired).unsupported.length === 0, "no note, no refusal");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exitCode = fails ? 1 : 0;
