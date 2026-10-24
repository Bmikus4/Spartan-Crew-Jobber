// ============================================================================
// Every stored client email ends in a recorded decision or a card a person sees.
// ----------------------------------------------------------------------------
// The addendum's F1 (23 Oct): three ways an email was stored and never decided, with no card
// and no alarm. (a) a capture that failed on its second message reported success with no new
// ids, so the stored first message was never offered again; (b) a throw inside decideMessage
// before its decision was recorded; (c) earlier messages marked "read together" before the
// newest was decided, so a throw on the newest left all of them settled and none decided.
// Against PGlite (fixtures/pg.ts): nothing here reaches the production database.
// npx tsx test/everyEmailDecided.ts
// ============================================================================
import { fault, sql, clock, syncSqlClock } from "./fixtures/pg";
import type { DecideDeps, MessageIn } from "../app/lib/v2/process";
import type { World } from "../app/lib/v2/interpret/plan";
import type { Extraction } from "../app/lib/v2/interpret/extract";
/* eslint-disable @typescript-eslint/no-require-imports */
// Not "local": the TV hides a workstation's decisions.
process.env.VERCEL_GIT_COMMIT_SHA = "test";
const { captureInboundRaw } = require("../app/lib/inboundRawDb.ts");
const { decideMessage, decideDelivery, sweepUndecided } = require("../app/lib/v2/process.ts");
const { liveFeedDeps } = require("../app/lib/feed/live.ts");
const { v2Sources } = require("../app/lib/feed/v2.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const T0 = Date.parse("2026-11-02T09:00:00Z");
const MIN = 60_000;
const mail = (id: string, at: string, body = "Please add 2 crew on Friday") => ({ message_id: id, from: "Sam <sam@client.co.uk>", to: ["bookings@spartancrew.co.uk"], date: at, subject: "Crew", body });
const rowsFor = async (ids: string[]) => (await sql`SELECT message_id, kind, decision FROM v2_decisions WHERE message_id = ANY(${ids}) ORDER BY sent_at`) as any[];
const at = async (ms: number) => { clock.set(ms); await syncSqlClock(); };

const x: Extraction = { intent: "booking", po: null as any, note: "", requests: [] };
const world: World = {
  companies: async () => [{ id: 137, name: "Client Ltd", Client: [{ id: 1, email: "sam@client.co.uk" }] }],
  placesNamed: async () => [], companyOrders: async () => [], orderByNumber: async () => null,
  orderById: async () => ({ id: 5, company_id: 137 }),
};
const m: MessageIn = { message_id: "d1", thread_id: "td", from_address: "sam@client.co.uk", date_iso: "2026-11-02T09:00:00Z", subject: "Crew", body: "Please add 2 crew on Friday", is_from_spartan: false };
const deps = (over: Partial<DecideDeps>, recorded: unknown[]): DecideDeps => ({
  extract: (async () => ({ x, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
  world, threadOrderId: async () => null, run: null, record: async (r) => { recorded.push(r); }, trace: () => {}, ...over,
});

(async () => {
  console.log("\n[a] a capture that fails part way says so, and keeps every message it took");
  {
    await at(T0);
    let n = 0;
    fault.when = (q) => /INSERT INTO thread_messages/.test(q) && ++n === 2;
    const cap = await captureInboundRaw({ thread_id: "ta", messages: [mail("a1", "2026-11-02T08:00:00Z"), mail("a2", "2026-11-02T08:05:00Z"), mail("a3", "2026-11-02T08:10:00Z")] });
    fault.when = null;
    ok(cap.ok === false, "the capture reports the failure, so intake raises its alarm", cap);
    ok(JSON.stringify(cap.new_message_ids) === '["a1"]', "the message it did store is named, not lost behind an empty list", cap.new_message_ids);
    const [raw] = (await sql`SELECT payload IS NOT NULL AS whole FROM inbound_raw WHERE thread_id = 'ta'`) as any[];
    ok(raw?.whole === true, "the whole delivery is kept, so the messages it could not store are not lost", raw);
  }

  console.log("\n[b] a throw inside decideMessage is a recorded card, never a lost email");
  {
    const rec: any[] = [];
    await decideMessage(m, deps({ threadOrderId: async () => { throw new Error("job_links read 500"); } }, rec)).catch(() => {});
    ok(rec.length === 1 && rec[0].kind === "handoff" && /could not decide/.test(rec[0].decision.reasons?.[0] ?? ""), "the thread's order unreadable: one handoff recorded", rec.map((r) => r.decision));
    const rec2: any[] = [];
    const orphan: World = { ...world, companies: async () => { throw new Error("OnSinch 500"); } };
    await decideMessage({ ...m, from_address: "new@nobody.example" }, deps({ world: orphan, threadOrderId: async () => 5 }, rec2)).catch(() => {});
    ok(rec2.length === 1 && rec2[0].kind === "handoff", "the company list unreadable while naming the client from the thread's order: one handoff recorded", rec2.map((r) => r.decision));
  }

  console.log("\n[c] earlier messages are settled only once the newest is decided");
  {
    await at(T0);
    await captureInboundRaw({ thread_id: "tc", messages: [mail("c1", "2026-11-02T08:00:00Z"), mail("c2", "2026-11-02T08:05:00Z", "make it 3")] });
    const threw = await decideDelivery(["c1", "c2"], async () => { throw new Error("v2_decisions insert failed"); }).then(() => false, () => true);
    ok(threw, "the newest's failure reaches intake, which alarms");
    ok((await rowsFor(["c1", "c2"])).length === 0, "and neither message is marked decided, so the sweep reads them together", await rowsFor(["c1", "c2"]));
  }

  console.log("\n[d] the sweep decides what intake stored and never decided");
  {
    await at(T0 + 4 * MIN);
    const early = await sweepUndecided({ decide: async () => { throw new Error("not reached"); } });
    ok((early.decided?.length ?? 0) === 0 && (early.carded?.length ?? 0) === 0, "an email stored under 10 minutes ago is still intake's", early);

    await at(T0 + 20 * MIN);
    const asked: Array<[string, string[]]> = [];
    const decide = async (newest: string, earlier: string[]) => {
      asked.push([newest, earlier]);
      if (newest === "a1") throw new Error("record failed");
      await sql`UPDATE v2_decisions SET kind = 'write', decision = ${JSON.stringify({ kind: "write", ops: [], why: ["test"] })}::jsonb WHERE message_id = ${newest}`;
    };
    const rep = await sweepUndecided({ decide });
    ok(asked.some(([n, e]) => n === "c2" && JSON.stringify(e) === '["c1"]'), "a thread's undecided emails are read together, decided on the newest", asked);
    const c = await rowsFor(["c1", "c2"]);
    ok(c.length === 2 && c[1].kind === "write" && c[0].kind === "none" && /read together with the later email c2/.test(c[0].decision.reason), "the newest carries the decision, the earlier one says it was read with it", c);
    const a = await rowsFor(["a1"]);
    ok(a.length === 1 && a[0].kind === "handoff" && /not decided when it arrived/.test(a[0].decision.reasons[0]), "a decision that fails again leaves exactly one row: a card for a person", a);
    const card = v2Sources((await liveFeedDeps().v2()).filter((r: any) => r.message_id === "a1"), T0 + 20 * MIN)[0];
    ok(card?.item?.kind === "needs-created", "and the TV shows it", card?.item);
    ok(rep.carded?.includes("a1") && rep.decided?.includes("c2"), "the sweep says what it did", rep);

    const again = await sweepUndecided({ decide: async () => { throw new Error("must not be asked twice"); } });
    ok((again.decided?.length ?? 0) === 0 && (again.carded?.length ?? 0) === 0, "a second pass finds nothing left", again);
  }

  console.log("\n[e] an email a later decision already overtook is a card, never re-read");
  {
    await at(T0);
    await captureInboundRaw({ thread_id: "te", messages: [mail("e1", "2026-11-02T08:00:00Z", "4 crew Friday"), mail("e2", "2026-11-02T08:30:00Z", "make it 5")] });
    await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision) VALUES ('e2', 'te', 'sam@client.co.uk', '2026-11-02T08:30:00Z', 'write', ${JSON.stringify({ kind: "write", ops: [], why: [] })}::jsonb)`;
    await at(T0 + 20 * MIN);
    let called = false;
    await sweepUndecided({ decide: async () => { called = true; } });
    const e = await rowsFor(["e1"]);
    ok(!called && e.length === 1 && e[0].kind === "handoff" && /a later email on the thread was decided first/.test(e[0].decision.reasons[0]), "reading it now could undo the later one, so a person reads it", e);
  }

  console.log("\n[f] what the sweep leaves alone");
  {
    await at(T0);
    await captureInboundRaw({ thread_id: "tf", messages: [
      { ...mail("f1", "2026-11-02T08:00:00Z"), from: "Ops <ops@spartancrew.co.uk>" },
      { ...mail("f2", "2026-11-02T08:01:00Z"), from: "bench@test-eventz.co.uk" },
      { ...mail("f3", "2026-11-02T08:02:00Z"), from: "mailer-daemon@googlemail.com" },
    ] });
    await at(T0 + 20 * MIN);
    let called = false;
    await sweepUndecided({ decide: async () => { called = true; } });
    const f = await rowsFor(["f1", "f2", "f3"]);
    ok(!called && f.length === 1 && f[0].message_id === "f3" && f[0].kind === "none", "our own mail and test mail are not decided; system mail gets its 'not a client' row", f);

    await at(T0);
    await captureInboundRaw({ thread_id: "th", messages: [mail("h1", "2026-08-01T08:00:00Z")] });
    await at(T0 + 20 * MIN);
    await sweepUndecided({ decide: async () => { called = true; } });
    ok(!called && (await rowsFor(["h1"])).length === 0, "an email sent weeks ago and stored only now is history (a backfill), never a model call", await rowsFor(["h1"]));

    await at(T0);
    called = false;
    await captureInboundRaw({ thread_id: "tp", messages: [mail("p1", "2026-11-02T08:00:00Z")] });
    await at(T0 + 20 * MIN);
    process.env.SPARTAN_PAUSED = "1";
    const p = await sweepUndecided({ decide: async () => { called = true; } });
    delete process.env.SPARTAN_PAUSED;
    ok(p.paused === true && !called && (await rowsFor(["p1"])).length === 0, "paused, the sweep reads and writes nothing", p);
    const resumed = await sweepUndecided({ decide: async () => { called = true; } });
    ok(called && resumed.decided?.includes("p1"), "and unpaused, the same email is decided (the control for the line above)", resumed);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
