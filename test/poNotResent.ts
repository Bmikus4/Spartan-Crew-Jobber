// ============================================================================
// A PO goes to an existing order only when the client's email changed it.
// ----------------------------------------------------------------------------
// Every amendment used to send the thread's PO along with the crew change, so "can we
// add two crew" re-sent a PO stated weeks earlier over whatever staff had since typed
// into OnSinch. The sweep's version of the same thing replaced R11312's PO (typed by
// user 573) on 2026-10-03; test/sweepRespectsStaffEdits.ts pins that half.
//
// Offline.  npx tsx test/poNotResent.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { poOnlyIfChanged } from "../app/lib/engine/pipeline";
import type { DesiredOrder } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const order = (po?: string) => ({ company_id: 42, intern_name: po, specification: "x", slot_teams: [] }) as unknown as DesiredOrder;

console.log("\n[1] the thread already carried this PO: it is not re-sent");
ok(poOnlyIfChanged(order("SEQF 294239"), "SEQF 294239").intern_name === undefined, "same PO, dropped");
ok(poOnlyIfChanged(order(" seqf  294239 "), "SEQF 294239").intern_name === undefined, "case and spacing do not make it new");
ok(poOnlyIfChanged(order("SEQF 294239"), "SEQF 294239").specification === "x", "and nothing else on the write is touched");

console.log("\n[2] the client gave a new or changed PO in this email: it goes");
ok(poOnlyIfChanged(order("PO-NEW"), "PO-OLD").intern_name === "PO-NEW", "changed PO is sent");
ok(poOnlyIfChanged(order("PO-NEW"), undefined).intern_name === "PO-NEW", "first PO on the thread is sent");

console.log("\n[3] no PO on the write: unchanged");
ok(poOnlyIfChanged(order(undefined), "PO-OLD").intern_name === undefined, "nothing to send, nothing invented");

console.log("\n[4] every inbound patchOrder call goes through it");
{
  const src = readFileSync("app/lib/engine/pipeline.ts", "utf8");
  const calls = src.match(/executor\.patchOrder\(\{[^}]*\}\)/g) ?? [];
  ok(calls.length >= 2, "the amend and the patch-fallback calls are both found", String(calls.length));
  ok(calls.every((c) => c.includes("poOnlyIfChanged(")), "and each passes the PO through poOnlyIfChanged", JSON.stringify(calls));
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
