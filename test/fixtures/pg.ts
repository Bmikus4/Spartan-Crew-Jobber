// ============================================================================
// The app's own SQL against PGlite, in this process. Import this BEFORE any app module.
// ----------------------------------------------------------------------------
// @neondatabase/serverless's neon() is replaced in the module cache, so whatever connection
// string a module reads, its queries run in memory: a test written on this cannot reach the
// production database (the addendum's F7: ten suite files wrote tagged rows to it). `fault`
// makes chosen statements fail, to see what the app does when the database does.
// ============================================================================
/* eslint-disable @typescript-eslint/no-require-imports */
// Set, not deleted: scripts/_env.mjs fills only what is unset, so a deleted one comes back from
// .env.local in any child process a test spawns, and the child is not stubbed. "sim://pglite" is
// no connection string the real driver accepts, so a child that reaches it fails instead.
for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NO_SSL", "POSTGRES_PRISMA_URL", "STORAGE_DATABASE_URL"]) process.env[k] = "sim://pglite";

const pg = require("../../harness/sim/pg.ts");

/** A statement this returns true for fails instead of running. */
export const fault: { when: ((text: string) => boolean) | null } = { when: null };

function faulty(inner: any): any {
  const f: any = (strings: any, ...values: unknown[]) => {
    const text = typeof strings === "string" ? strings : strings.join("$?");
    if (fault.when?.(text)) return Promise.reject(new Error("injected database failure"));
    return inner(strings, ...values);
  };
  f.query = (text: string, params: unknown[] = []) => (fault.when?.(text) ? Promise.reject(new Error("injected database failure")) : inner.query(text, params));
  f.transaction = inner.transaction;
  return f;
}

const driver = require.resolve("@neondatabase/serverless");
require.cache[driver] = { id: driver, filename: driver, loaded: true, exports: { neon: (url?: string) => faulty(pg.neonShim(url)), neonConfig: {}, Pool: class {}, Client: class {} }, children: [], paths: [] } as any;

export const sql: any = faulty(pg.neonShim());
export const clock: { now: () => number; set: (ms: number) => void; iso: () => string } = pg.clock;
/** SQL's now() reads the same clock as clock.set, once this has run. */
export const syncSqlClock: () => Promise<void> = pg.syncSqlClock;
