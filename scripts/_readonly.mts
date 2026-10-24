// ============================================================================
// The database for a measurement script: every query inside a READ ONLY transaction.
// ----------------------------------------------------------------------------
// The addendum's rule for scripts run against real data (23 Oct): never on production's URL with
// write access; a Neon branch or a read-only role. The project's Neon is reached through Vercel
// and neither was set up, so the scripts that measure (week-review, ops-truth, score-vs-ops,
// real-email-scoreboard) run each statement in a transaction Postgres itself holds read-only:
// any INSERT, UPDATE, DELETE or DDL is refused by the server, whatever the script's code says.
// proveReadOnly() runs first and shows the refusal; a script that cannot show it stops.
// ============================================================================
import { neon } from "@neondatabase/serverless";

export type Ro = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

export function readOnlySql(url = process.env.DATABASE_URL || ""): Ro {
  const sql: any = neon(url.trim());
  return (strings, ...values) => sql.transaction([sql(strings, ...values)], { readOnly: true }).then((r: any[]) => r[0] as any[]);
}

/** A harmless write (it matches no row) must be refused by Postgres, or nothing is measured. */
export async function proveReadOnly(ro: Ro): Promise<string> {
  try {
    await ro`UPDATE v2_decisions SET kind = kind WHERE false`;
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/read-only transaction/i.test(m)) return m;
    throw new Error(`the write probe failed for another reason, so read-only is not shown: ${m.slice(0, 160)}`);
  }
  throw new Error("a write was accepted: this connection is not read-only, and nothing is measured");
}
