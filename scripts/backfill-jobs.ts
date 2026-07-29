// ============================================================================
// The 30-most-recent-jobs backfill: link each recent OnSinch order back to the
// inbox thread it came from, and show the result as ticket rows in the tool.
// ----------------------------------------------------------------------------
// Ben, 2026-07-27: "the tickets table should include the 30 most recent jobs
// linked across onsinch and the inbox, this will be a difficult cross reference
// job."
//
// It needs BOTH sides. The order side is live now; the thread side comes from
// conversation_state, which only fills once n8n's Gmail credential is reconnected
// and emails start flowing. So this runs today and reports honestly that there
// are no candidate threads yet - and the moment there are, it is one command.
//
// DRY RUN BY DEFAULT. Nothing is written without --apply.
//
//   npx tsx scripts/backfill-jobs.ts              # dry run, 30 orders
//   npx tsx scripts/backfill-jobs.ts --count 50
//   npx tsx scripts/backfill-jobs.ts --apply      # write the confident links
//
// Ambiguous and unmatched orders are NEVER auto-linked; --apply records them for
// a human instead. A wrong link silently attributes a real job to the wrong
// client conversation, which is worse than no link at all.
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv, onsinchGet } from "./_env.mjs";
import { decideLink, type OrderSide, type ThreadSide } from "../app/lib/engine/orderLink";
import type { ConversationState } from "../app/lib/engine/types";

loadEnv();
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const COUNT = Number(argv[argv.indexOf("--count") + 1]) || 30;

const KEY = requireEnv("ONSINCH_API_KEY");
const sql = neon(requireEnv("DATABASE_URL"));

// ---------------------------------------------------------------- order side
const firstJob = (o: Record<string, any>) => (Array.isArray(o.Job) ? o.Job[0] : o.Job) ?? {};

/** Newest-first. GET /orders returns descending, so page 1 is the recent end. */
async function recentOrders(want: number): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  for (let page = 1; out.length < want && page <= 5; page++) {
    const r = await onsinchGet(`/orders?limit=100&page=${page}&with=Job`, KEY);
    const rows: Record<string, any>[] = Array.isArray(r?.data) ? r.data : [];
    if (!rows.length) break;
    out.push(...rows);
  }
  out.sort((a, b) => Date.parse(b.created ?? 0) - Date.parse(a.created ?? 0) || Number(b.id) - Number(a.id));
  return out.slice(0, want);
}

// ---------------------------------------------------------------- thread side
/** Every conversation we know about, flattened for the scorer. */
async function candidateThreads(): Promise<ThreadSide[]> {
  const rows = (await sql`SELECT state FROM conversation_state ORDER BY updated_at DESC LIMIT 500`) as { state: ConversationState }[];
  return rows.map(({ state: s }) => ({
    thread_id: s.thread_id,
    subject: s.subject,
    participants: s.participants ?? [],
    contact_email: s.facts?.contact_email,
    company_name: s.facts?.company_name,
    location_text: s.facts?.location_text,
    dates: (s.facts?.requests ?? []).map((r) => r.date).filter(Boolean) as string[],
    // the oldest message we processed is the best proxy for when it started
    first_message_iso: s.last_processed_epoch ? new Date(s.last_processed_epoch).toISOString() : undefined,
    company_id: s.company_id ?? null,
    user_id: s.user_id ?? null,
  }));
}

