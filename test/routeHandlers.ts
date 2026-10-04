// ============================================================================
// SP-50: a handler test for each live route that had none.
// ----------------------------------------------------------------------------
// health/intake, settings, confirm-order and dedupe were tested only through their libs, or
// not at all; the routes' own decisions (which status, what is reported, what fails open)
// were never run. Each handler is in app/lib/routes with its IO injected; the routes keep
// only their auth gate (pinned by test/writeRoutesAuthorised.ts and machineRouteAuth.ts).
// n8n-inbound and reconcile have their own files.
//
// Offline.  npx tsx test/routeHandlers.ts
// ============================================================================
import { handleIntakeHealth } from "../app/lib/routes/healthIntake";
import { handleSettingsGet, handleSettingsPost } from "../app/lib/routes/settings";
import { handleConfirmOrder } from "../app/lib/routes/confirmOrder";
import { handleDedupe } from "../app/lib/routes/dedupe";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const req = (url: string, body?: unknown) =>
  new Request(url, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function main() {
  console.log("\n[1] health/intake: a stale reading in working hours reports once; a fresh one does not");
  {
    const monday11 = Date.parse("2026-10-05T10:00:00Z"); // 11:00 London (BST)
    const reports: string[] = [];
    const io = (last: number | null) => ({ lastInboundAt: async () => last, now: () => monday11, report: (async (a: any) => { reports.push(a.route); return false; }) as any });
    const stale = await (await handleIntakeHealth(req("http://x/api/health/intake"), io(monday11 - 3 * 3600_000))).json() as any;
    ok(stale.stale === true && reports.join() === "intake-quiet", "stale: one intake-quiet report", `${stale.stale} ${reports.join()}`);
    ok(stale.replace_path === "armed" || stale.replace_path === "blocked", "and the delete-and-repost state rides along", String(stale.replace_path));
    reports.length = 0;
    const fresh = await (await handleIntakeHealth(req("http://x/api/health/intake"), io(monday11 - 5 * 60_000))).json() as any;
    ok(fresh.stale === false && reports.length === 0, "fresh: nothing reported");
    const short = await (await handleIntakeHealth(req("http://x/api/health/intake?quiet_minutes=5"), io(monday11 - 10 * 60_000))).json() as any;
    ok(short.quiet_minutes === 5 && short.stale === true, "quiet_minutes is honoured, the watchdog test's lever", JSON.stringify({ q: short.quiet_minutes, s: short.stale }));
  }

  console.log("\n[2] settings: a failed read or write is a 500, never a quiet default");
  {
    const down = { get: async () => { throw new Error("neon down"); }, save: async () => { throw new Error("neon down"); } };
    ok((await handleSettingsGet(down as any)).status === 500, "GET 500 when the read fails");
    ok((await handleSettingsPost(req("http://x/api/settings", { replies_enabled: true }), down as any)).status === 500, "POST 500 when the write fails");
    const up = { get: async () => ({ ...DEFAULT_SETTINGS }), save: async (n: any) => ({ ...DEFAULT_SETTINGS, ...n }) };
    const saved = await (await handleSettingsPost(req("http://x/api/settings", { replies_enabled: true, nonsense: 1 }), up as any)).json() as any;
    ok(saved.ok === true && saved.settings.replies_enabled === true && !("nonsense" in saved.settings), "POST saves through the whitelist", JSON.stringify(saved.settings));
  }

  console.log("\n[3] confirm-order: 400, 404 and the audit trail");
  {
    const io = (state: any) => ({ buildDeps: async () => ({}) as any, confirmOrder: async () => state, upsertTicket: async () => {} });
    ok((await handleConfirmOrder(req("http://x", {}), "ben", io(undefined) as any)).status === 400, "no thread_id: 400");
    ok((await handleConfirmOrder(req("http://x", { thread_id: "t" }), "ben", io(undefined) as any)).status === 404, "unknown thread: 404");
    const body = await (await handleConfirmOrder(req("http://x", { thread_id: "t" }), "ben@samurai", io({ thread_id: "t", status: "ordered", notes: [] }) as any)).json() as any;
    ok(body.ok === true && body.confirmed_by === "ben@samurai", "confirmed, with who approved it", JSON.stringify(body));
  }

  console.log("\n[4] dedupe: fails open on a missing id, and passes the claim through");
  {
    const claims: any[] = [];
    const io = { claim: (async (c: any) => { claims.push(c); return { ok: true, found: claims.length > 1, first_seen: claims.length === 1 }; }) as any };
    const missing = await (await handleDedupe(req("http://x", { subject: "no id" }), io)).json() as any;
    ok(missing.first_seen === true && claims.length === 0, "no message id: processed, never silently dropped");
    const first = await (await handleDedupe(req("http://x", { id: "19a1", threadId: "t1", from: "a@b.c" }), io)).json() as any;
    const again = await (await handleDedupe(req("http://x", { message_id: "19a1" }), io)).json() as any;
    ok(first.first_seen === true && again.first_seen === false, "the first claim wins, the repeat does not", JSON.stringify([first, again]));
    ok(claims[0].message_id === "19a1" && claims[0].thread_id === "t1" && claims[0].from_address === "a@b.c", "Gmail's id spellings are read", JSON.stringify(claims[0]));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
