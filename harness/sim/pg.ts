// ============================================================================
// The simulator's database and clock.
// ----------------------------------------------------------------------------
// PGlite is Postgres compiled to run inside this process: the app's own SQL (its CREATE TABLE
// IF NOT EXISTS, its jsonb, its ANY(array)) runs unchanged against it, and nothing reaches the
// production database. `neonShim` stands in for @neondatabase/serverless's `neon(url)`: the
// same call forms (tagged template, and sql(text, params)) and the same row shapes (int8 and
// numeric as strings, as Neon gives them).
//
// ONE CLOCK FOR BOTH SIDES. The app reads time from JS (Date.now, new Date()) and from SQL
// (now(), every DEFAULT now()). Both read the simulated clock: JS through a Date whose
// no-argument forms return it, SQL through public.now() ahead of pg_catalog's on the search
// path. A held link's "30 minutes" or a retry's "6 hours" then pass in simulated time.
// ============================================================================
import { PGlite } from "@electric-sql/pglite";

const RealDate = Date;
let simNow = RealDate.now();
export const clock = {
  now: () => simNow,
  set(ms: number) { simNow = ms; },
  iso: () => new RealDate(simNow).toISOString(),
};

export function installDate(): void {
  class SimDate extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(simNow); else super(...(a as [any])); }
    static now() { return simNow; }
  }
  (globalThis as any).Date = SimDate;
}

let db: PGlite;
let ready: Promise<void> | null = null;

export async function boot(): Promise<void> {
  ready ??= (async () => {
    // PGlite's start-up ends in Postgres's own exit, and emscripten's quit_ writes that 0 to
    // process.exitCode. A test that had failed before or during the start-up then exited 0 and
    // test/all.ts counted it passed (test/exitCodeSurvivesPglite.ts).
    // Node will not let exitCode be redefined, but quit_ reaches it through the global `process`, so
    // for the start-up the global is a view on which a 0 cannot overwrite a failure.
    const real = process;
    (globalThis as any).process = new Proxy(real, {
      get: (t, k) => { const v = Reflect.get(t, k, t); return typeof v === "function" ? v.bind(t) : v; },
      set: (t, k, v) => (k === "exitCode" && !Number(v) && Number(t.exitCode) ? true : Reflect.set(t, k, v, t)),
    });
    try {
      db = new PGlite(undefined as any, { parsers: { 20: (x: string) => x, 1700: (x: string) => x } } as any);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS public.sim_clock (t timestamptz NOT NULL);
        INSERT INTO public.sim_clock SELECT now() WHERE NOT EXISTS (SELECT 1 FROM public.sim_clock);
        CREATE OR REPLACE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT t FROM public.sim_clock LIMIT 1';
        SET search_path TO public, pg_catalog;`);
    } finally {
      (globalThis as any).process = real;
    }
  })();
  return ready;
}

export async function syncSqlClock(): Promise<void> {
  await boot();
  await db.query(`UPDATE public.sim_clock SET t = $1`, [new RealDate(simNow).toISOString()]);
}

/** Every statement the app sent, counted by its first words (for the report). */
export const sqlSeen = new Map<string, number>();
/** The message a decision is being made on, read off the app's own SELECT (net.ts reads it). */
export const current = { message_id: null as string | null };

async function run(text: string, params: unknown[]): Promise<any[]> {
  await boot();
  const head = text.trim().replace(/\s+/g, " ").slice(0, 40);
  sqlSeen.set(head, (sqlSeen.get(head) ?? 0) + 1);
  if (/FROM thread_messages WHERE message_id = \$1/.test(text.replace(/\s+/g, " "))) current.message_id = String(params[0]);
  const r = await db.query(text, params.map((p) => (p instanceof RealDate ? p.toISOString() : p)));
  return r.rows as any[];
}

/** The `neon(url)` replacement: a tagged template, or sql(text, params). */
export function neonShim(_url?: string): any {
  const sql: any = (strings: any, ...values: unknown[]) => {
    if (typeof strings === "string") return run(strings, (values[0] as unknown[]) ?? []);
    let text = "";
    strings.forEach((s: string, i: number) => { text += s + (i < values.length ? `$${i + 1}` : ""); });
    return run(text, values);
  };
  sql.query = (text: string, params: unknown[] = []) => run(text, params);
  sql.transaction = async (qs: Promise<any>[]) => Promise.all(qs);
  return sql;
}
