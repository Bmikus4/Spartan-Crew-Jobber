// ============================================================================
// The write and auth guards no test caught when each was removed (audit, 3 Nov: 9 of 34 guard mutants survived the
// whole suite). Each case below fails when its guard goes.
// npx tsx --require ./test/fixtures/pg.ts test/guardsPinned.ts
// ============================================================================
import { NextRequest } from "next/server";
import { sql } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { saveSettings } from "../app/lib/settingsDb";
import { botWrites, decideMessage, type DecideDeps } from "../app/lib/v2/process";
import { runOp, preflight, throwStatus } from "../app/lib/v2/bot/run";
import { ledgerIntent, ledgerSet } from "../app/lib/v2/bot/db";
import { opKey, type Op } from "../app/lib/v2/bot/ops";
import { authorizeMachineCall, authorizeBotCall, authorizeCronCall } from "../app/lib/apiAuth";
import { middleware } from "../middleware";
import type { World } from "../app/lib/v2/interpret/plan";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const env = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

(async () => {
  await ensureSchema(sql as any);

  console.log("\n[W1] both write keys: Settings on is not enough without SPARTAN_WRITES=live");
  {
    await saveSettings({ bot_writes_enabled: true });
    env("SPARTAN_WRITES", "off");
    ok(await botWrites() === false, "Settings on, the server switch off: no writes");
    env("SPARTAN_WRITES", "live");
    ok(await botWrites() === true, "both on: writes (the control)");
    env("SPARTAN_WRITES", undefined);
    await saveSettings({ bot_writes_enabled: false });
  }

  console.log("\n[B1] a seen op key never runs again");
  {
    const op: Op = { kind: "set_po", order_id: 16100, po: "PO-1" } as Op;
    const key = opKey("guards", op);
    await ledgerIntent(key, "guards", op.kind, op);
    await ledgerSet(key, "verified", {});
    const r = await runOp("guards", op, { testOnly: true });
    ok(r.status === "seen" && /already verified/.test(r.reasons.join(" ")), "the ledger answers before anything else runs", r);
  }

  console.log("\n[B2, B3] bench mode writes only on TEST 515");
  {
    ok((await preflight({ kind: "create_order", company_id: "99" } as Op, null, true)).some((x) => /bench mode/.test(x)), "a create for another company is refused in bench mode");
    ok((await preflight({ kind: "create_order", company_id: "515" } as Op, null, true)).every((x) => !/bench mode/.test(x)), "a create on TEST 515 is not (the control)");
    ok((await preflight({ kind: "set_po", order_id: 1, po: "x" } as Op, { id: 1, company_id: 99, Job: [] }, true)).some((x) => /bench mode/.test(x)), "an edit to another company's order is refused in bench mode");
    ok((await preflight({ kind: "set_po", order_id: 1, po: "x" } as Op, { id: 1, company_id: 515, Job: [] }, true)).length === 0, "an edit on TEST 515 is not (the control)");
  }

  console.log("\n[B4] a throw after the browser opened is unknown, never retried");
  {
    ok(throwStatus("browser") === "unknown" && throwStatus("pre") === "blocked", "after the save may have gone out: unknown; before it: blocked");
  }

  console.log("\n[P2] planned again, a write on an order staff changed since the email is staff's (V22)");
  {
    const G = <T,>(value: T, quote: string) => ({ value, quote });
    const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
    const slot = { id: 61, beginning: "2026-11-20T08:00:00+00:00", end: "2026-11-20T16:00:00+00:00", size: 4, profession_id: 1, role: 0, SlotLocation: { place_id: 29 } };
    const R = { id: 16100, number: "11100", company_id: 137, creator: 110, created: "2026-10-15T10:00:00Z", Job: [{ id: 16101, SlotTeam: [{ id: 501, name: "Crew", Slot: [slot] }] }] };
    const world = { companies: async () => [{ id: 137, name: "Event Concept", Client: [{ id: 1, email: "crew@eventconcept.com" }] }],
      placesNamed: async () => [{ id: 29, name: "Hall" }], allPlaces: async () => [{ id: 29, name: "Hall" }],
      companyOrders: async () => [R], orderByNumber: async () => R, orderById: async () => R } as World;
    const reqs = [{ ...base, action: "change_times", order: "R11100", target: { quote: "Friday 20/11", date: G("2026-11-20", "20/11"), start: null }, start: G("10:00", "10:00"), end: G("18:00", "18:00") }];
    const run = (again: boolean) => decideMessage(
      { message_id: "p2", thread_id: "tp2", from_address: "crew@eventconcept.com", date_iso: "2026-10-15T09:00:00Z", subject: "R11100", body: "For R11100 on Friday 20/11 can the crew do 10:00 to 18:00 please", is_from_spartan: false },
      { extract: (async () => ({ x: { intent: "change", po: null, note: "", requests: reqs }, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
        world, threadOrderId: async () => null, run: null, record: async () => {}, trace: () => {}, ...(again ? { again: true } : {}) } as DecideDeps);
    const d = (await run(true)).decision as any;
    ok(d.kind === "none" && /staff changed R11100 after the email/.test(d.reason), "planned again: none, staff's", d);
  }

  console.log("\n[A3] an unset secret never matches an empty header, in production");
  {
    const nodeEnv = process.env.NODE_ENV;
    env("NODE_ENV", "production"); env("AUTH_REQUIRED", undefined);
    for (const k of ["N8N_WEBHOOK_SECRET", "BOT_SECRET", "CRON_SECRET"]) env(k, undefined);
    const bare = new Request("https://x.example/api/x", { method: "POST" });
    ok(!authorizeMachineCall(bare).ok, "the machine gate refuses");
    ok(!authorizeBotCall(bare).ok, "the bot gate refuses");
    ok(!authorizeCronCall(bare).ok, "the cron gate refuses");
    env("NODE_ENV", nodeEnv);
  }

  console.log("\n[MW1, MW2] the middleware: previews sign in; an unset INTERNAL_API_SECRET opens nothing");
  {
    env("AUTH_REQUIRED", undefined); env("INTERNAL_API_SECRET", undefined);
    env("VERCEL_ENV", "preview");
    const r1 = await middleware(new NextRequest("https://preview.example/api/feed"));
    ok(r1.status === 401, "a preview asks for a session even without AUTH_REQUIRED", r1.status);
    env("VERCEL_ENV", undefined); env("AUTH_REQUIRED", "true");
    const r2 = await middleware(new NextRequest("https://prod.example/api/feed", { headers: { "x-internal-secret": "" } }));
    ok(r2.status === 401, "with the internal secret unset, an empty header is no pass", r2.status);
    env("AUTH_REQUIRED", undefined);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
