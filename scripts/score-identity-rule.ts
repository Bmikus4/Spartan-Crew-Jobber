// ============================================================================
// SCORE THE SHIPPED MATCHER AGAINST EVERY LIVE BINDING.
// ----------------------------------------------------------------------------
// This drives `matchExistingOrder` ITSELF rather than a re-implementation of it. The
// previous version of this script was a lookalike, which means it could agree with the
// rule in the plan while the code disagreed with both — the measurement has to be of the
// thing that ships or it is not a measurement.
//
// It cannot prove a binding is RIGHT. What it can say is which of the bindings the live
// system already holds the rule would now reach, which it would refuse, and which it
// would move — and a move is the interesting one, because every move is either a bug
// being fixed or a bug being introduced and there is no third kind.
//
// THE SPLIT IS THE POINT (Ben, 2026-09-14). Threads naming an R number are the easy 17%
// and will shrink as the engine takes more threads from first contact. A blended
// accuracy figure flatters the rule by exactly that proportion, so the two populations
// are scored separately and the sub-1% bar applies to the one without a number.
//
// Read-only. No writes.
//   npx tsx scripts/score-identity-rule.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { matchExistingOrder, rNumbersIn, type OrderRec } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const base = (process.env.ONSINCH_BASE_URL || "").replace(/\/$/, "");
const key = (process.env.ONSINCH_API_KEY || "").trim();
const get = async (p: string): Promise<any> => {
  const r = await fetch(base + p, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  return r.ok ? r.json() : null;
};

type Bucket = { agree: number; moved: number; refused: number; nomatch: number; gone: number };
const bucket = (): Bucket => ({ agree: 0, moved: 0, refused: 0, nomatch: 0, gone: 0 });
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0.0") + "%";

(async () => {
  // Places once. 68 pages; pulling them per thread would be 9,588 requests for the same
  // answer and the whole-list pull is what the engine itself does.
  const places: PlaceCandidate[] = [];
  for (let p = 1; p <= 80; p++) {
    const rows = (await get(`/places?limit=200&page=${p}`))?.data ?? [];
    if (!rows.length) break;
    places.push(...(rows as PlaceCandidate[]));
  }
  console.log(`places: ${places.length}`);

  const rows = (await sql`select thread_id, state from conversation_state`) as Array<{ thread_id: string; state: any }>;
  const links = rows
    .map((r) => ({ t: r.thread_id, s: typeof r.state === "string" ? JSON.parse(r.state) : (r.state ?? {}) }))
    .filter((l) => Number.isInteger(Number(l.s.onsinch_order_id)) && Number(l.s.onsinch_order_id) > 0);
  console.log(`bindings in conversation_state: ${links.length}`);

  // One order-list pull per client, not per thread.
  const ordersOf = new Map<number, OrderRec[]>();
  const fetchOrders = async (company_id: number) => {
    if (ordersOf.has(company_id)) return ordersOf.get(company_id)!;
    const out: OrderRec[] = [];
    for (let p = 1; p <= 20; p++) {
      const rs = (await get(`/orders?company_id[eq]=${company_id}&with=Job&limit=200&page=${p}`))?.data ?? [];
      if (!rs.length) break;
      out.push(...(rs as OrderRec[]));
    }
    ordersOf.set(company_id, out);
    return out;
  };

  const withR = bucket();
  const withoutR = bucket();
  const successor = { found: 0, refused: 0, nothing: 0 };
  const foundLines: string[] = [];
  const moves: string[] = [];
  const refusals: string[] = [];

  for (const l of links) {
    const s = l.s;
    const company_id = Number(s.company_id);
    const held = Number(s.onsinch_order_id);
    if (!Number.isInteger(company_id) || company_id <= 0) continue;

    const orders = await fetchOrders(company_id);
    // A client whose whole order list comes back empty tells us nothing — the API
    // answers a bad filter with an empty list. Counted apart, never as a refusal.
    if (!orders.length) continue;

    const days = (s.facts?.requests ?? []).map((r: any) => r.date).filter(Boolean) as string[];
    const rns = rNumbersIn(String(s.subject ?? ""));
    const b = rns.length === 1 ? withR : withoutR;

    // The order the system actually holds. If staff have since deleted it there is
    // nothing to agree or disagree with.
    const heldOrder = orders.find((o) => Number(o.id) === held);
    if (!heldOrder) {
      // THE POPULATION THAT ACTUALLY RE-MATCHES IN PRODUCTION. The shipped code keeps a
      // binding whose order still exists and never re-derives it, so every other row in
      // this script is a what-if about a thread arriving fresh. These are not: staff have
      // deleted the order, the code releases the binding, and whatever the rule finds
      // here is what the thread goes on to amend.
      b.gone++;
      const r = matchExistingOrder(days.sort()[0], orders, {
        days,
        location_text: s.facts?.location_text,
        place_id: s.place_id ? Number(s.place_id) : null,
        places,
        r_numbers: rns,
      });
      if (!r) successor.nothing++;
      else if ("ambiguous" in r) successor.refused++;
      else {
        successor.found++;
        const to = orders.find((o) => Number(o.id) === r.order_id);
        foundLines.push(
          `   ${l.t.slice(0, 12)}  lost #${held} -> R${r.order_number} #${r.order_id} by ${r.by}\n` +
            `        becomes "${String(to?.name).slice(0, 64)}"\n` +
            `        thread  "${String(s.subject ?? "").slice(0, 64)}"`
        );
      }
      continue;
    }

    const m = matchExistingOrder(days.sort()[0], orders, {
      days,
      location_text: s.facts?.location_text,
      place_id: s.place_id ? Number(s.place_id) : null,
      places,
      r_numbers: rns,
    });

    const line = (verdict: string) =>
      `   ${l.t.slice(0, 12)}  holds R${heldOrder.number} #${held}  ${verdict}\n` +
      `        order  "${String(heldOrder.name).slice(0, 64)}"\n` +
      `        thread "${String(s.subject ?? "").slice(0, 64)}"`;

    if (!m) { b.nomatch++; continue; }
    if ("ambiguous" in m) { b.refused++; refusals.push(line(`-> REFUSES (${m.ambiguous} on ${m.day})`)); continue; }
    if (m.order_id === held) { b.agree++; continue; }
    b.moved++;
    const to = orders.find((o) => Number(o.id) === m.order_id);
    moves.push(line(`-> MOVES to R${m.order_number} #${m.order_id} by ${m.by}`) + `\n        target "${String(to?.name).slice(0, 64)}"`);
  }

  const show = (name: string, b: Bucket) => {
    const scored = b.agree + b.moved + b.refused + b.nomatch;
    console.log(
      `\n${name}  (${scored} scored, ${b.gone} whose order staff have since deleted)\n` +
        `   agrees with the live binding   ${b.agree}  ${pct(b.agree, scored)}\n` +
        `   MOVES it to another order      ${b.moved}  ${pct(b.moved, scored)}\n` +
        `   refuses as ambiguous           ${b.refused}  ${pct(b.refused, scored)}\n` +
        `   finds nothing on the day       ${b.nomatch}  ${pct(b.nomatch, scored)}`
    );
  };
  show("THREADS NAMING EXACTLY ONE R NUMBER — the easy 17%", withR);
  show("THREADS NAMING NONE — the population the bar applies to", withoutR);

  const sTot = successor.found + successor.refused + successor.nothing;
  console.log(
    `\nTHE ORDER WAS DELETED BY STAFF — the only rows the shipped code re-matches  (${sTot})\n` +
      `   finds a successor              ${successor.found}  ${pct(successor.found, sTot)}\n` +
      `   refuses as ambiguous           ${successor.refused}  ${pct(successor.refused, sTot)}\n` +
      `   finds nothing on the day       ${successor.nothing}  ${pct(successor.nothing, sTot)}`
  );
  console.log(`\n--- successors found (${foundLines.length}) ---`);
  console.log(foundLines.slice(0, 20).join("\n") || "   none");

  console.log(`\n--- every move (${moves.length}) — each is a bug fixed or a bug introduced ---`);
  console.log(moves.join("\n") || "   none");
  console.log(`\n--- refusals (${refusals.length}) — unbound, retried next sweep, never guessed ---`);
  console.log(refusals.slice(0, 25).join("\n") || "   none");
  if (refusals.length > 25) console.log(`   ... and ${refusals.length - 25} more`);
})();
