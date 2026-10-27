// ============================================================================
// The addendum's smaller fixes (5.10): F13, F14, F18 and the op key.
// ----------------------------------------------------------------------------
// F13: a failed company-list read was taken as an empty list, so a new client's company was made
// again. F14: a thread's order taken from an old decision was used though OnSinch had deleted it, so
// every later email on the thread was refused as "linked order unreadable". F18: a sender was set
// aside as not a client when "onsinch" or "noreply" appeared anywhere in the address (1 of 64 in
// the 30 days to 27 Oct). The op key: the replacer array filtered nested keys too, so two
// additions differing only in their position's size had one key and the second was never run.
// Against PGlite (fixtures/pg.ts) and a stubbed fetch: nothing reaches OnSinch or production.
// npx tsx test/v2SmallFixes.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.ONSINCH_API_KEY = "test";
const { notClient } = require("../app/lib/v2/process.ts");
const { linkedOrderId } = require("../app/lib/v2/threadOrder.ts");
const { opKey, legacyOpKey } = require("../app/lib/v2/bot/ops.ts");
const { apiCreateOrder } = require("../app/lib/v2/bot/apiCreate.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

(async () => {
  console.log("\n[F18] not a client by the whole domain or the mailbox name, never a substring");
  for (const a of ["bookings@spartancrew.co.uk", "noreply@onsinch.com", "alerts@mail.onsinch.com", "no-reply@client.co.uk", "mailer-daemon@googlemail.com", "postmaster@client.co.uk", "x@sinch.cz"])
    ok(notClient(a), `${a}: not a client`);
  for (const a of ["sam@nonsinch.co.uk", "events@noreplyevents.co.uk", "crew@spartancrew.co.uk.example.com", "ops@onsinchpartners.com"])
    ok(!notClient(a), `${a}: a client (the word is only part of a name)`);

  console.log("\n[F14] a thread's order from an old decision is skipped once OnSinch has deleted it");
  {
    await sql`CREATE TABLE IF NOT EXISTS v2_decisions (message_id TEXT PRIMARY KEY, thread_id TEXT, from_address TEXT, sent_at TEXT, kind TEXT NOT NULL,
      interpretation JSONB, decision JSONB NOT NULL, executed JSONB, code_version TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), company_id INTEGER, company TEXT)`;
    const wrote = (id: string, at: string, order: number) => sql`INSERT INTO v2_decisions (message_id, thread_id, sent_at, kind, decision, executed, code_version, created_at)
      VALUES (${id}, 'tf14', ${at}, 'write', ${JSON.stringify({ kind: "write", ops: [{ source: `${id}#0`, op: { kind: "set_position_size", order_id: order, slot_id: 1, size: 3 } }] })}::jsonb,
      ${JSON.stringify([{ op_key: "k", status: "verified", detail: { order_id: order } }])}::jsonb, 'test', ${at})`;
    await wrote("f14a", "2026-10-10T09:00:00Z", 555);
    await wrote("f14b", "2026-10-12T09:00:00Z", 999);
    ok(await linkedOrderId(sql, "tf14") === 999, "control: with nothing to check, the newest decision's order");
    ok(await linkedOrderId(sql, "tf14", async (id: number) => id !== 999) === 555, "999 deleted: skipped, and the older order still held is the thread's");
    ok(await linkedOrderId(sql, "tf14", async () => false) === null, "both deleted: no order, so the planner finds one by evidence");
    ok(await linkedOrderId(sql, "tf14", async () => { throw new Error("OnSinch 500"); }) === 999, "a read that fails is not a deletion: the order stands and its own read decides");
  }

  console.log("\n[F13] a company list that cannot be read blocks the create, never makes the company again");
  {
    const writes: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push(`${method} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
      if (/\/companies/.test(String(url)) && method === "GET") return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const r = await apiCreateOrder({ kind: "create_order", company_id: "new:Acme Events", company_name: "Acme Events", client_email: "sam@acme.co.uk", job_name: "x", shifts: [] } as any).then(() => "created", (e: Error) => `threw: ${e.message}`);
    globalThis.fetch = realFetch;
    ok(r.startsWith("threw") && writes.length === 0, "the list read failed: thrown before any write, so the op is blocked", { r, writes });
  }

  console.log("\n[op key] every field at every depth is in the key, and keys already in the ledger still match");
  {
    const add = (size: number) => ({ kind: "add_position", order_id: 9, shift_id: 2, date: "2026-11-20", start: "08:00", end: "16:00", position: { size, profession_id: "1" } });
    ok(opKey("m#0", add(2)) !== opKey("m#0", add(3)), "two additions differing only in the position's size have different keys");
    const legacy = (source: string, op: any) => createHash("sha256").update(`${source}\n${op.kind}\n${JSON.stringify(op, Object.keys(op).sort())}`).digest("hex").slice(0, 32);
    const flat = { kind: "set_position_size", order_id: 9, slot_id: 1, size: 3 };
    ok(opKey("m#0", flat) === legacy("m#0", flat), "a flat operation keeps the key it had, so its ledger row is still found");
    ok(legacyOpKey("m#0", add(2)) === legacy("m#0", add(2)), "the old key of a nested operation can still be asked for");
    const run = readFileSync("app/lib/v2/bot/run.ts", "utf8");
    ok(/legacyOpKey\(source, op\)/.test(run), "runOp asks the ledger for the old key too, so an operation run before the change is never run again");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
