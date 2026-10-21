// ============================================================================
// THE PLANNER AGAIN, EVERY MINUTE, ON EVERY OPEN CARD (Ben approved 10-20, Q2a).
// ----------------------------------------------------------------------------
// A card was decided once, on its email, and frozen. Staff booking the job, the order turning up
// later and a link moving all left it as it was. Measured 10-21: of 107 threads with a need
// since 10-09, 59 had their order in OnSinch and showed no R or J, 13 of them built by staff
// after the email. Here each open card's email is planned again from its stored reading (no
// model call), through the same decideMessage as intake, against OnSinch as it is now, and the
// answer replaces the card: v2_decisions.replan, which feed/v2.ts reads before the decision.
//
// IT NEVER WRITES TO ONSINCH, whatever it decides. An email planned again is older than what
// staff have done about it since, so a write it plans is shown as a need for a person.
// The order it names becomes the thread's link (job_links, links.ts linkFound): the card's R and
// J are then that order's, and sweepLinks checks every minute that it still exists.
// This is the planner itself, run again; there is no second pass or second state (Ben, 10-17).
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { decideMessage, onsinchWorld, rawRequests, threadReads, type Recorded, type MessageIn } from "./process";
import type { World } from "./interpret/plan";
import { linkedOrderId } from "./threadOrder";
import { linkFound } from "./links";
import { noTrace } from "./trace";
import { getSettings } from "../settingsDb";
import { cardRow, type V2Row } from "../feed/v2";
import { V2_FROM } from "../feed/live";
import { FEED_FROM } from "../feed/project";
import { utcToLondon } from "./bot/ops";

type Sql = NeonQueryFunction<false, false>;

/** OnSinch's answers for a few minutes: about 30 cards a minute ask for the same clients' orders. */
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; v: Promise<any> }>();
function cached(w: World, now: () => number = Date.now): World {
  const m = <T,>(k: string, f: () => Promise<T>): Promise<T> => {
    const hit = cache.get(k);
    if (hit && now() - hit.at < CACHE_MS) return hit.v as Promise<T>;
    const v = f();
    cache.set(k, { at: now(), v });
    v.catch(() => cache.delete(k));
    return v;
  };
  return {
    ...w,
    companies: () => m("companies", () => w.companies()),
    companyOrders: (id) => m(`orders:${id}`, () => w.companyOrders(id)),
    placesNamed: w.placesNamed,
    ...(w.allPlaces ? { allPlaces: () => m("places", () => w.allPlaces!()) } : {}),
    ...(w.professions ? { professions: () => m("professions", () => w.professions!()) } : {}),
  };
}

let ready = false;
async function ensure(sql: Sql): Promise<void> {
  if (ready) return;
  await sql`ALTER TABLE v2_decisions ADD COLUMN IF NOT EXISTS replan JSONB, ADD COLUMN IF NOT EXISTS replanned_at TIMESTAMPTZ`;
  ready = true;
}

/** A card the planner can answer again: a hand-off, or a write nothing was ever sent for. */
function open(row: V2Row & { interpretation: any; replanned_at: string | null }, today: string): boolean {
  if (!row.interpretation?.extraction) return false; // a reading that failed has nothing to plan from
  if (row.kind === "write" && row.executed?.length) return false; // something was sent: the bot's own record stands
  if (Date.parse(row.sent_at) < FEED_FROM) return false;
  const days = (row.grounded?.requests ?? []).flatMap((r) => [r.date, r.target?.date]).filter((d): d is string => !!d).sort();
  return !days.length || days[days.length - 1] >= today; // the job is over: off the TV anyway
}

export type ReplanReport = { cards: number; planned: number; changed: number; linked: number; notes: string[] };

