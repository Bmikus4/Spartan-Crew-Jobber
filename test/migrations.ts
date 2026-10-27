// ============================================================================
// One ordered, idempotent migrations module makes the whole schema, from empty and from today's shape.
// ----------------------------------------------------------------------------
// Addendum F44 (26 Oct): the schema was made at request time by 83 statements in 27 files, so nothing
// said what the database is, and a module's first use decided its tables. Now app/lib/migrations.ts
// holds them in order and migrate() runs each once, recorded in schema_migrations. Checked against
// production's own schema (names and types only, read-only, 27 Oct: test/fixtures/prod-schema-1027.json).
// Against PGlite (fixtures/pg.ts).
// npx tsx test/migrations.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { migrate, MIGRATIONS } from "../app/lib/migrations";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const columns = async () => new Map(((await sql`SELECT table_name AS t, column_name AS c, data_type AS type FROM information_schema.columns WHERE table_schema = 'public'`) as any[])
  .map((r) => [`${r.t}.${r.c}`, r.type]));
const indexes = async () => new Set(((await sql`SELECT indexname AS i FROM pg_indexes WHERE schemaname = 'public'`) as any[]).map((r) => r.i));

(async () => {
  console.log("\n[empty] every migration runs once, in order, and makes production's schema");
  const ran = await migrate(sql);
  ok(ran.length === MIGRATIONS.length, `all ${MIGRATIONS.length} ran on an empty database`, ran.length);
  ok(new Set(MIGRATIONS.map(([id]) => id)).size === MIGRATIONS.length, "every id is unique");
  const prod = JSON.parse(readFileSync("test/fixtures/prod-schema-1027.json", "utf8")) as { columns: Array<{ t: string; c: string; type: string }>; indexes: Array<{ t: string; i: string }> };
  const have = await columns(), idx = await indexes();
  const missing = prod.columns.filter((r) => !have.has(`${r.t}.${r.c}`)).map((r) => `${r.t}.${r.c}`);
  ok(missing.length === 0, `every one of production's ${prod.columns.length} columns exists`, missing);
  const retyped = prod.columns.filter((r) => have.has(`${r.t}.${r.c}`) && have.get(`${r.t}.${r.c}`) !== r.type).map((r) => `${r.t}.${r.c}: ${r.type} vs ${have.get(`${r.t}.${r.c}`)}`);
  ok(retyped.length === 0, "each with production's type", retyped);
  const noIndex = prod.indexes.map((r) => r.i).filter((i) => !idx.has(i));
  ok(noIndex.length === 0, `every one of production's ${prod.indexes.length} indexes exists`, noIndex);
  ok((await migrate(sql)).length === 0, "run again: nothing runs");

  console.log("\n[today's shape] a database that has the schema but no record of it");
  await sql`DROP TABLE schema_migrations`;
  const again = await migrate(sql).then((r) => r.length, (e) => `threw: ${(e as Error).message}`);
  ok(again === MIGRATIONS.length, "every statement runs over the existing tables without an error, and is recorded", again);
  ok(JSON.stringify([...(await columns())].sort()) === JSON.stringify([...have].sort()), "and the schema is unchanged");

  console.log("\n[the pinned driver] a connection with no .query, as @neondatabase/serverless 0.10 gives production");
  await sql`DROP TABLE schema_migrations`;
  const bare = (text: string, params?: unknown[]) => sql(text, params ?? []);
  const viaCall = await migrate(bare as any).then((r) => r.length, (e) => `threw: ${(e as Error).message}`);
  ok(typeof (bare as any).query === "undefined" && viaCall === MIGRATIONS.length, "migrate runs through the call form sql(text, params)", viaCall);

  console.log("\n[one place] no module makes its own tables any more");
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
  const stray = walk("app").filter((f) => !f.replace(/\\/g, "/").endsWith("lib/migrations.ts") && /sql`\s*(?:CREATE|ALTER|DROP|DO)\b/.test(readFileSync(f, "utf8")));
  ok(stray.length === 0, "every schema statement is in app/lib/migrations.ts", stray);

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
