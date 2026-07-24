// Neon-backed rate_cards store — the seeded ground truth for INVARIANT I1
// (every order carries an explicitly resolved Job.pricelist_category_id).
// Same connect/ensure pattern as metricsDb. Phase B seeds this from real order
// history (source='history'); a Tracy admin export later upserts source='ops'
// (authoritative) over the top. Phase A's rates.ts reads getRateCard() FIRST,
// before falling back to a live history scan.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function connString(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_DATABASE_URL ||
    process.env.STORAGE_POSTGRES_URL ||
    ""
  ).trim();
}

function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = connString();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

export function rateCardsDbEnabled(): boolean {
  return !!connString();
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS rate_cards (
      company_id INT PRIMARY KEY,
      card       INT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'history',
      share      REAL,
      n          INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  _ready = true;
}

export type RateSource = "history" | "ops";

export interface RateCardRow {
  company_id: number;
  card: number;
  source: RateSource;
  share: number | null;
  n: number | null;
}

/**
 * Seeded lookup for a company. 'ops' (Tracy export) always beats 'history'
 * because the upsert only overwrites when the incoming source ranks >=; the
 * row already holds the winner, so a plain read is authoritative.
 */
export async function getRateCard(company_id: number): Promise<RateCardRow | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT company_id, card, source, share, n
      FROM rate_cards WHERE company_id = ${company_id} LIMIT 1`) as RateCardRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.error("[rate_cards] read failed", company_id, err);
    return null;
  }
}

const RANK: Record<RateSource, number> = { history: 1, ops: 2 };

/**
 * Bulk upsert with a source-precedence guard done entirely in SQL: 'ops'
 * (Tracy export) overwrites 'history'; 'history' never clobbers 'ops'.
 * Returns the number of rows actually written/updated.
 */
export async function upsertRateCards(rows: RateCardRow[]): Promise<number> {
  const sql = db();
  if (!sql || !rows.length) return 0;
  await ensure(sql);
  let written = 0;
  for (const r of rows) {
    const incoming = RANK[r.source] ?? 0;
    const res = (await sql`
      INSERT INTO rate_cards (company_id, card, source, share, n, updated_at)
      VALUES (${r.company_id}, ${r.card}, ${r.source}, ${r.share}, ${r.n}, now())
      ON CONFLICT (company_id) DO UPDATE SET
        card = EXCLUDED.card, source = EXCLUDED.source,
        share = EXCLUDED.share, n = EXCLUDED.n, updated_at = now()
      WHERE ${incoming} >= CASE rate_cards.source WHEN 'ops' THEN 2 ELSE 1 END
      RETURNING company_id`) as { company_id: number }[];
    if (res.length) written++;
  }
  return written;
}

export async function allRateCards(): Promise<RateCardRow[]> {
  const sql = db();
  if (!sql) return [];
  try {
    await ensure(sql);
    return (await sql`
      SELECT company_id, card, source, share, n FROM rate_cards
      ORDER BY company_id`) as RateCardRow[];
  } catch {
    return [];
  }
}
