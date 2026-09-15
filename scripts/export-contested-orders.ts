// ============================================================================
// Export the orders that more than one email thread claims, with every conversation.
// ----------------------------------------------------------------------------
// The Phase 1 backfill refused to adopt 19 orders because two or more threads carry the
// same `onsinch_order_id` in their conversation state. One of them, #13633, is claimed by
// six. An order belongs to one booking and one client, so at most one of those threads is
// right and the rest are mis-attributions — which is the failure `orderLink.ts` calls
// "worse than no link, because it silently attributes a real job to the wrong client
// conversation".
//
// The data cannot say which thread is correct. A person reading the conversations can, so
// this pulls everything needed to read them side by side: the live order, and for each
// claiming thread its classification, what the engine decided, and the actual emails.
//
// Read-only. Writes one JSON file. No OnSinch writes.
//   npx tsx scripts/export-contested-orders.ts [outfile]
// ============================================================================
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const base = (process.env.ONSINCH_BASE_URL || "").replace(/\/$/, "");
const key = (process.env.ONSINCH_API_KEY || "").trim();

const get = async (p: string): Promise<any> => {
  const r = await fetch(base + p, { headers: { Authorization: `apikey ${key}`, Accept: "application/json" } });
  if (!r.ok) return { data: [] };
  return r.json();
};

const OUT = process.argv[2] || "contested.json";
const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\r/g, "").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

(async () => {
  const rows = (await sql`select thread_id, state from conversation_state`) as Array<{ thread_id: string; state: any }>;

  const byOrder = new Map<number, string[]>();
  const stateOf = new Map<string, any>();
  for (const r of rows) {
    const s = typeof r.state === "string" ? JSON.parse(r.state) : (r.state ?? {});
    stateOf.set(r.thread_id, s);
    const id = Number(s.onsinch_order_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    byOrder.set(id, [...(byOrder.get(id) ?? []), r.thread_id]);
  }
  const contested = [...byOrder.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
  console.log(`contested orders: ${contested.length}`);

  // Company names, resolved per id. /companies?limit=200 returns the first page only, and
  // the ids here run to 652 — a bulk fetch silently yields null for everything past it,
  // which reads as "unknown client" rather than "not fetched".
  const companies = new Map<number, string>();
  const companyName = async (id: unknown): Promise<string | null> => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (companies.has(n)) return companies.get(n)!;
    const row = (await get(`/companies?id[eq]=${n}&limit=1`)).data?.[0];
    const name = row?.name ? String(row.name) : null;
    if (name) companies.set(n, name);
    return name;
  };

  const out: any[] = [];
  for (const [order_id, threads] of contested) {
    const live = (await get(`/orders?id[eq]=${order_id}&limit=1&with=Job`)).data?.[0] ?? null;
    const job = live ? (Array.isArray(live.Job) ? live.Job[0] : live.Job) ?? null : null;

    const claims: any[] = [];
    for (const tid of threads) {
      const s = stateOf.get(tid) ?? {};
      const msgs = (await sql`
        select message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
        from thread_messages where thread_id = ${tid}
        order by date_iso asc limit 14`) as Array<any>;
      const d = s.desired_order ?? {};
      claims.push({
        thread_id: tid,
        subject: s.subject ?? msgs[0]?.subject ?? "",
        classification: s.classification ?? null,
        status: s.status ?? null,
        needs_human: !!s.needs_human,
        sender_email: s.sender_email ?? null,
        sender_domain: s.sender_domain ?? null,
        company_id: s.company_id ?? null,
        company: await companyName(s.company_id),
        place_id: s.place_id ?? null,
        order_number: s.onsinch_order_number ?? null,
        job_id: s.onsinch_job_id ?? null,
        notes: (s.notes ?? []).map((n: unknown) => clip(n, 400)),
        action_log: (s.order_action_log ?? []).map((a: any) => ({
          kind: a.kind, ok: a.ok, order_id: a.order_id ?? null,
          at: a.ts ? new Date(a.ts).toISOString() : null, error: clip(a.error, 200) || null,
        })),
        wanted: {
          name: clip(d.name, 160) || null,
          job_name: clip(d.job_name, 160) || null,
          company_id: d.company_id ?? null,
          blocks: (d.slot_teams ?? []).map((t: any) => ({
            name: clip(t.name, 120), size: t.size ?? null,
            beginning: t.beginning ?? null, end: t.end ?? null, place_id: t.place_id ?? null,
          })),
        },
        message_count: msgs.length,
        messages: msgs.map((mm) => ({
          from: mm.from_address, to: clip(mm.to_addresses, 160),
          at: mm.date_iso, subject: clip(mm.subject, 160),
          mine: !!mm.is_from_spartan, body: clip(mm.body, 1800),
        })),
      });
    }

    out.push({
      order_id,
      live: live
        ? {
            number: live.number, name: live.name, company_id: live.company_id,
            company: await companyName(live.company_id),
            user_id: live.user_id, creator: live.creator, status: live.status,
            quote: live.quote, provisional: live.provisional,
            happening: live.happening, created: live.created,
            specification: clip(live.specification, 400),
            job: job ? { id: job.id, name: job.name, min_beginning: job.min_beginning, max_end: job.max_end } : null,
          }
        : null,
      claims,
    });
    console.log(`  #${order_id} ${live ? "live" : "GONE"} — ${threads.length} threads`);
  }

  writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), orders: out }, null, 1), "utf8");
  console.log(`\nwrote ${OUT}`);
})();