// ---------------------------------------------------------------- run
// Wrapped: tsx transpiles these scripts to CJS, where top-level await is a
// transform error.
async function main() {
const orders = await recentOrders(COUNT);
console.log(`\nOnSinch: ${orders.length} most-recent orders (#${orders[orders.length - 1]?.id}..#${orders[0]?.id})`);

// Resolve company names once - 755 companies, one pull, matched locally.
const companiesRes = await onsinchGet(`/companies?limit=100&page=1`, KEY);
const pageCount = companiesRes?.pagination?.pageCount ?? 1;
const companies = new Map<number, string>();
for (const c of companiesRes?.data ?? []) companies.set(Number(c.id), c.name);
for (let p = 2; p <= pageCount; p++) {
  const r = await onsinchGet(`/companies?limit=100&page=${p}`, KEY);
  for (const c of r?.data ?? []) companies.set(Number(c.id), c.name);
}
console.log(`OnSinch: ${companies.size} companies resolved for name matching`);

const threads = await candidateThreads();
console.log(`Inbox:   ${threads.length} candidate threads in conversation_state\n`);

if (!threads.length) {
  console.log("Nothing to link yet: no threads have been ingested.");
  console.log("The order side is ready and the scorer is tested; this becomes one");
  console.log("command as soon as n8n's Gmail credential is reconnected and email");
  console.log("starts arriving. Re-run then.\n");
  console.log("Order side preview (what will be matched):");
  for (const o of orders.slice(0, 10)) {
    console.log(`  #${o.id}  ${String(o.created).slice(0, 10)}  happening=${String(o.happening).slice(0, 10)}  ${companies.get(Number(o.company_id)) ?? "co " + o.company_id} — ${String(o.name ?? "").slice(0, 40)}`);
  }
  if (orders.length > 10) console.log(`  … and ${orders.length - 10} more`);
  return;
}

// Spartan's own orders (internal training, office staff) have no client
// conversation by definition. Counting them as "unmatched" would make a clean
// run look like a partial failure, so they are reported separately.
const INTERNAL_COMPANY_IDS = new Set([1]); // company 1 = Spartan Crew
const internal = orders.filter((o) => INTERNAL_COMPANY_IDS.has(Number(o.company_id)));
const linkable = orders.filter((o) => !INTERNAL_COMPANY_IDS.has(Number(o.company_id)));
if (internal.length) {
  console.log(`skipped     ${internal.length} internal Spartan order(s): ${internal.map((o) => "#" + o.id).join(", ")}\n`);
}

const buckets = { linked: [] as any[], ambiguous: [] as any[], unmatched: [] as any[] };
for (const o of linkable) {
  const side: OrderSide = {
    id: Number(o.id),
    name: o.name,
    created: o.created,
    happening: o.happening,
    company_id: o.company_id ?? null,
    user_id: o.user_id ?? null,
    company_name: companies.get(Number(o.company_id)),
    specification: o.specification,
  };
  const d = decideLink(side, threads);
  buckets[d.kind].push({ order: side, decision: d, job: firstJob(o) });
}

console.log(`linked      ${buckets.linked.length}`);
console.log(`ambiguous   ${buckets.ambiguous.length}  (escalated, never auto-linked)`);
console.log(`unmatched   ${buckets.unmatched.length}\n`);

for (const { order, decision } of buckets.linked) {
  const hits = (decision.features ?? []).filter((f: any) => f.hit).map((f: any) => f.name).join(", ");
  console.log(`  LINK  #${order.id} -> ${decision.thread_id}  score=${decision.score.toFixed(2)}  [${hits}]`);
}
for (const { order, decision } of buckets.ambiguous) {
  console.log(`  AMBIG #${order.id}  ${decision.reason}`);
  for (const c of decision.candidates.slice(0, 3)) console.log(`          ${c.thread_id} score=${c.score.toFixed(2)}`);
}
for (const { order, decision } of buckets.unmatched) {
  console.log(`  NONE  #${order.id}  ${decision.reason}`);
}

if (!APPLY) {
  console.log(`\n(dry run — nothing written. Re-run with --apply to record ${buckets.linked.length} link(s).)`);
  return;
}

// --apply: attach the order to the linked thread's ticket. The UNIQUE partial
// index on onsinch_order_id means a given order can occupy only one ticket, so a
// re-run cannot fan one order across several.
let wrote = 0;
for (const { order, decision } of buckets.linked) {
  try {
    await sql`
      UPDATE tickets SET onsinch_order_id = ${order.id},
                         onsinch_order_number = COALESCE(onsinch_order_number, ${String(order.id)}),
                         updated_at = now()
      WHERE thread_id = ${decision.thread_id} AND onsinch_order_id IS NULL`;
    await sql`INSERT INTO ticket_events (thread_id, kind, meta)
              VALUES (${decision.thread_id}, ${"backfill-link"}, ${JSON.stringify({ order_id: order.id, score: decision.score })})`;
    wrote++;
  } catch (err) {
    console.error(`  failed to link #${order.id}:`, (err as Error).message);
  }
}
for (const { order, decision } of buckets.ambiguous) {
  await sql`INSERT INTO ticket_events (thread_id, kind, meta)
            VALUES (${decision.candidates[0].thread_id}, ${"backfill-ambiguous"}, ${JSON.stringify({ order_id: order.id, reason: decision.reason })})`;
}
console.log(`\napplied: ${wrote} link(s) written, ${buckets.ambiguous.length} escalation(s) recorded.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
