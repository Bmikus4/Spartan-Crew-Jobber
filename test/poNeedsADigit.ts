// ============================================================================
// A reference with no digit in it is never written as the PO.
// ----------------------------------------------------------------------------
// 2026-10-06, order #13709: the subject "RE: PO - Legal Geek - 12/10/26" was read as
// customer_reference "Legal Geek", and the update replaced the real PO 4672 with it.
//
// Offline.  npx tsx test/poNeedsADigit.ts
// ============================================================================
import { executor } from "../app/lib/deps";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

(async () => {
  const sent: unknown[] = [];
  const client = new OnsinchClient(async (method, _path, body) => {
    if (method === "PATCH") sent.push(body);
    return { status: 204, data: null };
  });
  const ex = executor(client);
  const desired = (intern_name: string) => ({ name: "x", slot_teams: [], intern_name }) as unknown as DesiredOrder;

  console.log("\n[1] a name is not a PO");
  ok(((await ex.patchOrder({ order_id: 13709, desired: desired("Legal Geek") })) ?? []).length === 0, "nothing is reported as applied");
  ok(sent.length === 0, "and nothing is sent", JSON.stringify(sent));

  console.log("\n[2] a real PO still goes");
  const applied = (await ex.patchOrder({ order_id: 13709, desired: desired("PO-4673") })) ?? [];
  ok(applied.includes("intern_name"), "applied", JSON.stringify(applied));
  ok(JSON.stringify(sent).includes("PO-4673"), "and sent", JSON.stringify(sent));

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exitCode = fails ? 1 : 0;
})();
