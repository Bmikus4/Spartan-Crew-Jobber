// ============================================================================
// Error reporting — the rules that make an empty inbox mean an empty system.
// ----------------------------------------------------------------------------
// Spartan had no error reporting at all. Eleven console.error sites wrote to
// Vercel's logs and nowhere else, so when the Gmail credential expired on
// 2026-08-26 the intake failed every five minutes for 42 hours and nobody knew.
//
// The two failure modes pull opposite ways. Stay quiet and a dead route loses
// bookings for a week unnoticed. Email every occurrence and a route failing on
// every request sends hundreds, the sender gets filtered, and the channel is
// worse than useless — alive-looking and reaching nobody. So the first sighting
// emails, repeats inside a window collapse into a running count, and the count
// travels with the next email so the reader can judge severity.
//
// THAT SUPPRESSION IS ONLY SAFE BECAUSE EVERY OCCURRENCE IS STILL RECORDED.
// If a suppressed error left no trace, silence would mean "possibly dead"
// rather than "nothing is wrong", and the whole channel would be unreadable.
// That is the property [3] and [4] exist to hold.
//
// AND IT MUST NEVER BE THE THING THAT BREAKS A BOOKING. reportError is always
// called with `void` and is pinned here against every way the channel can fail:
// absent, 500, and n8n's signature failure — 200 with an empty body.
//
// Run: npx tsx test/errorReport.ts
// ============================================================================
import {
  DEFAULT_WINDOW_MS,
  InMemoryErrorStore,
  errorEmailText,
  fingerprint,
  notifyAllowed,
  reportError,
  shouldEmail,
  type ErrorStore,
} from "../app/lib/errorReport";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

