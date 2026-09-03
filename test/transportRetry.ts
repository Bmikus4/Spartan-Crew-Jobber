// ============================================================================
// A 500 from OnSinch must not lose the booking — and a retry must never double a
// crew block.
// ----------------------------------------------------------------------------
// MEASURED, NOT SUPPOSED. On 2026-08-25, 106 corpus cases ran against TEST 515 at
// concurrency 4 and `POST /orders` returned 500 fifteen times out of 86 creates.
// The same cases at concurrency 1 returned 25 of 25 with byte-identical payloads.
// C012, C015, C019, C024 and C028 each failed in the first run and passed in the
// second. OnSinch 500s under concurrent create load.
//
// There was no retry in the client at all, so every one of those was a silently
// lost booking: the thread went to `error` and nothing reached OnSinch. A burst of
// enquiries arriving together is precisely when this fires.
//
// THE LINE THAT MATTERS is which calls may be retried. A 500 does not say what the
// server did, so a retried POST can double-create. This file used to draw that line
// around `POST /slotTeams` alone and assert that `POST /orders` WAS retried — correct
// only while the create carried an empty SlotTeam array, which stopped being true on
// 2026-08-28. Every POST in this API creates something, so the line is now drawn at the
// method: no POST is repeated here, and the create's own recovery is a READ, in
// `OnsinchClient.createOrder`. See test/createNeverDuplicates.ts, which is where the
// "the booking survives a 500" behaviour is now asserted.
//
// Run: npx tsx test/transportRetry.ts
// ============================================================================
import { httpTransport } from "../app/lib/engine/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

/** Swap global fetch for a script of responses, recording every attempt. */
function withFetch(script: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ method: string; url: string }> = [];
  const real = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url: String(url) });
    const step = script[Math.min(i++, script.length - 1)];
    return {
      status: step.status,
      text: async () => (step.body === undefined ? "" : JSON.stringify(step.body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const transport = httpTransport({ baseUrl: "https://x.test/api/v1", apiKey: "k" } as never);

(async () => {
  console.log("\n[1] a 500 on POST /orders is NOT retried here — a repeat is a second booking");
  {
    const f = withFetch([{ status: 500 }, { status: 201, body: { data: [{ id: 42 }] } }]);
    const r = await transport("POST", "/orders", [{ name: "x" }]);
    f.restore();
    ok(f.calls.length === 1, "sent once", `${f.calls.length} attempts`);
    ok(r.status === 500, "and the 500 is handed to createOrder, which reads before it writes", String(r.status));
  }

  console.log("\n[2] nor is any other create — /companies and /places duplicate a client or a venue");
  {
    for (const path of ["/companies", "/places"]) {
      const f = withFetch([{ status: 500 }]);
      const r = await transport("POST", path, [{ name: "x" }]);
      f.restore();
      ok(f.calls.length === 1 && r.status === 500, `POST ${path} sent once`, `${f.calls.length} attempts`);
    }
  }

  console.log("\n[3] POST /slotTeams is NEVER retried — a retry appends a second crew block");
  {
    const f = withFetch([{ status: 500 }, { status: 201, body: { data: [{ id: 7 }] } }]);
    const r = await transport("POST", "/slotTeams", [{ name: "block" }]);
    f.restore();
    ok(f.calls.length === 1, "sent once and only once", `${f.calls.length} attempts`);
    ok(r.status === 500, "the 500 is handed back for the caller to decide", String(r.status));
  }

  console.log("\n[4] a 4xx is the server telling us the body is wrong — retrying cannot help");
  {
    const f = withFetch([{ status: 400, body: { validationErrors: {} } }]);
    const r = await transport("POST", "/orders", [{ name: "x" }]);
    f.restore();
    ok(f.calls.length === 1, "not retried", `${f.calls.length} attempts`);
    ok(r.status === 400, "and reported as-is", String(r.status));
  }

  console.log("\n[5] the reads the engine leans on are retried too");
  {
    const f = withFetch([{ status: 502 }, { status: 200, body: { data: [] } }]);
    const r = await transport("GET", "/orders?id=1", undefined);
    f.restore();
    ok(r.status === 200 && f.calls.length === 2, "a 502 on a GET is retried", `${f.calls.length} attempts`);
  }

  console.log("\n[6] a 204 still means success with no body");
  {
    const f = withFetch([{ status: 204 }]);
    const r = await transport("PATCH", "/slotTeams", [{ id: 1, size: 4 }]);
    f.restore();
    ok(r.status === 204 && r.data === null && f.calls.length === 1, "unchanged", `${f.calls.length} attempts`);
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
