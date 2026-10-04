// ============================================================================
// Venue sink rate: how many orders the engine wrote landed on a placeholder venue.
// ----------------------------------------------------------------------------
// Read-only, free: one SELECT on order_records, no OnSinch, no model calls.
//
// The deferred figure in S-0006 ("venue sink 8.6%") came from build-testset.ts, whose
// existence check pages the whole live /orders list. This reads only what the engine
// recorded when it wrote, which is the population the venue resolver is answerable for.
// Rows with id_source 'matched' are staff- or client-made orders the engine later bound
// to; their venue was a human's choice, so they are reported but are not the rate.
//
//   npx tsx --env-file=.env.local scripts/venue-sink.ts          print
//   npx tsx --env-file=.env.local scripts/venue-sink.ts --gate   also hand it to the next gate
//
// --env-file, never scripts/_q.mjs: a malformed URL makes the Neon driver print the whole
// connection string, password included, and _q.mjs hand-parses .env.local.
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { PLACEHOLDER_PLACE_IDS } from "../app/lib/engine/resolver";
import { recordMeasurement } from "./_gateMeasure.mjs";

const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
const redact = (s: string) => s.replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]");
const wilson = (k: number, n: number) => {
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d].map((x) => Math.round(x * 1000) / 10);
};

(async () => {
  try {
    if (!/^postgres(ql)?:\/\/[^\s'"]+$/.test(url)) throw new Error("database url missing or malformed (not printed); run with --env-file=.env.local");
    const sql = neon(url);
    const ph = [...PLACEHOLDER_PLACE_IDS];
    const rows = (await sql`
      SELECT id_source, count(*)::int AS orders,
             count(*) FILTER (WHERE place_id = ANY(${ph}))::int AS sunk,
             min(created_at) AS first, max(created_at) AS last
      FROM order_records GROUP BY id_source ORDER BY id_source`) as Array<{ id_source: string; orders: number; sunk: number; first: string; last: string }>;
    const written = rows.find((r) => r.id_source === "api_response");
    const matched = rows.find((r) => r.id_source === "matched");
    if (!written || !written.orders) throw new Error("no engine-written orders in order_records");
    const [lo, hi] = wilson(written.sunk, written.orders);
    const m = {
      dataset: `order_records id_source=api_response, ${new Date(written.first).toISOString().slice(0, 10)} to ${new Date(written.last).toISOString().slice(0, 10)}, read ${new Date().toISOString().slice(0, 10)}`,
      instrument: "scripts/venue-sink.ts: one SELECT, no OnSinch, no model",
      placeholder_place_ids: ph,
      engine_orders: written.orders,
      on_placeholder: written.sunk,
      sink_rate_pct: Math.round((written.sunk / written.orders) * 1000) / 10,
      wilson95_pct: [lo, hi],
      matched_orders_not_the_rate: matched ? { orders: matched.orders, on_placeholder: matched.sunk } : null,
    };
    console.log(JSON.stringify(m, null, 1));
    if (process.argv.includes("--gate")) console.log("handed to the next gate:", recordMeasurement("venue_sink", m));
  } catch (e) {
    console.error("venue-sink failed:", redact(String((e as Error)?.message ?? e)).slice(0, 300));
    process.exit(1);
  }
})();
