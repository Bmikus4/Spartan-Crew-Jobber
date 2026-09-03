// ============================================================================
// A 500 must never turn one booking into two — and must not quietly lose one.
// ----------------------------------------------------------------------------
// THE BUG THIS EXISTS TO CATCH. `httpTransport` retried every 5xx POST except
// `/slotTeams`, justified in its own comment by "POST /orders now carries an EMPTY
// SlotTeam array, so a duplicate would be an empty order". That stopped being true on
// 2026-08-28 when the create was changed to carry the crew nested (deps.ts: an order
// created blockless is filed into a queue nobody looks at). From that day a 500 the
// server had actually applied would have posted a SECOND COMPLETE BOOKING — real crew,
// real job, real invoice — and nothing anywhere would have said so.
//
// It was never observed in production because OnSinch's 500s were measured only under
// concurrency (15 of 86 creates at concurrency 4; 0 of 25 at concurrency 1) and the live
// pipeline runs one thread at a time. The guard was gone; the traffic pattern was the
// only thing standing in for it.
//
// WHY THESE TESTS ARE SHAPED LIKE THIS. Every case below counts POSTs, because "did it
// write twice" is the only question that matters and it is not visible in a return
// value. Several assert on the number of READS too — a fix that probes once instead of
// twice, or that reads the wrong window, passes a naive "no duplicate" test while still
// duplicating on the race it was written for.
//
// Run: npx tsx test/createNeverDuplicates.ts
// ============================================================================
import { OnsinchClient, httpTransport, type Transport } from "../app/lib/engine/onsinch";
import type { OnsinchOrderBody } from "../app/lib/engine/format";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const ORDER: OnsinchOrderBody = {
  name: "Farago Projects — Chopova Lowena derig, 19 Sep",
  company_id: 150,
  user_id: 9,
  request_approval: true,
  Job: { name: "Chopova Lowena derig", pricelist_category_id: 342 },
  SlotTeam: [
    { name: "Crew", profession_id: 3, beginning: "2026-09-19T09:00:00+01:00", end: "2026-09-19T17:00:00+01:00", size: 6, place_id: 88 },
  ],
} as unknown as OnsinchOrderBody;

const nowIso = () => new Date().toISOString();
const agesAgo = () => new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

/**
 * A transport double that records every call and answers from a script.
 * `postStatuses` is consumed one per POST; `lookupRows` one per GET.
 */
function fakeTransport(opts: {
  postStatuses: Array<number | "throw">;
  lookupRows: Array<Array<Record<string, unknown>> | number>; // rows, or an HTTP status to fail with
}): { t: Transport; posts: string[]; gets: string[] } {
  const posts: string[] = [];
  const gets: string[] = [];
  let p = 0;
  let g = 0;
  const t: Transport = async (method, path) => {
    if (method === "POST") {
      posts.push(path);
      const step = opts.postStatuses[Math.min(p++, opts.postStatuses.length - 1)];
      if (step === "throw") throw new Error("OnSinch POST /orders timed out after 12000ms");
      if (step === 201) return { status: 201, data: { data: [{ id: 9001 }] } };
      return { status: step, data: null };
    }
    gets.push(path);
    const step = opts.lookupRows[Math.min(g++, opts.lookupRows.length - 1)];
    if (typeof step === "number") return { status: step, data: null };
    return { status: 200, data: { data: step } };
  };
  return { t, posts, gets };
}

