// ============================================================================
// Error reporting: every reported failure is a counted row, and nothing is sent.
// ----------------------------------------------------------------------------
// Spartan had no error reporting at all. Eleven console.error sites wrote to
// Vercel's logs and nowhere else, so when the Gmail credential expired on
// 2026-08-26 the intake failed every five minutes for 42 hours and nobody knew.
//
// It emailed through an n8n webhook until Stop 2 deletion D6 (22 Nov): the owner
// switched error email off on 4 Nov and the webhook was deleted, so the sending
// half could only fail. The alarm that replaces it is O48, from the heartbeat.
// What stays is the record: one row per fingerprint, counted, written even when
// the caller's request has already answered, and never a throw.
//
// Run: npx tsx test/errorReport.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { InMemoryErrorStore, fingerprint, reportError, type ErrorStore } from "../app/lib/errorReport";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

(async () => {
  console.log("\n[1] the fingerprint collapses the same fault to one identity");
  {
    // The same OnSinch rejection, twice, differing only in the parts that change every time.
    // Without normalisation each repeat is a new row and a flood buries every other fault.
    const a = fingerprint(
      "deps/createCompany",
      "POST /companies failed for 3f1a9c22-77b0-4e1e-9a05-1c2b3d4e5f60 at 2026-08-29T09:14:02.881Z after 1284 ms",
    );
    const b = fingerprint(
      "deps/createCompany",
      "POST /companies failed for 91cc0de1-2222-4bbb-8ccc-000011112222 at 2026-08-29T11:47:55.031Z after 903 ms",
    );
    ok(a === b, "two occurrences of one fault share an identity", `${a} / ${b}`);
    // Short numbers are kept on purpose: an HTTP status is the difference between an expired
    // credential and a broken server.
    ok(fingerprint("deps/createOrder", "OnSinch said 401") !== fingerprint("deps/createOrder", "OnSinch said 500"), "401 and 500 stay separate problems");
    // `where` is kept verbatim, so a digest collision can only merge two errors in the SAME place.
    ok(fingerprint("deps/createCompany", "timeout") !== fingerprint("deps/createPlace", "timeout"), "the same message in two places is two problems");
  }

  console.log("\n[2] every occurrence is counted on one row");
  {
    const store = new InMemoryErrorStore();
    const fire = () => reportError({ route: "booking-lost", where: "pipeline/order_error", what: "OnSinch said 500", store });
    const results = [await fire(), await fire(), await fire()];
    const row = store.rows.get(fingerprint("pipeline/order_error", "OnSinch said 500"));
    ok(results.every((r) => r === true), "each resolves as recorded", JSON.stringify(results));
    ok(store.rows.size === 1 && row?.count === 3, "one row, counted three times", String(row?.count));
  }

  console.log("\n[3] nothing is ever sent, whatever the environment says");
  {
    // The env vars that used to open the channel. Set, they must change nothing.
    const prior = { n: process.env.SPARTAN_ERROR_NOTIFY, w: process.env.ERROR_REPORT_WEBHOOK, v: process.env.VERCEL };
    process.env.SPARTAN_ERROR_NOTIFY = "1"; process.env.ERROR_REPORT_WEBHOOK = "https://example.invalid/hook"; process.env.VERCEL = "1";
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: any) => { calls.push(String(url)); return new Response("{}", { status: 200 }); }) as typeof fetch;
    try {
      await reportError({ route: "intake-quiet", where: "t/none", what: "quiet", store: new InMemoryErrorStore() });
      ok(calls.length === 0, "no request is made", calls.join(","));
    } finally {
      globalThis.fetch = real;
      for (const [k, v] of [["SPARTAN_ERROR_NOTIFY", prior.n], ["ERROR_REPORT_WEBHOOK", prior.w], ["VERCEL", prior.v]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
    const src = readFileSync("app/lib/errorReport.ts", "utf8");
    ok(!/\bfetch\(|https?:\/\//.test(src), "and errorReport.ts names no URL and makes no request");
  }

  console.log("\n[4] reporting never throws");
  {
    const broken: ErrorStore = { async record() { throw new Error("no database"); } };
    let threw = false, got: boolean | null = null;
    try { got = await reportError({ route: "engine-threw", where: "t/db", what: "boom", store: broken }); } catch { threw = true; }
    ok(!threw && got === false, "a broken store resolves false, never throws");
  }

  // 2026-10-01..03: intake was down 53 hours and no report reached anyone. Every caller writes
  // `void reportError()`, so on Vercel the write died when the lambda froze after the response.
  console.log("\n[5] the pending write is handed to keepAlive, so it outlives the response");
  {
    const kept: Promise<unknown>[] = [];
    const p = reportError({ route: "intake-quiet", where: "t/keepalive", what: "quiet", store: new InMemoryErrorStore(), keepAlive: (q) => { kept.push(q); } });
    ok(kept.length === 1 && kept[0] === p, "keepAlive receives the write itself, not a copy that settles early");
    ok((await p) === true, "which resolves once the row is written");
  }

  console.log(`\n${fails ? `${fails} FAILED` : "errorReport: ALL PASS"}\n`);
  process.exit(fails ? 1 : 0);
})();
