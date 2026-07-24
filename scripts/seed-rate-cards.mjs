// ============================================================================
// PHASE B2 — Seed Neon `rate_cards` from data/rate-map.json (rate-study output).
// Source = 'history'. The Tracy admin export (B3) later upserts source='ops',
// which outranks 'history' (guard in the ON CONFLICT WHERE). Idempotent.
//
// Run:  node scripts/seed-rate-cards.mjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { loadEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const url = (
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.STORAGE_DATABASE_URL ||
  ""
).trim();
if (!url) {
  console.error("MISSING ENV: DATABASE_URL (or POSTGRES_URL). Check .env.local.");
  process.exit(2);
}

const mapPath = join(ROOT_DIR, "data", "rate-map.json");
let doc;
try {
  doc = JSON.parse(readFileSync(mapPath, "utf8"));
} catch {
  console.error(`No ${mapPath}. Run: node scripts/rate-study.mjs first.`);
  process.exit(2);
}

const sql = neon(url);

const rows = Object.entries(doc)
  .filter(([k]) => !k.startsWith("_"))
  .map(([company_id, v]) => ({
    company_id: Number(company_id),
    card: Number(v.card),
    source: "history",
    share: v.share ?? null,
    n: v.n ?? null,
  }))
  .filter((r) => Number.isInteger(r.company_id) && Number.isInteger(r.card));

(async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS rate_cards (
      company_id INT PRIMARY KEY,
      card       INT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'history',
      share      REAL,
      n          INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  let written = 0;
  for (const r of rows) {
    const res = await sql`
      INSERT INTO rate_cards (company_id, card, source, share, n, updated_at)
      VALUES (${r.company_id}, ${r.card}, ${r.source}, ${r.share}, ${r.n}, now())
      ON CONFLICT (company_id) DO UPDATE SET
        card = EXCLUDED.card, source = EXCLUDED.source,
        share = EXCLUDED.share, n = EXCLUDED.n, updated_at = now()
      WHERE 1 >= CASE rate_cards.source WHEN 'ops' THEN 2 ELSE 1 END
      RETURNING company_id`;
    if (res.length) written++;
  }

  const total = (await sql`SELECT count(*)::int AS c FROM rate_cards`)[0].c;
  console.log(
    `Seeded ${written}/${rows.length} history cards (skipped rows already 'ops'-owned). rate_cards now holds ${total} companies.`
  );
})().catch((e) => {
  console.error("seed failed:", e.message);
  process.exit(1);
});
