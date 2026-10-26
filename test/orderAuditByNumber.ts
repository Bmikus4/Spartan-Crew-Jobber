// ============================================================================
// An Order's own audit rows name it by its NUMBER; only order_create names its id.
// ----------------------------------------------------------------------------
// scripts/ops-truth.mts read order_cancel, order_create_by_copy and edits of an Order as ids. The
// numbers and ids overlap, so 26 cancels and PO edits and a copy were filed under another order,
// and the rest were dropped (eval/item-correctness.md, 10-26). This pins the fact on the copy itself,
// so a script that reads these rows can be checked against what OnSinch actually writes.
// Offline; skips without the copy.  npx tsx test/orderAuditByNumber.ts
// ============================================================================
import { existsSync, readFileSync } from "node:fs";

const GOLD = ".tmp-data/gold";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

if (!existsSync(`${GOLD}/timeline.json`) || !existsSync(`${GOLD}/orders.json`)) { console.log("  SKIP  .tmp-data/gold is absent"); process.exit(0); }
const orders = JSON.parse(readFileSync(`${GOLD}/orders.json`, "utf8")) as any[];
const ids = new Set(orders.map((o) => Number(o.id))), nums = new Set(orders.map((o) => Number(o.number)));
const rows = (JSON.parse(readFileSync(`${GOLD}/timeline.json`, "utf8")) as any[]).map((r) => ({ ...r, d: typeof r.data === "string" ? JSON.parse(r.data) : r.data }));
const shape = (pick: (r: any) => boolean) => {
  let id = 0, num = 0;
  for (const r of rows.filter(pick)) { const v = Number(r.d?.id); if (ids.has(v) && !nums.has(v)) id++; if (nums.has(v) && !ids.has(v)) num++; }
  return { id, num };
};
const cancel = shape((r) => r.action === "order_cancel"), copy = shape((r) => r.action === "order_create_by_copy");
const edit = shape((r) => r.action === "common_change" && r.d?.model === "Order"), create = shape((r) => r.action === "order_create");
ok(cancel.num > 0 && cancel.id === 0, "order_cancel names the order by its number", cancel);
ok(copy.num > 0 && copy.id === 0, "order_create_by_copy names the new order by its number", copy);
ok(edit.num > 0 && edit.id === 0, "an edit of an Order names it by its number", edit);
ok(create.id > 0 && create.num === 0, "order_create names the order by its id", create);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
