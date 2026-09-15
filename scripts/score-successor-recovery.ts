// ============================================================================
// When staff delete an order the engine raised, does the engine find the job it became?
// ----------------------------------------------------------------------------
// Measured 2026-09-15: of the 133 threads where the engine CREATED an order, 105 no
// longer hold that order — staff deleted it. But the work did not vanish with it. For 67
// of those 105 there is another order, same client, same work day, alive in the tenant
// right now: somebody rebuilt the job by hand. That is the recovery target, and it is the
// first time this repo has had one. Everything the matcher does on a deleted order can
// now be scored against "a successor demonstrably exists" instead of against itself.
//
// WHAT THIS SCORES. `sweep.ts` is the only shipped path that re-matches a deleted order,
// so the numbers that matter are the ones produced with EXACTLY the arguments it passes.
// Three configurations run over the same threads:
//
//   as sweep.ts calls it   no `places`, R numbers from the SUBJECT only
//   + places               the tenant's place list, so venueVerdict can compare ids
//   + full-text R numbers  R numbers from every message body, as compiler.ts does
//
// The gap between the first and the last is recoverable accuracy that costs no new rule.
//
// THE DATE BASIS IS `happening`, NOT the Job span, and the two are not interchangeable:
// they agree on 5,845 of 5,871 orders that have a Job, but 1,166 orders have NO Job at
// all (a blockless create is filed nowhere — see deps.ts). Scoring on Job spans would
// make those orders invisible to the ground truth while the matcher can still see them,
// which reads as the matcher inventing successors.
//
// Read-only. No writes, no model calls.
//   npx tsx scripts/score-successor-recovery.ts
//   npx tsx scripts/score-successor-recovery.ts --list    # every thread, one line each
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { matchExistingOrder, rNumbersIn, type OrderRec } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const LIST = process.argv.includes("--list");
const base = requireEnv("ONSINCH_BASE_URL").replace(/\/$/, "");
const key = requireEnv("ONSINCH_API_KEY");
const get = async (p: string): Promise<any> => {
  const r = await fetch(base + p, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  return r.ok ? r.json() : null;
};
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0.0") + "%";

interface Row {
  thread_id: string;
  subject: string | null;
  onsinch_missing: boolean;
  messages: Array<{ subject?: string; body?: string }>;
  engine: {
    company_id: number | null;
    place_id: number | null;
    location_text: string | null;
    requests: Array<{ date?: string }>;
    onsinch_order_id: number | null;
    order_action_log: Array<{ kind?: string; ok?: boolean; ts?: number }>;
  };
}

type Verdict = "found" | "refused" | "nothing";
interface Config { label: string; places: boolean; fullText: boolean }
const CONFIGS: Config[] = [
  { label: "as sweep.ts calls it today", places: false, fullText: false },
  { label: "+ places (venueVerdict can compare ids)", places: true, fullText: false },
  { label: "+ R numbers from message bodies", places: true, fullText: true },
];

(async () => {
  const path = join(ROOT_DIR, "data", "testset", "threads.jsonl");
  if (!existsSync(path)) throw new Error(`no test set at ${path} — run: npx tsx scripts/build-testset.ts`);
  const rows: Row[] = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const places: PlaceCandidate[] = [];
  for (let p = 1; p <= 80; p++) {
    const rs = (await get(`/places?limit=200&page=${p}`))?.data ?? [];
    if (!rs.length) break;
    places.push(...(rs as PlaceCandidate[]));
  }
  // Positive control. With an empty place list every configuration below collapses onto
  // the first one and the comparison silently measures nothing.
  if (places.length < 1000) throw new Error(`only ${places.length} places read — the place list is not answering`);

  const ordersOf = new Map<number, OrderRec[]>();
  const fetchOrders = async (company_id: number): Promise<OrderRec[]> => {
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

  const createdOk = (r: Row) => (r.engine.order_action_log || []).some((a) => a.kind === "create" && a.ok !== false);
  const lost = rows.filter((r) => r.onsinch_missing && createdOk(r) && Number(r.engine.company_id) > 0);
  console.log(`places ${places.length}`);
  console.log(`threads where the engine created an order and that order is now gone: ${lost.length}\n`);

  const tally: Record<string, Record<Verdict, number>> = {};
  for (const c of CONFIGS) tally[c.label] = { found: 0, refused: 0, nothing: 0 };
  // Ground truth, and the two halves of it kept apart: a thread with NO successor on the
  // day is one where finding nothing is the CORRECT answer, and folding it in would
  // reward the matcher for the tenant being empty.
  let hasSuccessor = 0, noSuccessor = 0, skipped = 0;
  const gaps: Record<string, number> = {
    "raised BEFORE ours — a DUPLICATE, not a recovery": 0,
    "same day (0-24h after ours)": 0,
    "1-3 days after": 0,
    "4-14 days after": 0,
    "more than 14 days after": 0,
  };
  const duplicates: string[] = [];
  const recoverable: string[] = [];
  const invented: string[] = [];
  const lines: string[] = [];

  for (const r of lost) {
    const company_id = Number(r.engine.company_id);
    const orders = await fetchOrders(company_id);
    // The client's whole order list coming back empty is not evidence of anything — this
    // API answers an unsupported filter with an empty list, never an error.
    if (!orders.length) { skipped++; continue; }

    const days = (r.engine.requests || []).map((q) => q.date).filter((d): d is string => !!d);
    if (!days.length) { skipped++; continue; }
    const dayset = new Set(days.map((d) => d.slice(0, 10)));

    // GROUND TRUTH: is there any order at all for this client on a day the thread asked
    // for? `happening`, to match what the rule itself filters on.
    const sameDay = orders.filter((o) => dayset.has(String(o.happening || "").slice(0, 10)));
    const truth = sameDay.length > 0;
    truth ? hasSuccessor++ : noSuccessor++;

    const verdicts: Record<string, Verdict> = {};
    for (const c of CONFIGS) {
      const m = matchExistingOrder(days.slice().sort()[0], orders, {
        days,
        location_text: r.engine.location_text ?? undefined,
        place_id: r.engine.place_id ?? null,
        places: c.places ? places : undefined,
        r_numbers: rNumbersIn(
          c.fullText
            ? (r.messages || []).map((m2) => `${m2.subject ?? ""} ${m2.body ?? ""}`).join("\n")
            : String(r.subject ?? "")
        ),
      });
      const v: Verdict = !m ? "nothing" : "ambiguous" in m ? "refused" : "found";
      verdicts[c.label] = v;
      tally[c.label][v]++;
    }

    // WHEN was the successor raised, relative to our order? This is the answer to "does
    // the rule only cope with a job created a day later" — it has no time window at all.
    // Candidates are every order the client has ever had and the filter is the WORK day
    // (`happening`) against the dates the thread asked for; when an order was created is
    // never consulted. Measured: 45 of 55 binds are to an order raised within 24 hours.
    //
    // A successor raised BEFORE ours is a different animal and the more expensive one:
    // staff already had the booking and the engine created a second one beside it. That
    // is a duplicate, not a recovery, and it means the inbound path failed to match at
    // create time.
    const best2 = verdicts[CONFIGS[CONFIGS.length - 1].label];
    if (best2 === "found") {
      const m = matchExistingOrder(days.slice().sort()[0], orders, {
        days, location_text: r.engine.location_text ?? undefined, place_id: r.engine.place_id ?? null,
        places, r_numbers: rNumbersIn((r.messages || []).map((m2) => `${m2.subject ?? ""} ${m2.body ?? ""}`).join("\n")),
      });
      const succ = m && "order_id" in m ? orders.find((o) => Number(o.id) === m.order_id) : undefined;
      const ourTs = (r.engine.order_action_log || []).find((a) => a.kind === "create" && a.ok !== false)?.ts;
      const succTs = Date.parse(String((succ as any)?.created ?? ""));
      if (ourTs && Number.isFinite(succTs)) {
        const hours = (succTs - Number(ourTs)) / 3_600_000;
        gaps[hours < 0 ? "raised BEFORE ours — a DUPLICATE, not a recovery"
          : hours < 24 ? "same day (0-24h after ours)"
          : hours < 72 ? "1-3 days after"
          : hours < 336 ? "4-14 days after" : "more than 14 days after"]++;
        if (hours < 0) duplicates.push(`   ${r.thread_id}  staff had #${(succ as any)?.number} "${String((succ as any)?.name).slice(0, 44)}" ${(-hours).toFixed(0)}h earlier; the engine created ${r.engine.onsinch_order_id} anyway`);
      }
    }

    const shipped = verdicts[CONFIGS[0].label];
    const best = verdicts[CONFIGS[CONFIGS.length - 1].label];
    if (truth && shipped !== "found" && best === "found") {
      recoverable.push(`   ${r.thread_id}  ${sameDay.length} order(s) on the day, shipped=${shipped} -> best=found   "${String(r.subject).slice(0, 52)}"`);
    }
    if (!truth && shipped === "found") {
      invented.push(`   ${r.thread_id}  NO order on any requested day, yet shipped=found   "${String(r.subject).slice(0, 52)}"`);
    }
    if (LIST) {
      lines.push(
        `   ${r.thread_id}  truth=${truth ? `${sameDay.length} on the day` : "none on the day"}  ` +
          CONFIGS.map((c) => `${c.label.split(" ")[0]}:${verdicts[c.label]}`).join("  ") +
          `   "${String(r.subject).slice(0, 44)}"`
      );
    }
  }

  const scored = hasSuccessor + noSuccessor;
  console.log(`scored ${scored}   (skipped ${skipped}: no client order list, or the thread named no date)`);
  console.log(`   a successor EXISTS for the client on a requested day : ${hasSuccessor}  ${pct(hasSuccessor, scored)}`);
  console.log(`   nothing on any requested day — "nothing" is correct  : ${noSuccessor}  ${pct(noSuccessor, scored)}`);

  console.log(`\nwhat the rule does with them:`);
  for (const c of CONFIGS) {
    const t = tally[c.label];
    console.log(
      `\n   ${c.label}\n` +
        `      binds to a successor    ${String(t.found).padStart(3)}  ${pct(t.found, scored)}\n` +
        `      refuses as ambiguous    ${String(t.refused).padStart(3)}  ${pct(t.refused, scored)}\n` +
        `      finds nothing           ${String(t.nothing).padStart(3)}  ${pct(t.nothing, scored)}`
    );
  }

  console.log(`\nWHEN the successor was raised, relative to our order (${Object.values(gaps).reduce((a, b) => a + b, 0)} binds):`);
  for (const [k, v] of Object.entries(gaps)) console.log(`   ${String(v).padStart(3)}  ${k}`);

  console.log(`\nDUPLICATE CREATES — staff already had the booking and the engine raised a second one: ${duplicates.length}`);
  console.log(duplicates.join("\n") || "   none");

  console.log(`\nRECOVERABLE — a successor exists, the shipped call misses it, the fullest call finds it: ${recoverable.length}`);
  console.log(recoverable.slice(0, 25).join("\n") || "   none");
  if (recoverable.length > 25) console.log(`   ... and ${recoverable.length - 25} more`);

  // The one that must stay at zero. A bind where the ground truth says the client has
  // NOTHING on any day the thread asked for is the rule attaching work to a job that
  // cannot be the right one.
  console.log(`\nBOUND WITH NO ORDER ON ANY REQUESTED DAY — must be 0: ${invented.length}`);
  console.log(invented.join("\n") || "   none");

  if (LIST) { console.log(`\n--- every thread ---`); console.log(lines.join("\n")); }
})();