(async () => {
  console.log("\n[1] the transport repeats NO create, whatever the path");
  {
    // The original bug in its purest form: this is the assertion that was inverted.
    for (const path of ["/orders", "/companies", "/places", "/slotTeams"]) {
      const calls: string[] = [];
      const real = globalThis.fetch;
      globalThis.fetch = (async (url: string, init: { method: string }) => {
        calls.push(init.method);
        return { status: 500, text: async () => "" } as unknown as Response;
      }) as unknown as typeof fetch;
      const tr = httpTransport({ baseUrl: "https://x.test/api/v1", apiKey: "k" } as never);
      const r = await tr("POST", path, [{ name: "x" }]);
      globalThis.fetch = real;
      ok(calls.length === 1, `POST ${path} is sent once and only once`, `${calls.length} attempts`);
      ok(r.status === 500, `POST ${path} hands the 500 back for the caller to decide`, String(r.status));
    }
  }

  console.log("\n[2] reads and by-id writes are still retried — the recovery depends on it");
  {
    for (const [method, path] of [["GET", "/orders?id=1"], ["PATCH", "/slotTeams"]] as const) {
      let n = 0;
      const real = globalThis.fetch;
      globalThis.fetch = (async () => {
        n++;
        return n === 1
          ? ({ status: 502, text: async () => "" } as unknown as Response)
          : ({ status: method === "PATCH" ? 204 : 200, text: async () => (method === "PATCH" ? "" : JSON.stringify({ data: [] })) } as unknown as Response);
      }) as unknown as typeof fetch;
      const tr = httpTransport({ baseUrl: "https://x.test/api/v1", apiKey: "k" } as never);
      const r = await tr(method, path, method === "PATCH" ? [{ id: 1, size: 4 }] : undefined);
      globalThis.fetch = real;
      ok(n === 2 && r.status !== 502, `a 502 on ${method} ${path} is retried`, `${n} attempts, final ${r.status}`);
    }
  }

  console.log("\n[3] a 500 whose write LANDED is adopted, not posted again");
  {
    const f = fakeTransport({
      postStatuses: [500],
      lookupRows: [[{ id: 15574, number: "10726", created: nowIso() }]],
    });
    const got = await new OnsinchClient(f.t).createOrder([ORDER]);
    ok(f.posts.length === 1, "THE BOOKING WAS NOT DOUBLED — one POST in total", `${f.posts.length} POSTs`);
    ok(got.id === 15574, "the order that already exists is the one returned", `#${got.id}`);
    ok(got.number === "10726", "and its R number comes back with it", String(got.number));
    ok(f.gets.length === 1, "one lookup was enough once it was found", `${f.gets.length} lookups`);
  }

  console.log("\n[4] a 500 whose write did NOT land still books — the 17% is not surrendered");
  {
    const f = fakeTransport({ postStatuses: [500, 201], lookupRows: [[], []] });
    const got = await new OnsinchClient(f.t).createOrder([ORDER]);
    ok(got.id === 9001, "the re-post is the one that counts", `#${got.id}`);
    ok(f.posts.length === 2, "exactly one re-post, not a loop", `${f.posts.length} POSTs`);
    ok(f.gets.length === 2, "OnSinch was asked TWICE before anything was written again", `${f.gets.length} lookups`);
  }

  console.log("\n[5] the second lookup is the one that catches the race");
  {
    // The write landed, but the first read raced it and saw nothing. A fix that probes
    // once passes [3] and [4] and still duplicates here — which is the real-world shape,
    // because the 500 and the read are concurrent with the write that caused them.
    const f = fakeTransport({
      postStatuses: [500, 201],
      lookupRows: [[], [{ id: 15574, number: "10726", created: nowIso() }]],
    });
    const got = await new OnsinchClient(f.t).createOrder([ORDER]);
    ok(f.posts.length === 1, "THE BOOKING WAS NOT DOUBLED when the first read raced the write", `${f.posts.length} POSTs`);
    ok(got.id === 15574, "the order found on the second look is returned", `#${got.id}`);
  }

  console.log("\n[6] an OLD order with the same name is never adopted as this create");
  {
    // A client re-enquires with the same subject months later. The composed name repeats.
    // Adopting the old order would silently link a new job to a booking that is not it.
    const f = fakeTransport({
      postStatuses: [500, 201],
      lookupRows: [
        [{ id: 11111, number: "10001", created: agesAgo() }],
        [{ id: 11111, number: "10001", created: agesAgo() }],
      ],
    });
    const got = await new OnsinchClient(f.t).createOrder([ORDER]);
    ok(got.id === 9001, "the stale match is ignored and the order is written", `#${got.id}`);
    ok(f.posts.length === 2, "so the booking is made rather than mislinked", `${f.posts.length} POSTs`);
  }

  console.log("\n[7] when several match in the window, the newest id wins");
  {
    const f = fakeTransport({
      postStatuses: [500],
      lookupRows: [[
        { id: 15572, number: "10726", created: nowIso() },
        { id: 15574, number: "10726", created: nowIso() },
        { id: 15573, number: "10726", created: nowIso() },
      ]],
    });
    const got = await new OnsinchClient(f.t).createOrder([ORDER]);
    ok(got.id === 15574, "the highest id, not the order the API happened to return first", `#${got.id}`);
  }

  console.log("\n[8] a FAILED lookup is not read as 'absent' — nothing is written blind");
  {
    // The dangerous conflation. `this.t` returns {status:500,data:null} rather than
    // throwing, so `data?.data ?? []` would make a broken lookup say "no such order"
    // with total confidence, and the create would go out again.
    const f = fakeTransport({ postStatuses: [500, 201], lookupRows: [503] });
    let threw: Error | null = null;
    try { await new OnsinchClient(f.t).createOrder([ORDER]); } catch (e) { threw = e as Error; }
    ok(!!threw, "it fails rather than guessing");
    ok(f.posts.length === 1, "THE CREATE WAS NOT RE-POSTED on an unanswered question", `${f.posts.length} POSTs`);
    ok(/NOT re-posted/i.test(threw?.message ?? ""), "and says why, so the error is actionable", (threw?.message ?? "").slice(0, 70));
    ok(/Chopova/.test(threw?.message ?? ""), "naming the order a human has to go and check");
  }

  console.log("\n[9] a timeout is the case where the order most likely exists");
  {
    // The transport THROWS on a 12s timeout. Before this, that threw straight through and
    // the order sat in OnSinch belonging to nobody.
    const f = fakeTransport({
      postStatuses: ["throw"],
      lookupRows: [[{ id: 15574, number: "10726", created: nowIso() }]],
    });
    const got = await new OnsinchClient(f.t).createOrder([ORDER]);
    ok(got.id === 15574, "the booking is recovered instead of lost", `#${got.id}`);
    ok(f.posts.length === 1, "and not made a second time", `${f.posts.length} POSTs`);
  }

  console.log("\n[10] a timeout with nothing there rethrows — loudly lost beats silently doubled");
  {
    const f = fakeTransport({ postStatuses: ["throw"], lookupRows: [[]] });
    let threw: Error | null = null;
    try { await new OnsinchClient(f.t).createOrder([ORDER]); } catch (e) { threw = e as Error; }
    ok(/timed out/.test(threw?.message ?? ""), "the original failure survives, not a lookup error", (threw?.message ?? "").slice(0, 50));
    ok(f.posts.length === 1, "and no speculative second create", `${f.posts.length} POSTs`);
  }

  console.log("\n[11] a 400 is still a 400 — the recovery must not swallow a bad body");
  {
    const f = fakeTransport({ postStatuses: [400], lookupRows: [[{ id: 15574, created: nowIso() }]] });
    let threw: Error | null = null;
    try { await new OnsinchClient(f.t).createOrder([ORDER]); } catch (e) { threw = e as Error; }
    ok(/createOrder 400/.test(threw?.message ?? ""), "reported as-is", (threw?.message ?? "").slice(0, 40));
    ok(f.gets.length === 0, "and never looked up — a rejected body created nothing", `${f.gets.length} lookups`);
    ok(f.posts.length === 1, "nor re-posted", `${f.posts.length} POSTs`);
  }

  console.log("\n[12] the lookup filters on the name, and says so on the wire");
  {
    // If the filter were dropped or misspelled, OnSinch would answer with an unfiltered
    // page and this function would report EVERY create as already landed — turning the
    // duplicate bug into a total booking outage. Probed live 2026-09-02: `name[eq]`
    // returns 1 of 6,686, and a name no order carries returns 0.
    const f = fakeTransport({ postStatuses: [500], lookupRows: [[{ id: 15574, created: nowIso() }]] });
    await new OnsinchClient(f.t).createOrder([ORDER]);
    const q = f.gets[0] ?? "";
    ok(/name%5Beq%5D=/.test(q), "name[eq] is on the query", q.slice(0, 60));
    ok(/company_id%5Beq%5D=150/.test(q), "narrowed to the client");
    ok(!/sort=/.test(q), "and does NOT lean on sort=-id, which /orders ignores");
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
