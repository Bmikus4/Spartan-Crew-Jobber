// ============================================================================
// What a reason means is read in one place (addendum F52, ADDENDUM R19).
// ----------------------------------------------------------------------------
// The TV's reply test (feed/v2.ts) and the planner's "ask the client" test (plan.ts) kept their own copies of
// the reasons' words, and both had already lost the venue form reasons.ts holds; the sweep matched "not a
// client's email" as SQL text. Pinned: no module outside reasons.ts keeps such a copy; each reason the
// planner gives means what its code says; and the sweep reads the stored code, so a not-a-client decision
// whose words changed still does not overtake an undecided email (PGlite; no model is called).
// npx tsx --require ./test/fixtures/pg.ts test/reasonsOneSource.ts
// ============================================================================
import { sql, clock, syncSqlClock } from "./fixtures/pg";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.VERCEL_GIT_COMMIT_SHA = "test";
delete process.env.SPARTAN_PAUSED;
const { isReplyReason, isMissingDetail, NOT_CLIENT } = require("../app/lib/v2/reasons.ts");
const { captureInboundRaw } = require("../app/lib/inboundRawDb.ts");
const { sweepUndecided } = require("../app/lib/v2/process.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });

(async () => {
  console.log("\n[one copy] no module but reasons.ts keeps the reply or not-a-client words to match on");
  {
    const copies = walk("app").filter((f) => !/reasons\.ts$|cardNote\.ts$/.test(f)).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /\/[^/\n]*the client wrote\$[^/\n]*\//.test(s) || /\/[^/\n]*asked for a quote\|[^/\n]*\//.test(s) || /'not a client''s email'/.test(s);
    });
    ok(copies.length === 0, "none (cardNote.ts words the card's text, not what it does)", copies);
  }

  console.log("\n[meaning] each reason the planner gives means what its code says");
  ok(isReplyReason("the client asked for a quote") && isReplyReason("the request is unclear"), "a quote and an unclear request are replies");
  ok(isMissingDetail("request 1: no crew count the client wrote") && isMissingDetail("no venue in the email") && isMissingDetail("request 2: no venue the client wrote"), "a missing detail is the client's to give, the venue form included");
  ok(!isReplyReason("a new booking from 2026-11-20, within 14 days of the email, is for staff to create") && !isMissingDetail("R11100 not found"), "control: a rule or a booking not found is not a reply");

  console.log("\n[sweep] the stored code says not-a-client, whatever the words");
  {
    const T0 = Date.parse("2026-11-03T09:00:00Z");
    clock.set(T0); await syncSqlClock();
    const mail = (id: string, at: string) => ({ message_id: id, from: "Sam <sam@client.co.uk>", to: ["bookings@spartancrew.co.uk"], date_iso: at, subject: "Crew", body: "Please add 2 crew on Friday" });
    await captureInboundRaw({ thread_id: "tn", messages: [mail("n1", "2026-11-03T08:00:00Z")] });
    await captureInboundRaw({ thread_id: "to", messages: [mail("o1", "2026-11-03T08:00:00Z")] });
    await sql`INSERT INTO v2_decisions (message_id, thread_id, sent_at, kind, decision) VALUES
      ('n2', 'tn', '2026-11-03T08:30:00Z', 'none', ${JSON.stringify({ kind: "none", reason: "an automatic reply, worded anew", code: "none_not_client" })}::jsonb),
      ('o2', 'to', '2026-11-03T08:30:00Z', 'none', ${JSON.stringify({ kind: "none", reason: "no change asked for", code: "none_nothing_to_do" })}::jsonb)`;
    clock.set(T0 + 20 * 60_000); await syncSqlClock();
    const asked: string[] = [];
    await sweepUndecided({ decide: async (id: string) => { asked.push(id); }, limit: 10 });
    ok(asked.includes("n1"), "a later not-a-client decision, reworded, does not overtake: the email is read", asked);
    ok(!asked.includes("o1"), "control: a later client decision does overtake, so a person reads it", asked);
  }
  ok(NOT_CLIENT === "not a client's email", "the stored wording is unchanged, so older rows still match");

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
