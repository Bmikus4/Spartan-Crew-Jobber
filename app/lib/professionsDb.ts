// ============================================================================
// The tenant's profession list, cached where the engine can reach it.
// ----------------------------------------------------------------------------
// Ben, Q11: the learned profession list lives in the tool, in Neon, with an alias
// store beside it in the shape of the company-alias mechanism that already works.
// That second half needs no new code at all — entity_aliases already keys on
// (kind, alias_norm), so professions become a third kind and inherit the whole
// human/exact/fuzzy safety story unchanged.
//
// This half is the list itself. It is small (43 rows, one page) and nearly static,
// but it cannot be fetched on the request path: resolution has to work when OnSinch
// is slow or down, and an enquiry that resolves every profession to Crew because a
// list call timed out is worse than one that fails loudly.
//
// So: OnSinch is the source, Neon is the cache, and data/professions.json is the
// floor under both — the list as it stood when this was written, committed, so the
// resolver and its tests have something to read with no network and no database.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { ProfessionRec } from "./engine/professions";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS onsinch_professions (
      id          INT PRIMARY KEY,
      name        TEXT NOT NULL,
      alias       TEXT,
      description TEXT,
      -- Deleted rows are STORED, not dropped. They still come back from OnSinch and
      -- the resolver has to know they are unbookable; a row missing from the cache
      -- is indistinguishable from a row we never fetched.
      deleted     BOOLEAN NOT NULL DEFAULT false,
      synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  _ready = true;
}

/** Replace the cached list with what OnSinch just returned. */
export async function storeProfessions(rows: ProfessionRec[]): Promise<number> {
  const sql = db();
  if (!sql || !rows.length) return 0;
  await ensure(sql);
  for (const p of rows) {
    await sql`
      INSERT INTO onsinch_professions (id, name, alias, description, deleted, synced_at)
      VALUES (${p.id}, ${p.name}, ${p.alias ?? null}, ${p.description ?? null}, ${!!p.deleted}, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, alias = EXCLUDED.alias, description = EXCLUDED.description,
        deleted = EXCLUDED.deleted, synced_at = now()`;
  }
  return rows.length;
}

/**
 * The list, cache first. Never throws and never returns empty: a database that is
 * unreachable falls through to the committed list rather than handing the resolver
 * nothing, which would book every profession as Crew without saying so.
 */
export async function loadProfessions(fallback: ProfessionRec[]): Promise<ProfessionRec[]> {
  const sql = db();
  if (!sql) return fallback;
  try {
    await ensure(sql);
    const rows = (await sql`SELECT id, name, alias, description, deleted FROM onsinch_professions`) as unknown as ProfessionRec[];
    return rows.length ? rows : fallback;
  } catch {
    return fallback;
  }
}
