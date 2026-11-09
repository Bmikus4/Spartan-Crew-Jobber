// ============================================================================
// Every stored reading gets its canonical ask (research build 2).
// ----------------------------------------------------------------------------
// v2_decisions.ask is derived-only: canonicalAsk() is a pure function of the row's stored
// interpretation, so this recomputes rather than invents, and rerunning it is safe. Rows with no
// interpretation (none/handoff before the reader) correctly stay NULL. New readings write the
// column themselves (process.ts recordDecision); this covers everything recorded before 110 ran.
//
//   npx tsx --env-file=.env.local scripts/backfill-asks.mts plan    read-only: counts of what a write would fill
//   npx tsx --env-file=.env.local scripts/backfill-asks.mts fill    writes ask where interpretation exists
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";
import { canonicalAsk, ASK_VERSION } from "../app/lib/v2/ask";
import { migrate } from "../app/lib/migrations";

loadEnv();
const mode = process.argv[2];
if (mode !== "plan" && mode !== "fill") {
  console.error("usage: backfill-asks.mts plan|fill");
  process.exit(2);
}
const sql: any = neon(requireEnv("DATABASE_URL").trim());

// plan mode must run before 110 has, so the ask filter only applies once the column exists.
const hasAsk = ((await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'v2_decisions' AND column_name = 'ask'`) as any[]).length > 0;
const rows = (hasAsk
  ? await sql`SELECT message_id, interpretation FROM v2_decisions
      WHERE interpretation IS NOT NULL AND (ask IS NULL OR ask->>'version' <> ${ASK_VERSION})`
  : await sql`SELECT message_id, interpretation FROM v2_decisions WHERE interpretation IS NOT NULL`) as any[];
let asks = 0, empty = 0;
const updates: Array<{ id: string; ask: string }> = [];
for (const r of rows) {
  const a = canonicalAsk(r.message_id, r.interpretation);
  if (!a) { empty++; continue; }
  asks += a.asks.length;
  updates.push({ id: r.message_id, ask: JSON.stringify(a) });
}
console.log(`${rows.length} readings without a current ask; ${updates.length} canonicalise (${asks} asks), ${empty} hold no grounded reading`);
if (mode === "plan") process.exit(0);

await migrate(sql);
for (let i = 0; i < updates.length; i += 100) {
  const batch = updates.slice(i, i + 100);
  await sql`UPDATE v2_decisions d SET ask = u.ask::jsonb
    FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS u(id text, ask text)
    WHERE d.message_id = u.id`;
}
const n = await sql`SELECT count(*) FILTER (WHERE ask IS NOT NULL) filled, count(*) FILTER (WHERE interpretation IS NOT NULL) readings FROM v2_decisions`;
console.log(`done: ${n[0].filled} of ${n[0].readings} readings carry an ask`);
