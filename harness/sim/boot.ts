// ============================================================================
// How a simulator process starts: refuse production credentials, point the app at the fakes, and put
// the simulated database, clock, network and browser bot in place before any app module loads.
// Used by the production replay (run.mts) and the generated business (harness/gen/run.mts).
// ============================================================================
/* eslint-disable @typescript-eslint/no-require-imports */
import { resolve } from "node:path";

export function bootSim(): { pg: any; os: any; net: any; bot: any } {
  const req = require;
  for (const k of ["DATABASE_URL", "POSTGRES_URL", "ONSINCH_API_KEY", "OPENROUTER_API_KEY", "N8N_API_KEY", "BOT_SECRET"]) {
    if (process.env[k] && !/^sim/.test(process.env[k]!)) { console.error(`refusing to run: ${k} is set in this process (start without --env-file)`); process.exit(2); }
  }
  Object.assign(process.env, {
    SPARTAN_WRITES: "live", DATABASE_URL: "sim://pglite", ONSINCH_BASE_URL: "https://spartancrew.onsinch.com/api/v1", ONSINCH_API_KEY: "sim",
    OPENROUTER_API_KEY: "sim", N8N_WEBHOOK_SECRET: "sim-secret", BOT_SECRET: "sim", SPARTAN_INTERPRET_MODEL: process.env.SPARTAN_INTERPRET_MODEL ?? "recorded",
    // Not "local": the TV hides a workstation's decisions, and every simulated one would vanish.
    VERCEL_GIT_COMMIT_SHA: "sim",
  });
  delete process.env.VERCEL; delete process.env.SPARTAN_ERROR_NOTIFY;
  // By absolute path, so the app and the harness hold the same instance of each fake.
  const pg = req(resolve(__dirname, "pg.ts")), os = req(resolve(__dirname, "onsinch.ts")), net = req(resolve(__dirname, "net.ts")), bot = req(resolve(__dirname, "bot.ts"));
  pg.installDate();
  net.installFetch();
  // The two modules that would reach out: the database driver and the browser bot.
  const stub = (path: string, exports: unknown) => { req.cache[path] = { id: path, filename: path, loaded: true, exports, children: [], paths: [] } as any; };
  stub(req.resolve("@neondatabase/serverless"), { neon: pg.neonShim, neonConfig: {}, Pool: class {}, Client: class {} });
  stub(resolve("app/lib/v2/bot/run.ts"), bot);
  return { pg, os, net, bot };
}
