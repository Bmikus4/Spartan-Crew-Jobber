// ============================================================================
// ARE THE COMPETING THREADS ABOUT THE SAME JOB, OR DIFFERENT ONES?
// ----------------------------------------------------------------------------
// `matchExistingOrder` binds on company + happening DAY, and refuses when several
// orders share that day unless the venue separates them. So two threads land on one
// order when both resolve to the same client and the same date.
//
// That has two completely different meanings and the fix differs:
//
//   LEGITIMATE - one job, several conversations. A PO arrives in one thread, a crew
//     change in another, an availability question in a third. Binding them all to the
//     one order is CORRECT, and the bug is in `order_records` assuming one thread per
//     order, not in the matcher.
//
//   WRONG - two different jobs for one client that happen to share a date, where the
//     venue failed to separate them. Then a crew change lands on the wrong booking.
//
// The discriminator is the date each thread actually asked for, against the date the
// order is for. This measures it.
//
// Read-only. No writes.
//   npx tsx scripts/contested-dates.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const base = (process.env.ONSINCH_BASE_URL || "").replace(/\/$/, "");
const key = (process.env.ONSINCH_API_KEY || "").trim();
const get = async (p: string): Promise<any> => {
  const r = await fetch(base + p, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  return r.ok ? r.json() : { data: [] };
};
const day = (s: unknown) => String(s ?? "").slice(0, 10);

(async () => {
  const rows = (await sql`select thread_id, state from conversation_state`) as Array<{ thread_id: string; state: any }>;
  const stateOf = new Map<string, any>();
  const byOrder = new Map<number, string[]>();
  for (const r of rows) {
    const s = typeof r.state === "string" ? JSON.parse(r.state) : (r.state ?? {});
    stateOf.set(r.thread_id, s);
    const id = Number(s.onsinch_order_id);
    if (Number.isInteger(id) && id > 0) byOrder.set(id, [...(byOrder.get(id) ?? []), r.thread_id]);
  }
  const contested = [...byOrder.entries()].filter(([, v]) => v.length > 1);

  /** Every date this thread asked for - the blocks it wanted, and the raw facts. */
  const datesOf = (s: any): string[] => {
    const out = new Set<string>();
    for (const t of s.desired_order?.slot_teams ?? []) if (t?.beginning) out.add(day(t.beginning));
    const f = s.facts ?? {};
    for (const v of Object.values(f)) {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) out.add(day(v));
      if (Array.isArray(v)) for (const x of v) {
        if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)) out.add(day(x));
        if (x && typeof x === "object") for (const y of Object.values(x))
          if (typeof y === "string" && /^\d{4}-\d{2}-\d{2}/.test(y)) out.add(day(y));
      }
    }
    return [...out].sort();
  };

  let sameJob = 0, differentJob = 0, undecidable = 0;
  const lines: string[] = [];

  for (const [order_id, threads] of contested.sort((a, b) => b[1].length - a[1].length)) {
    const live = (await get(`/orders?id[eq]=${order_id}&limit=1`)).data?.[0] ?? null;
    const orderDay = live ? day(live.happening) : null;

    // How many orders does this client have on that day at all? If more than one, the
    // matcher was supposed to refuse unless the venue separated them.
    let sameDayOrders = 0;
    if (live) {
      const peers = (await get(`/orders?company_id[eq]=${live.company_id}&limit=100`)).data ?? [];
      sameDayOrders = peers.filter((o: any) => day(o.happening) === orderDay).length;
    }

    const per = threads.map((t) => {
      const s = stateOf.get(t) ?? {};
      const ds = datesOf(s);
      return { t, ds, hits: orderDay ? ds.includes(orderDay) : false, subj: String(s.subject ?? "").slice(0, 52) };
    });

    const agree = per.filter((p) => p.hits).length;
    const known = per.filter((p) => p.ds.length).length;
    let verdict: string;
    if (!known) { verdict = "no dates recorded"; undecidable++; }
    else if (agree === per.length) { verdict = "SAME JOB - every thread asks for the order's date"; sameJob++; }
    else if (agree === 0) { verdict = "STALE - no thread asks for the order's date"; differentJob++; }
    else { verdict = `MIXED - ${agree}/${per.length} threads ask for it`; differentJob++; }

    lines.push(
      `#${order_id} ${live ? "R" + live.number : "deleted"}  order day ${orderDay ?? "?"}  client has ${sameDayOrders} order(s) that day\n` +
      `   ${verdict}\n` +
      per.map((p) => `     ${p.t.slice(0, 10)} ${p.hits ? "✓" : " "} wants [${p.ds.join(", ") || "none recorded"}]  "${p.subj}"`).join("\n")
    );
  }

  console.log(`contested orders: ${contested.length}`);
  console.log(`  every thread wants the order's date (one job, many threads): ${sameJob}`);
  console.log(`  at least one thread wants a different date:                  ${differentJob}`);
  console.log(`  no dates recorded, undecidable:                              ${undecidable}\n`);
  console.log(lines.join("\n\n"));
})();
