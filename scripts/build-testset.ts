// ============================================================================
// The test set: every live thread, joined to what the engine did and what OnSinch holds.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS. The 2026-08-03 sweep corpus cannot score end-to-end accuracy. It is
// 5,835 threads of old mail, of which only 78 appear in `conversation_state` at all and
// ZERO of those hold an order — so for almost every swept thread the question "did the
// engine get this right?" has no answer, because the engine never processed it. The
// corpus measures classification on mail nobody acted on; the 99% target is end-to-end
// behaviour on mail the engine actually handled. Different populations.
//
// The population that CAN be scored is the live one: the threads intake has ingested
// since 2026-07, each carrying the engine's whole decision trail in
// `conversation_state.state` — classification, the facts it extracted, the company and
// place it resolved, the order it composed, the notes explaining each resolution, and
// the action log of what it wrote. Joined to the order OnSinch actually holds, that is a
// denominator with a truth column.
//
// WHAT IS EMITTED (data/testset/, gitignored — it is client mail):
//   threads.jsonl   one row per live thread: messages + engine decisions + OnSinch state
//   recall.jsonl    threads in the mailbox sweep for the same window that the engine
//                   NEVER SAW, because intake polls one Gmail label and nothing else.
//                   A job email that never gets that label is a 100% end-to-end miss
//                   and appears in no other metric — this file is the only place it is
//                   visible. Empty until the sweep has covered the live window.
//
// The ground truth is NOT in here. Nothing in this file adjudicates anything: every
// `engine.*` field is what the engine claimed, and scoring it against itself is the
// mirror this repo has already been burned by four times. Truth is written separately,
// by hand or from OnSinch, keyed on thread_id.
//
// Free: Neon and OnSinch both cost nothing. No model call anywhere in this script.
//
//   npx tsx scripts/build-testset.ts            # build both files
//   npx tsx scripts/build-testset.ts --no-onsinch   # skip the OnSinch leg (faster)
// ============================================================================
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const argv = process.argv.slice(2);
const WITH_ONSINCH = !argv.includes("--no-onsinch");

const argvDate = (flag: string, dflt: string): string => {
  const i = argv.indexOf(flag);
  return i < 0 ? dflt : String(argv[i + 1] ?? dflt);
};

const OUT_DIR = join(ROOT_DIR, "data", "testset");

// Shape tests for the recall list. Deliberately generous on "is this about crew" and
// strict on "does it name a when" — a miss list that over-reports is still readable,
// one that under-reports hides the thing it exists to find.
const SPARTAN = /@spartancrew\.co\.uk/i;
const CREW = /\b(\d+)\s*(x\s*)?(crew|men|guys|people|staff|techs?|hands|riggers?|loaders?|humans|subbies|porters?)\b/i;
const CREW_SUBJ = /\b(crew|staff|riggers?|labour|quotation|quote)\b/i;
const WHEN = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b\d{1,2}(st|nd|rd|th)\b|\b\d{1,2}[\/.-]\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(today|tomorrow|tonight)\b/i;

// ---------------------------------------------------------------------------
// OnSinch — read-only. Status codes are 0 open, -1 cancelled, -2 finished; the
// published reference says -2 is cancelled and is wrong.
// ---------------------------------------------------------------------------
const STATUS_NAME: Record<number, string> = { 0: "open", [-1]: "cancelled", [-2]: "finished" };

async function onsinchOrders(): Promise<Map<number, Record<string, unknown>>> {
  const base = requireEnv("ONSINCH_BASE_URL").replace(/\/$/, "");
  const key = requireEnv("ONSINCH_API_KEY");
  const headers = { Authorization: `apikey ${key}` };
  const out = new Map<number, Record<string, unknown>>();
  for (let page = 1; page <= 200; page++) {
    const r = await fetch(`${base}/orders?limit=100&page=${page}&with=Job`, { headers });
    if (!r.ok) throw new Error(`GET /orders page ${page} -> ${r.status}`);
    const j = await r.json();
    const rows = j?.data ?? [];
    for (const o of rows) out.set(Number(o.id), o);
    if (rows.length < 100) break;
  }
  // A positive control. An empty or tiny list here would silently turn every
  // `onsinch: null` below into "the order is gone", which is a very different
  // finding from "the read failed".
  if (out.size < 1000) throw new Error(`only ${out.size} orders read — the list call is not working, refusing to emit a test set that would read as mass deletion`);
  return out;
}

// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const states = (await sql`
    select thread_id, status, needs_human, onsinch_order_id, updated_at, state
    from conversation_state order by updated_at asc`) as Array<any>;

  const msgs = (await sql`
    select thread_id, message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
    from thread_messages order by thread_id, date_iso asc`) as Array<any>;
  const byThread = new Map<string, any[]>();
  for (const m of msgs) {
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []);
    byThread.get(m.thread_id)!.push(m);
  }

  const recs = (await sql`select * from order_records`) as Array<any>;
  const recByThread = new Map<string, any[]>();
  for (const r of recs) {
    if (!recByThread.has(r.thread_id)) recByThread.set(r.thread_id, []);
    recByThread.get(r.thread_id)!.push(r);
  }

  const tickets = (await sql`
    select thread_id, gate_reason, classification, status, is_client_inquiry, reply_state, notes
    from tickets`) as Array<any>;
  const tkt = new Map(tickets.map((t) => [t.thread_id, t]));

  const orders = WITH_ONSINCH ? await onsinchOrders() : new Map<number, any>();
  if (WITH_ONSINCH) console.log(`OnSinch: ${orders.size} orders read`);

  const out = createWriteStream(join(OUT_DIR, "threads.jsonl"), "utf8");
  let bound = 0, missing = 0;
  const byStatus: Record<string, number> = {};

  for (const s of states) {
    const st = (s.state || {}) as Record<string, any>;
    const messages = (byThread.get(s.thread_id) || []).map((m) => ({
      message_id: m.message_id,
      from: m.from_address,
      to: m.to_addresses,
      date_iso: m.date_iso,
      subject: m.subject,
      body: m.body,
      is_from_spartan: m.is_from_spartan,
    }));
    const inbound = messages.filter((m) => !m.is_from_spartan);
    const orderId = s.onsinch_order_id === null ? null : Number(s.onsinch_order_id);
    const live = orderId !== null ? orders.get(orderId) ?? null : null;
    if (orderId !== null) (live ? bound++ : missing++);
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;

    out.write(JSON.stringify({
      thread_id: s.thread_id,
      subject: st.subject ?? messages[0]?.subject ?? null,
      updated_at: s.updated_at,
      n_messages: messages.length,
      n_inbound: inbound.length,
      first_date: messages[0]?.date_iso ?? null,
      last_date: messages[messages.length - 1]?.date_iso ?? null,
      senders: [...new Set(inbound.map((m) => m.from))],
      messages,

      // Everything the engine decided. CLAIMS, not truth.
      engine: {
        status: s.status,
        needs_human: s.needs_human,
        review_only: st.review_only ?? null,
        built_flagged: st.built_flagged ?? null,
        classification: st.classification ?? null,
        cancellation: st.cancellation ?? null,
        priority: st.priority ?? null,
        company_name: st.facts?.company_name ?? null,
        company_id: st.company_id ?? null,
        location_text: st.facts?.location_text ?? null,
        place_id: st.place_id ?? null,
        sender_email: st.sender_email ?? null,
        sender_domain: st.sender_domain ?? null,
        requests: st.facts?.requests ?? [],
        slot_teams: st.desired_order?.slot_teams ?? [],
        specification: st.desired_order?.specification ?? null,
        rate_card_source: st.desired_order?.rate_card_source ?? null,
        notes: st.notes ?? [],
        order_action_log: st.order_action_log ?? [],
        onsinch_order_id: orderId,
        onsinch_order_number: st.onsinch_order_number ?? null,
        onsinch_job_id: st.onsinch_job_id ?? null,
        gate_reason: tkt.get(s.thread_id)?.gate_reason ?? null,
      },

      // What the order actually is now, read from OnSinch. `with=Job` gives the
      // AGGREGATE span across every block, never one block's window — one-sided
      // evidence, and the only per-order timing this API will hand over without
      // a staffed seat to read attendance from.
      //
      // `Job` comes back as an ARRAY of jobs, not an object. Reading `live.Job.min_beginning`
      // yields undefined on every order, which then reads as "OnSinch holds no dates at all" —
      // a cross-check built on it scored 0 hits on threads whose own order was demonstrably
      // alive. The instants are UTC; a BST job starting 16:00 local reads 15:00Z here.
      onsinch: live ? {
        id: Number(live.id),
        number: String((live as any).number ?? ""),
        status: Number((live as any).status),
        status_name: STATUS_NAME[Number((live as any).status)] ?? `unknown(${(live as any).status})`,
        company_id: (live as any).company_id ?? null,
        intern_name: (live as any).intern_name ?? null,
        specification: (live as any).specification ?? null,
        jobs: (Array.isArray((live as any).Job) ? (live as any).Job : []).map((j: any) => ({
          id: Number(j.id), name: j.name ?? null,
          min_beginning: j.min_beginning ?? null, max_end: j.max_end ?? null,
        })),
        job_min_beginning: (Array.isArray((live as any).Job) ? (live as any).Job : [])
          .map((j: any) => j.min_beginning).filter(Boolean).sort()[0] ?? null,
        job_max_end: (Array.isArray((live as any).Job) ? (live as any).Job : [])
          .map((j: any) => j.max_end).filter(Boolean).sort().slice(-1)[0] ?? null,
      } : null,
      // An id the engine holds that /orders does not return. Order numbers are
      // reused after deletion, so this is the only honest way to say "gone".
      onsinch_missing: orderId !== null && !live,

      order_records: (recByThread.get(s.thread_id) || []).map((r) => ({
        order_id: Number(r.order_id), job_id: r.job_id === null ? null : Number(r.job_id),
        order_number: r.order_number, company_id: r.company_id, place_id: r.place_id,
        block_count: r.block_count, crew_total: r.crew_total, id_source: r.id_source,
      })),
    }) + "\n");
  }
  await new Promise((res) => out.end(res));

  // ---- the recall stratum -------------------------------------------------
  // Intake polls ONE Gmail label on a 10-minute window; the sweep reads the whole mailbox
  // for a date range with no label filter. Subtracting the two is the only way to see mail
  // the engine was never given — every other measurement in this repo starts from threads
  // it already has.
  //
  // THREE THINGS HAVE TO BE RIGHT OR THE NUMBER IS A FICTION, and the first version of this
  // got all three wrong and reported a 17% leak that does not exist.
  //
  // 1. THE DENOMINATOR IS bookings@, not the account. The sweep reads every address on it —
  //    info@, accounts@, jenny@, recruitment@ — and intake is not supposed to touch those.
  //    Counting them made 555 threads read as 666.
  // 2. SEEN MEANS ANY RECORD, not a conversation_state row. Thirteen threads reached the
  //    engine, were ledgered, and produced no state row (all on 2026-08-04..06, and none
  //    since). They are a different failure and calling them "never seen" is wrong.
  // 3. THE MISSES ARE NOT SPREAD, THEY ARE TWO OUTAGES. 69 of the 71 arrived on five days:
  //    2026-08-26/27 (the Gmail credential expired, intake failed every five minutes for 42
  //    hours and nobody knew — the reason the watchdog exists) and 2026-09-09..11 (the OAuth
  //    grant behind "Spartan Crew 8/27/26" was revoked). On every other day recall is 99.5%
  //    — two misses in 421 threads, one of them a job application.
  //
  // So intake does not leak. It goes to zero when the credential dies, and it has done that
  // twice. The fix is credential lifetime and detection speed, not the label filter.
  const liveFrom = argvDate("--recall-from", "2026-08-04");
  /** Days intake was down. A recall figure that averages over them measures the outage. */
  const OUTAGE_DAYS = new Set(["2026-08-26", "2026-08-27", "2026-09-09", "2026-09-10", "2026-09-11"]);
  const gap = (await sql`
    select s.thread_id, s.subject, s.message_count, s.first_date, s.last_date, s.participants, s.payload
    from sweep_threads s
    where s.last_date >= ${liveFrom}::timestamptz
      and s.swept_at >= ${liveFrom}::timestamptz
      and not exists (select 1 from conversation_state c where c.thread_id = s.thread_id)
      and not exists (select 1 from message_ledger l where l.thread_id = s.thread_id)
    order by s.last_date asc`) as Array<any>;
  const rec = createWriteStream(join(OUT_DIR, "recall.jsonl"), "utf8");
  for (const g of gap) {
    const messages = Array.isArray(g.payload?.messages) ? g.payload.messages : [];
    rec.write(JSON.stringify({
      thread_id: g.thread_id, subject: g.subject, message_count: g.message_count,
      first_date: g.first_date, last_date: g.last_date, participants: g.participants,
      senders: [...new Set(messages.filter((m: any) => !m.is_from_spartan).map((m: any) => m.from))],
      messages,
    }) + "\n");
  }
  await new Promise((res) => rec.end(res));

  const swept = (await sql`
    select thread_id, payload from sweep_threads
    where last_date >= ${liveFrom}::timestamptz and swept_at >= ${liveFrom}::timestamptz`) as Array<any>;
  const toBookings = (t: any) => (t.payload?.messages ?? [])
    .some((m: any) => (m.to ?? []).some((x: any) => /^bookings@spartancrew\.co\.uk$/i.test(String(x).trim())));
  /** The day the first client message landed — when intake had its chance at the thread. */
  const arrivedOn = (t: any): string => (t.payload?.messages ?? [])
    .filter((m: any) => !m.is_from_spartan)
    .map((m: any) => String(m.date_iso).slice(0, 10)).sort()[0] ?? "";
  const inScope = swept.filter((t) => toBookings(t) && arrivedOn(t));
  const sweptInWindow = inScope.length;
  const missedIds = new Set(gap.map((g) => g.thread_id));
  const split = (rows: any[]) => ({ n: rows.length, missed: rows.filter((t) => missedIds.has(t.thread_id)).length });
  const outage = split(inScope.filter((t) => OUTAGE_DAYS.has(arrivedOn(t))));
  const normal = split(inScope.filter((t) => !OUTAGE_DAYS.has(arrivedOn(t))));
  const pc = (s: { n: number; missed: number }) => (s.n ? (100 * (s.n - s.missed) / s.n).toFixed(1) : "—") + "%";

  // Most of any miss list is autoreplies and machine mail the engine is right never to
  // see. The number that matters is how many of them look like someone asking for crew.
  const shapeOf = (g: any): string => {
    const msgs = Array.isArray(g.payload?.messages) ? g.payload.messages : [];
    const inb = msgs.filter((m: any) => !m.is_from_spartan && !SPARTAN.test(String(m.from || "")));
    const subj = String(g.subject || "");
    if (/automatic reply|out of office|^ooo\b/i.test(subj)) return "autoreply";
    if (msgs.some((m: any) => /no-reply@sinch\.cz/i.test(String(m.from || "")))) return "onsinch portal notice";
    if (!inb.length) return "no inbound (Spartan-only thread)";
    const text = `${subj} ${inb.map((m: any) => m.body).join(" ")}`.slice(0, 4000);
    return CREW.test(text) || CREW_SUBJ.test(subj) ? (WHEN.test(text) ? "JOB-SHAPED" : "other") : "other";
  };
  const shapes: Record<string, number> = {};
  for (const g of gap) { const k = shapeOf(g); shapes[k] = (shapes[k] || 0) + 1; }

  console.log(`\ndata/testset/threads.jsonl   ${states.length} live threads`);
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(12)} ${v}`);
  if (WITH_ONSINCH) console.log(`   bound to an order that still exists: ${bound}   order id gone from OnSinch: ${missing}`);
  console.log(`\ndata/testset/recall.jsonl    ${gap.length} of ${sweptInWindow} thread(s) swept since ${liveFrom} that the engine never saw`);
  if (!sweptInWindow) {
    console.log(`   0 swept in that window — the sweep has not covered it, so "0 missed" would mean nothing at all.`);
    console.log(`   Run: node scripts/install-sweep-workflow.mjs --since ${liveFrom} --step 7`);
  } else {
    // Split, never averaged. A blended figure hides the only thing worth knowing: intake
    // is either running, and near-perfect, or dead, and losing everything.
    console.log(`   of ${sweptInWindow} thread(s) addressed to bookings@ in this window —`);
    console.log(`     on a normal day          ${String(normal.n).padStart(4)} threads, ${normal.missed} missed   recall ${pc(normal)}`);
    console.log(`     during a known outage    ${String(outage.n).padStart(4)} threads, ${outage.missed} missed   recall ${pc(outage)}   (${[...OUTAGE_DAYS].join(", ")})`);
    console.log(`   what the missed ones look like:`);
    for (const [k, v] of Object.entries(shapes).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
