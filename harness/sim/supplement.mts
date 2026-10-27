// ============================================================================
// The orders the snapshot's "newest 3000" left out but the data names: every order a link, a
// decision or the paused engine's state points at. Read-only, from production OnSinch.
// ----------------------------------------------------------------------------
// Measured 10-16: 129 of the 419 orders the data names were not in orders.json, Solotech's
// R11445 among them, so the replay saw a card's order that its OnSinch did not hold. Each is read
// by id; one OnSinch no longer has is recorded as gone (a deleted bot order, say), not guessed.
//
//   npx tsx --env-file=.env.local harness/sim/supplement.mts      (after snapshot.mts)
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { httpTransport } from "../../app/lib/onsinch/onsinch";
import { readPage } from "../../app/lib/v2/read";

const L = (n: string) => JSON.parse(readFileSync(`.tmp-data/sim/${n}.json`, "utf8"));
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" }) as any;
const orders = L("orders") as any[];
const have = new Set(orders.map((o) => Number(o.id)));
const named = new Set<number>();
for (const l of L("links")) if (Number(l.order_id) > 0) named.add(Number(l.order_id));
for (const d of L("decisions")) {
  for (const x of [].concat(d.decision?.ops ?? []) as any[]) if (x?.op?.order_id) named.add(Number(x.op.order_id));
  for (const e of (Array.isArray(d.executed) ? d.executed : []) as any[]) if (e?.detail?.order_id) named.add(Number(e.detail.order_id));
  for (const f of [].concat(d.decision?.found ?? []) as any[]) named.add(Number(f));
}
for (const s of L("states")) if (Number(s.onsinch_order_id) > 0) named.add(Number(s.onsinch_order_id));

const BOT = 2257, FROM = Date.parse(L("meta").from);
const gone: number[] = [];
let added = 0;
for (const id of [...named].filter((x) => !have.has(x))) {
  const r = await readPage(t, `/orders?id[eq]=${id}&with=Job__SlotTeam__Slot__SlotLocation&limit=1`).catch(() => ({ rows: [] as any[] }));
  const o = r.rows[0];
  if (!o) { gone.push(id); continue; }
  // As the snapshot does: the bot's own orders from the window are the replay's to make.
  if (Number(o.creator) === BOT && Date.parse(o.created) >= FROM) continue;
  orders.push(o); added++;
}
writeFileSync(".tmp-data/sim/orders.json", JSON.stringify(orders));
writeFileSync(".tmp-data/sim/orders_gone.json", JSON.stringify(gone));
console.log(`named ${named.size}, missing ${[...named].filter((x) => !have.has(x)).length}, added ${added}, gone from OnSinch ${gone.length}`);