/** Swap global fetch for a recorder. Returns the calls and a restore function. */
function spyFetch(reply: () => Promise<Response> | Response) {
  const calls: { url: string; body: unknown }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return await reply();
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/** The environment a deployment has: allowed to send. Restored by each caller. */
function asDeployment() {
  const prior = process.env.VERCEL;
  process.env.VERCEL = "1";
  return () => { if (prior === undefined) delete process.env.VERCEL; else process.env.VERCEL = prior; };
}

(async () => {
  console.log("\n[1] the fingerprint collapses the same fault to one identity");
  {
    // The same OnSinch rejection, twice, differing only in the parts that change
    // every time. Without normalisation each repeat looks new, the window never
    // applies, and the flood the window exists to contain arrives anyway.
    const a = fingerprint(
      "deps/createCompany",
      "POST /companies failed for 3f1a9c22-77b0-4e1e-9a05-1c2b3d4e5f60 at 2026-08-29T09:14:02.881Z after 1284 ms",
    );
    const b = fingerprint(
      "deps/createCompany",
      "POST /companies failed for 91cc0de1-2222-4bbb-8ccc-000011112222 at 2026-08-29T11:47:55.031Z after 903 ms",
    );
    ok(a === b, "two occurrences of one fault share an identity", `${a} / ${b}`);

    // Short numbers are kept on purpose: an HTTP status is the difference between
    // an expired credential and a broken server, and collapsing them hides one
    // behind the other for six hours.
    ok(
      fingerprint("deps/createOrder", "OnSinch said 401") !==
        fingerprint("deps/createOrder", "OnSinch said 500"),
      "401 and 500 stay separate problems",
    );

    // `where` is kept verbatim rather than folded into the digest, so a digest
    // collision can only ever over-suppress two errors in the SAME place.
    ok(
      fingerprint("deps/createCompany", "timeout") !== fingerprint("deps/createPlace", "timeout"),
      "the same message in two places is two problems",
    );
  }

  console.log("\n[2] the window decides when to email again");
  {
    const now = 1_800_000_000_000;
    ok(shouldEmail({ lastEmailedAt: null, now }), "never emailed — email now");
    ok(!shouldEmail({ lastEmailedAt: now - 60_000, now }), "a minute ago — suppressed");
    ok(shouldEmail({ lastEmailedAt: now - DEFAULT_WINDOW_MS - 1, now }), "past the window — email again");
    // Serverless instances disagree about the clock. The safe direction for a
    // disagreement is quiet, not a flood.
    ok(!shouldEmail({ lastEmailedAt: now + 3_600_000, now }), "a future timestamp suppresses rather than floods");
  }

  console.log("\n[3] every occurrence is recorded even when nothing is emailed");
  {
    const undo = asDeployment();
    const spy = spyFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const store = new InMemoryErrorStore();
    try {
      // severity "log": worth counting, not worth interrupting anyone over.
      await reportError({ route: "booking-lost", where: "deps/aliases", what: "alias not recorded", severity: "log", store });
      await reportError({ route: "booking-lost", where: "deps/aliases", what: "alias not recorded", severity: "log", store });
      const fp = fingerprint("deps/aliases", "alias not recorded");
      ok(store.rows.get(fp)?.count === 2, "counted twice", String(store.rows.get(fp)?.count));
      ok(spy.calls.length === 0, "and emailed zero times", String(spy.calls.length));
    } finally { spy.restore(); undo(); }
  }

  console.log("\n[4] a flood collapses into one email carrying a running count");
  {
    const undo = asDeployment();
    const spy = spyFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const store = new InMemoryErrorStore();
    let clock = 1_800_000_000_000;
    const fire = () => reportError({
      route: "booking-lost", where: "pipeline/order_error", what: "OnSinch said 500", store, now: () => clock,
    });
    try {
      const first = await fire();
      clock += 60_000;
      const second = await fire();
      ok(first === true, "the first sighting emails");
      ok(second === false, "the second inside the window does not");
      ok(spy.calls.length === 1, "one email for two occurrences", String(spy.calls.length));

      const fp = fingerprint("pipeline/order_error", "OnSinch said 500");
      ok(store.rows.get(fp)?.count === 2, "both occurrences counted", String(store.rows.get(fp)?.count));

      clock += DEFAULT_WINDOW_MS;
      const third = await fire();
      ok(third === true, "past the window it emails again");
      const text = String((spy.calls[1]?.body as any)?.ticket_text ?? "");
      ok(/seen 3 times/i.test(text), "and the email carries the running total", text.slice(0, 80));
    } finally { spy.restore(); undo(); }
  }

  console.log("\n[5] reporting never throws, however the channel fails");
  {
    const undo = asDeployment();
    const store = new InMemoryErrorStore();
    const call = (label: string) => reportError({ route: "engine-threw", where: `t/${label}`, what: "boom", store });

    // No webhook configured at all.
    const priorHook = process.env.ERROR_REPORT_WEBHOOK;
    process.env.ERROR_REPORT_WEBHOOK = "";
    let threw = false;
    try { await call("nohook"); } catch { threw = true; }
    ok(!threw, "no webhook configured");
    if (priorHook === undefined) delete process.env.ERROR_REPORT_WEBHOOK; else process.env.ERROR_REPORT_WEBHOOK = priorHook;

    // The webhook 500s.
    let spy = spyFetch(() => new Response("upstream is down", { status: 500 }));
    threw = false;
    try { await call("500"); } catch { threw = true; }
    ok(!threw, "the webhook 500s");
    spy.restore();

    // n8n's signature failure: 200 with an empty body, which is what a rejected
    // secret produces. It must be reported as not-sent, not counted as delivered.
    spy = spyFetch(() => new Response("", { status: 200 }));
    threw = false;
    let sent: boolean | null = null;
    try { sent = await call("empty"); } catch { threw = true; }
    ok(!threw, "the webhook returns 200 with an empty body");
    ok(sent === false, "and that is reported as not sent");
    spy.restore();

    // The transport itself rejects.
    spy = spyFetch(() => { throw new Error("ECONNRESET"); });
    threw = false;
    try { await call("reset"); } catch { threw = true; }
    ok(!threw, "the transport rejects");
    spy.restore();

    // The store itself is broken. Losing the count must not lose the booking.
    const broken: ErrorStore = {
      async record() { throw new Error("no database"); },
      async claimEmail() { throw new Error("no database"); },
    };
    threw = false;
    try { await reportError({ route: "engine-threw", where: "t/db", what: "boom", store: broken }); } catch { threw = true; }
    ok(!threw, "the store is broken");

    undo();
  }

  console.log("\n[6] a local run and a preview deployment email nobody");
  {
    // In HoH, local test runs sent 17 real emails before this gate existed. The
    // occurrence is still recorded — the gate is about the channel, not the count.
    const priorV = process.env.VERCEL;
    const priorN = process.env.SPARTAN_ERROR_NOTIFY;
    delete process.env.VERCEL;
    delete process.env.SPARTAN_ERROR_NOTIFY;
    const spy = spyFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const store = new InMemoryErrorStore();
    try {
      ok(!notifyAllowed(), "not a deployment: sending is refused");
      const sent = await reportError({ route: "booking-lost", where: "t/gate", what: "boom", store });
      ok(sent === false, "reportError reports nothing sent");
      ok(spy.calls.length === 0, "nothing was posted anywhere", String(spy.calls.length));
      ok(store.rows.get(fingerprint("t/gate", "boom"))?.count === 1, "but the occurrence is still recorded");
      // AND THE EMAIL SLOT IS NOT CLAIMED. There is no development database — a local run
      // writes to production — so claiming first and checking the gate second would let this
      // very test suite mark the real fingerprint emailed and silence the real alert for six
      // hours without sending anything.
      ok(store.rows.get(fingerprint("t/gate", "boom"))?.lastEmailedAt === null,
        "and the production email slot is left unclaimed");

      // One env var, typed on purpose, is how the channel gets verified by hand.
      process.env.SPARTAN_ERROR_NOTIFY = "1";
      ok(notifyAllowed(), "the deliberate local override opens it");
    } finally {
      spy.restore();
      if (priorV === undefined) delete process.env.VERCEL; else process.env.VERCEL = priorV;
      if (priorN === undefined) delete process.env.SPARTAN_ERROR_NOTIFY; else process.env.SPARTAN_ERROR_NOTIFY = priorN;
    }
  }

  console.log("\n[7] the email says which of the four things happened");
  {
    const first = errorEmailText({
      route: "intake-quiet", where: "health/intake", what: "no mail for 95 minutes",
      count: 1, firstSeenAt: "2026-08-29T09:00:00.000Z",
    });
    ok(/first occurrence/i.test(first), "a first sighting says so");
    ok(/intake/i.test(first), "and names the route");

    const many = errorEmailText({
      route: "booking-lost", where: "pipeline/order_error", what: "OnSinch said 500",
      detail: "order #14866", count: 12, firstSeenAt: "2026-08-29T09:00:00.000Z",
    });
    ok(/seen 12 times/i.test(many), "a repeat carries the count");
    ok(/order #14866/.test(many), "and the detail");
  }

  console.log(`\n${fails ? `${fails} FAILED` : "errorReport: ALL PASS"}\n`);
  process.exit(fails ? 1 : 0);
})();