export async function replanOpen(sql: Sql, opts: { limit?: number; budgetMs?: number; world?: World; dry?: boolean; now?: number; out?: Array<{ thread_id: string; message_id: string; was: string; now: string; link: string | null }> } = {}): Promise<ReplanReport> {
  if (!opts.dry) await ensure(sql);
  const now = opts.now ?? Date.now();
  const today = utcToLondon(new Date(now).toISOString()).date;
  const deadline = Date.now() + (opts.budgetMs ?? 90_000);
  const rows = (await sql`
    SELECT d.thread_id, d.message_id, d.sent_at, d.kind, d.interpretation, d.interpretation->'grounded' AS grounded, d.decision, d.executed,
           d.company_id, d.company, d.from_address, to_jsonb(d)->'replan' AS replan, to_jsonb(d)->>'replanned_at' AS replanned_at, m.subject
    FROM v2_decisions d LEFT JOIN thread_messages m ON m.message_id = d.message_id
    WHERE d.kind IN ('write', 'handoff') AND coalesce(d.code_version, '') <> 'local' AND d.created_at >= ${V2_FROM}`) as any[];
  const byThread = new Map<string, any[]>();
  for (const r of rows) byThread.set(r.thread_id, [...(byThread.get(r.thread_id) ?? []), r]);
  const cards = [...byThread.values()].map((list) => cardRow(list) as any).filter((r) => open(r, today))
    .sort((a, b) => (Date.parse(a.replanned_at ?? "") || 0) - (Date.parse(b.replanned_at ?? "") || 0));
  const rep: ReplanReport = { cards: cards.length, planned: 0, changed: 0, linked: 0, notes: [] };
  const world = opts.world ?? cached(onsinchWorld());
  const leadDays = await getSettings().then((s) => (s.create_lead_enabled === false ? null : s.create_lead_days)).catch(() => undefined);

  for (const row of cards.slice(0, opts.limit ?? 20)) {
    if (Date.now() > deadline) { rep.notes.push("stopped at the time budget"); break; }
    try {
      const m0 = ((await sql`SELECT message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan FROM thread_messages WHERE message_id = ${row.message_id}`) as MessageIn[])[0];
      if (!m0) continue;
      let got: Recorded | null = null;
      const links: Array<{ order_id: number; source: string }> = [];
      await decideMessage(m0, {
        ...threadReads(sql, m0),
        extract: (async () => ({ x: row.interpretation.extraction, meta: row.interpretation.meta ?? { model: "stored", prompt_id: "stored", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
        world,
        threadOrderId: () => linkedOrderId(sql, m0.thread_id),
        run: null,
        leadDays: async () => leadDays,
        now: () => now,
        again: true,
        // Every email's reading on the thread, later ones too: Bearded Kitten's "3 lifters" names
        // its 16 Oct only in a later email, and that day is what finds R11507.
        asked: async () => byThread.get(row.thread_id)!.flatMap((d: any) => [
          ...((d.interpretation?.grounded?.requests ?? []) as any[]).map((r) => ({ date: r.date ?? r.target?.date, start: r.start, crew: r.crew, place_id: r.place_id, venue: r.venue, target: r.target })),
          ...rawRequests(d.interpretation?.extraction ?? { requests: [] }),
        ]),
        link: async (order_id, source = "planner") => { links.push({ order_id, source }); },
        record: async (r) => { got = r; },
        trace: noTrace,
      });
      rep.planned++;
      const d = (got as Recorded | null)?.decision;
      if (!d) continue;
      const before = JSON.stringify(row.replan ?? row.decision), after = JSON.stringify(d);
      const was = row.decision.kind === "handoff" ? `handoff: ${(row.decision.reasons ?? [])[0] ?? ""}` : row.decision.kind;
      const said = d.kind === "handoff" ? `handoff${d.order_id ? ` (order ${d.order_id})` : ""}: ${d.reasons[0] ?? ""}` : d.kind === "none" ? `none: ${d.reason}` : `write: ${d.why[0] ?? ""}`;
      // A write from the past is a person's: only the order it is about is kept, as a link.
      const target = d.kind === "write" ? [...new Set(d.ops.map((o) => ("order_id" in o.op ? Number(o.op.order_id) : 0)).filter(Boolean))] : [];
      const link = links[0] ?? (target.length === 1 ? { order_id: target[0], source: "planner" } : null);
      opts.out?.push({ thread_id: row.thread_id, message_id: row.message_id, was, now: said, link: link ? String(link.order_id) : null });
      if (opts.dry) continue;
      if (before !== after || !row.replanned_at) {
        await sql`UPDATE v2_decisions SET replan = ${after}::jsonb, replanned_at = now() WHERE message_id = ${row.message_id}`;
        if (before !== after) rep.changed++;
      } else {
        await sql`UPDATE v2_decisions SET replanned_at = now() WHERE message_id = ${row.message_id}`;
      }
      if (link && (await linkFound(sql, { thread_id: row.thread_id, order_id: link.order_id, source: link.source })) === "linked") rep.linked++;
    } catch (e) {
      rep.notes.push(`${row.thread_id}: ${String((e as Error)?.message ?? e).slice(0, 100)}`);
    }
  }
  return rep;
}
