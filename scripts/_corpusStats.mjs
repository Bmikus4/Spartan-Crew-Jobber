// One pass over the on-disk corpus, producing everything rnd-study used to ask Postgres
// for eight separate times.
//
// WHY THIS EXISTS. rnd-study ran eight aggregates against sweep_threads.payload —
// jsonb_array_elements over 27,830 messages each time, including a self-join reply-latency
// calculation and a correlated sender-history EXISTS. The mail moved to
// data/corpus/sweep-threads.jsonl (scripts/export-sweep-corpus.mjs), so those queries had
// nothing to read. Porting them one at a time would have meant eight passes over a 196 MB
// file; the aggregates all derive from the same three facts about each message — who sent
// it, when, and how long it was — so this collects them once.
//
// Every counter here mirrors a specific SQL clause. Where the SQL filtered
// (`is_from_spartan = false`, `from <> ''`, `date_iso <> ''`), so does this, and the
// comments name which query each field serves. The numbers are meant to match what the
// database used to return, not merely to be reasonable.
import { readCorpus } from "./_corpus.mjs";

const SPARTAN = (m) => m?.is_from_spartan === true;

export async function corpusStats() {
  // 10. who does the talking — COUNT(*) and the two FILTERed counts
  let messages = 0, fromSpartan = 0, fromClient = 0;

  // 2. who writes in
  const msgCountByAddr = new Map();     // COUNT(*) per sender, non-Spartan, from <> ''
  const threadsByAddr = new Map();      // COUNT(DISTINCT thread_id) per sender
  const threadsByDomain = new Map();    // COUNT(DISTINCT thread_id) per domain, from LIKE '%@%'

  // 13. economics — SUM(len(body) + len(subject) + 120) per thread
  const charsByThread = new Map();

  // 11. reply latency — minutes from each client message to the next Spartan message
  const latencyMinutes = [];

  for await (const row of readCorpus()) {
    const tid = row.thread_id;
    const msgs = Array.isArray(row.payload?.messages) ? row.payload.messages : [];

    let chars = 0;
    const timeline = [];

    for (const m of msgs) {
      messages++;
      const spartan = SPARTAN(m);
      if (spartan) fromSpartan++; else fromClient++;

      chars += String(m?.body ?? "").length + String(m?.subject ?? "").length + 120;

      const iso = String(m?.date_iso ?? "");
      if (iso) {
        const t = Date.parse(iso);
        if (Number.isFinite(t)) timeline.push({ t, spartan });
      }

      if (spartan) continue;                       // the sender tallies exclude our own mail
      const addr = String(m?.from ?? "").toLowerCase();
      if (!addr) continue;
      msgCountByAddr.set(addr, (msgCountByAddr.get(addr) ?? 0) + 1);
      if (!threadsByAddr.has(addr)) threadsByAddr.set(addr, new Set());
      threadsByAddr.get(addr).add(tid);
      if (addr.includes("@")) {
        const domain = addr.split("@")[1] ?? "";
        if (!threadsByDomain.has(domain)) threadsByDomain.set(domain, new Set());
        threadsByDomain.get(domain).add(tid);
      }
    }

    charsByThread.set(tid, chars);

    // The SQL paired every client message with MIN(spartan message strictly later in the
    // same thread). Sorting once and walking backwards gives the same pairing in one pass:
    // `nextSpartan` is always the earliest Spartan message after the current position.
    timeline.sort((a, b) => a.t - b.t);
    let nextSpartan = null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const e = timeline[i];
      if (e.spartan) { nextSpartan = e.t; continue; }
      if (nextSpartan !== null && nextSpartan > e.t) latencyMinutes.push((nextSpartan - e.t) / 60000);
    }
  }

  return { messages, fromSpartan, fromClient, msgCountByAddr, threadsByAddr, threadsByDomain, charsByThread, latencyMinutes };
}

/** COUNT / AVG / PERCENTILE_CONT(0.5) / two FILTERed counts, as section 11 reported them. */
export function latencySummary(minutes) {
  const n = minutes.length;
  if (!n) return { pairs: 0, mean_minutes: 0, median_minutes: 0, within_15m: 0, over_4h: 0 };
  const sorted = [...minutes].sort((a, b) => a - b);
  // PERCENTILE_CONT interpolates between neighbours; an even-length set takes the midpoint.
  const mid = (sorted.length - 1) / 2;
  const median = sorted.length % 2
    ? sorted[mid]
    : (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
  return {
    pairs: n,
    mean_minutes: Math.round(minutes.reduce((a, b) => a + b, 0) / n),
    median_minutes: Math.round(median),
    within_15m: minutes.filter((m) => m < 15).length,
    over_4h: minutes.filter((m) => m > 240).length,
  };
}
