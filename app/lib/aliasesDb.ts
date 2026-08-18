// ============================================================================
// Names we have seen before, and the OnSinch id they turned out to mean.
// ----------------------------------------------------------------------------
// Resolution today re-derives everything from scratch on every email: pull all 756
// companies and 6,829 places, normalise, match. That is right — OnSinch's search is
// non-fuzzy and cannot be trusted to find a company by a name a client typed — but it
// means the system never gets better at the names it has already seen. "Event Concept
// Ltd", "EC", "eventconcept" each get solved again from first principles, and the
// bounded fallback in resolve.ts refuses the ambiguous ones every single time.
//
// This is the memory. An alias is a normalised string from an email plus the id it
// resolved to, and HOW it was learned. That last column is the whole safety story:
//
//   human  a person confirmed it        -> resolves automatically, highest priority
//   exact  an exact-match resolution    -> resolves automatically; it is a cache of a
//                                          deterministic answer, not a new judgement
//   fuzzy  the bounded token fallback   -> RECORDED ONLY. Never resolves on its own.
//
// The reason for that split is the failure mode of a learning system: one wrong
// resolution becomes permanent and then confirms itself, and a fuzzy match is exactly
// the kind that is sometimes wrong. So fuzzy aliases accumulate as SUGGESTIONS for a
// human to accept, and until someone does, they change nothing.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// "profession" is the third kind and needs nothing else: the table already keys on
// (kind, alias_norm), so a learned wording for a profession inherits the whole
// human/exact/fuzzy story above unchanged (Ben, Q11 — an alias store "in the shape
// of the company-alias mechanism that already works").
export type AliasKind = "company" | "place" | "profession";
export type AliasSource = "human" | "exact" | "fuzzy";

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
    CREATE TABLE IF NOT EXISTS entity_aliases (
      kind        TEXT NOT NULL,
      alias_norm  TEXT NOT NULL,
      entity_id   INT  NOT NULL,
      source      TEXT NOT NULL,
      seen_count  INT  NOT NULL DEFAULT 1,
      raw_example TEXT,
      first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, alias_norm)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS entity_aliases_entity ON entity_aliases (kind, entity_id)`;
  await sql`CREATE INDEX IF NOT EXISTS entity_aliases_source ON entity_aliases (source)`;
  _ready = true;
}

/** Rank so a promotion is possible and a demotion is not. */
const RANK: Record<AliasSource, number> = { fuzzy: 1, exact: 2, human: 3 };

export interface AliasRow {
  kind: AliasKind;
  alias_norm: string;
  entity_id: number;
  source: AliasSource;
  seen_count: number;
  raw_example?: string;
}

/**
 * Record that `alias_norm` meant `entity_id`.
 *
 * Idempotent on (kind, alias_norm). A repeat sighting bumps the counter. A sighting
 * from a BETTER source promotes the row; a weaker one never demotes it, so a fuzzy
 * match cannot undo a human's decision.
 *
 * Conflict — the same alias resolving to a different id — is resolved in favour of the
 * stronger source, and left alone when the incoming source is weaker. A fuzzy match
 * disagreeing with a human is not new information.
 */
export async function recordAlias(a: {
  kind: AliasKind; alias_norm: string; entity_id: number; source: AliasSource; raw_example?: string;
}): Promise<void> {
  const sql = db();
  if (!sql || !a.alias_norm || !Number.isInteger(a.entity_id)) return;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO entity_aliases (kind, alias_norm, entity_id, source, raw_example)
      VALUES (${a.kind}, ${a.alias_norm}, ${a.entity_id}, ${a.source}, ${a.raw_example ?? null})
      ON CONFLICT (kind, alias_norm) DO UPDATE
        SET seen_count = entity_aliases.seen_count + 1,
            last_seen  = now(),
            -- Promote only. The CASE is what stops a fuzzy sighting overwriting the id a
            -- human confirmed, which is the one way a learning store poisons itself.
            entity_id  = CASE WHEN ${RANK[a.source]} >= (
                                CASE entity_aliases.source WHEN 'human' THEN 3 WHEN 'exact' THEN 2 ELSE 1 END)
                              THEN EXCLUDED.entity_id ELSE entity_aliases.entity_id END,
            source     = CASE WHEN ${RANK[a.source]} > (
                                CASE entity_aliases.source WHEN 'human' THEN 3 WHEN 'exact' THEN 2 ELSE 1 END)
                              THEN EXCLUDED.source ELSE entity_aliases.source END`;
  } catch (err) {
    // Learning is an optimisation. A resolution that already worked must not fail
    // because the memory of it could not be written.
    console.error("[aliases] record failed", a.kind, a.alias_norm, err);
  }
}

/**
 * The id this name resolved to before, or null.
 *
 * Only 'human' and 'exact' answer. A fuzzy alias is stored but deliberately invisible
 * here — it exists to be confirmed, not to be trusted.
 */
export async function lookupAlias(kind: AliasKind, alias_norm: string): Promise<number | null> {
  const sql = db();
  if (!sql || !alias_norm) return null;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT entity_id FROM entity_aliases
      WHERE kind = ${kind} AND alias_norm = ${alias_norm} AND source IN ('human', 'exact')
      LIMIT 1`) as { entity_id: number }[];
    return rows[0]?.entity_id ?? null;
  } catch {
    return null;
  }
}

/** Aliases waiting for a human, newest and most-seen first — the confirm queue. */
export async function pendingAliases(kind?: AliasKind, limit = 100): Promise<AliasRow[]> {
  const sql = db();
  if (!sql) return [];
  try {
    await ensure(sql);
    const k = kind ?? null;
    return (await sql`
      SELECT kind, alias_norm, entity_id, source, seen_count, raw_example
      FROM entity_aliases
      WHERE source = 'fuzzy' AND (${k}::text IS NULL OR kind = ${k})
      ORDER BY seen_count DESC, last_seen DESC
      LIMIT ${limit}`) as unknown as AliasRow[];
  } catch {
    return [];
  }
}

/** A human accepted (or corrected) a suggestion. This is the only path to 'human'. */
export async function confirmAlias(kind: AliasKind, alias_norm: string, entity_id: number): Promise<void> {
  await recordAlias({ kind, alias_norm, entity_id, source: "human" });
}

export async function aliasStats(): Promise<{ total: number; bySource: Array<{ source: string; n: number }> }> {
  const sql = db();
  if (!sql) return { total: 0, bySource: [] };
  try {
    await ensure(sql);
    const [t] = (await sql`SELECT COUNT(*)::int n FROM entity_aliases`) as { n: number }[];
    const by = (await sql`
      SELECT source, COUNT(*)::int n FROM entity_aliases GROUP BY source ORDER BY n DESC`) as unknown as Array<{ source: string; n: number }>;
    return { total: t?.n ?? 0, bySource: by };
  } catch {
    return { total: 0, bySource: [] };
  }
}
