// ============================================================================
// A draft that sends a document carries [ATTACH HERE] for the person who sends it.
// ----------------------------------------------------------------------------
// Ben, 2026-09-30: drafts that refer to something attached, or say a colleague will
// follow up with it, are written for the team to add the attachment — every one gets a
// note reading [ATTACH HERE] in capitals, for quotes and everything else, and it must
// read well. The prompt asks for it; markAttachments guarantees it.
//
// Offline.  npx tsx test/attachHere.ts
// ============================================================================
import { createHash } from "node:crypto";
import { markAttachments, sendsADocument, ATTACH_TOKEN } from "../app/lib/engine/attachHere";
import { REPLY_SYSTEM } from "../app/lib/engine/prompts";
import { CHASE_SYSTEM } from "../app/lib/followup/compose";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const draft = (body: string) => `<div>\n  <p>Hello Jack,</p>\n  <p>${body}</p>\n  <p>Thanks,<br>Spartan Crew</p>\n</div>`;
const count = (s: string) => s.split(ATTACH_TOKEN).length - 1;

async function main() {
  console.log("\n[1] a draft that sends a document gets the marker, before the sign-off");
  for (const body of [
    "Please find the quote for the 12th attached.",
    "I've attached the invoice for last week.",
    "Attached is the COI you asked for.",
    "We're attaching the RAMS for the build.",
    "The timesheet will be sent over separately.",
    "A colleague will send the quote shortly.",
  ]) {
    const out = markAttachments(draft(body));
    ok(count(out) === 1 && out.indexOf(ATTACH_TOKEN) < out.indexOf("Spartan Crew"), body, out.replace(/\s+/g, " "));
  }

  console.log("\n[2] the client's own attachment is not ours to attach");
  for (const body of ["Thanks for the PO you attached.", "Got your attached site plan, all clear.", "Thanks, we'll get that booked in."]) {
    ok(!sendsADocument(draft(body)) && count(markAttachments(draft(body))) === 0, body);
  }

  console.log("\n[3] the model's own marker is kept once, in capitals");
  {
    const out = markAttachments(draft("Please find the quote attached.</p>\n  <p>[attach here]"));
    ok(count(out) === 1 && !/\[attach here\]/.test(out), "lower case normalised, not doubled", out.replace(/\s+/g, " "));
    const already = draft(`Please find the quote attached.</p>\n  <p>${ATTACH_TOKEN}`);
    ok(markAttachments(already) === already, "a correct draft is left alone");
  }

  console.log("\n[4] both prompts ask for it, and neither still says a colleague will send it");
  ok(REPLY_SYSTEM.includes(ATTACH_TOKEN) && CHASE_SYSTEM.includes(ATTACH_TOKEN), "the token is in the reply and chase prompts");
  ok(!/document is\s+wanted, say a colleague will send it/i.test(REPLY_SYSTEM) && /NEVER say a colleague will send it/.test(REPLY_SYSTEM),
    "the old 'say a colleague will send it' instruction is now a prohibition");
  ok(/call 999/.test(REPLY_SYSTEM) && !/911/.test(REPLY_SYSTEM), "UK emergency number");

  console.log("\n[5] the draft that reaches Gmail carries it");
  {
    const FACTS: ConversationFacts = {
      company_name: "RedBeast Energy", contact_email: "pier@redbeast.co.uk", location_text: "2 Savoy Place London WC2R 0BL",
      requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "16:00", size: 4, task: "load/unload" }],
    };
    const reasoner: Reasoner = {
      async classifyAndExtract() { return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS } as ClassifyResult & { facts: ConversationFacts }; },
      async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "high", job_summary: "x" }; },
      async extractFacts() { return FACTS; },
      async composeReply(): Promise<ReplyResult> { return { subject: "Re: Crew", html: draft("Please find the quote for the 9th attached."), priority: "medium" }; },
    };
    const onsinch = new OnsinchClient(mockTransport);
    const drafts: string[] = [];
    const executor: Executor = {
      async createReplyDraft(a) { drafts.push(a.html); return "draft-1"; },
      async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
      async patchOrder() { return []; },
    };
    let clock = Date.parse("2026-03-01T09:00:00Z");
    const deps = {
      reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
      settings: { ...DEFAULT_SETTINGS, replies_enabled: true }, repliesEnabled: true,
      hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    } as unknown as PipelineDeps;
    await handleThread({ thread_id: "t-q", messages: [msg({ message_id: "q1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Can I get a quote for 4 crew on 9 March 08:00-16:00 at 2 Savoy Place London WC2R 0BL? RedBeast Energy" })] }, deps);
    ok(drafts.length === 1 && count(drafts[0]) === 1, "one draft, one [ATTACH HERE]", drafts[0]?.replace(/\s+/g, " "));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
