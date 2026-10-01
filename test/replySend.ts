// ============================================================================
// A reply is sent only when it is asked for twice; otherwise it stays a draft.
// ----------------------------------------------------------------------------
// The settings screen offered "send" with no send path behind it. Ben, 2026-10-01:
// "build it, leave it off". It needs BOTH the reply_delivery setting AND the server
// switch SPARTAN_SEND_REPLIES=1: the setting is one click on a screen ops use daily, and a
// sent email cannot be taken back. A failed send leaves the draft where it was.
//
// Offline.  npx tsx test/replySend.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { sendDraft } from "../app/lib/mail/gmailWrite";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts, type Settings } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const FACTS: ConversationFacts = {
  company_name: "RedBeast Energy", contact_email: "pier@redbeast.co.uk", location_text: "2 Savoy Place London WC2R 0BL",
  requests: [{ date: "2026-03-09", start_time: "08:00", end_time: "16:00", size: 4, task: "load/unload" }],
};
const reasoner: Reasoner = {
  async classifyAndExtract() { return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS } as ClassifyResult & { facts: ConversationFacts }; },
  async classify(): Promise<ClassifyResult> { return { classification: "new-job", priority: "high", job_summary: "x" }; },
  async extractFacts() { return FACTS; },
  async composeReply(): Promise<ReplyResult> { return { subject: "Re: Crew", html: "<div><p>Hello,</p><p>Thanks, we'll get that booked in.</p><p>Thanks,<br>Spartan Crew</p></div>", priority: "medium" }; },
};

async function run(settings: Partial<Settings>, env: string | undefined, sendFails = false) {
  if (env === undefined) delete process.env.SPARTAN_SEND_REPLIES; else process.env.SPARTAN_SEND_REPLIES = env;
  const onsinch = new OnsinchClient(mockTransport);
  const sent: string[] = [];
  const executor: Executor = {
    async createReplyDraft() { return "draft-7"; },
    async sendReplyDraft(id: string) { if (sendFails) throw new Error("Gmail 500"); sent.push(id); return "msg-9"; },
    async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { return []; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const deps = {
    reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS, replies_enabled: true, ...settings }, repliesEnabled: true,
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  } as unknown as PipelineDeps;
  const s = await handleThread({ thread_id: "t-r", messages: [msg({ message_id: "r1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Please book 4 crew on 9 March 08:00-16:00 at 2 Savoy Place London WC2R 0BL. RedBeast Energy" })] }, deps);
  return { s, sent };
}

async function main() {
  console.log("\n[1] asked for twice: sent");
  { const r = await run({ reply_delivery: "send" }, "1"); ok(r.sent.join() === "draft-7" && (r.s as any).reply_sent_id === "msg-9", "the draft is sent", JSON.stringify(r.sent)); }

  console.log("\n[2] the setting alone: still a draft");
  { const r = await run({ reply_delivery: "send" }, undefined); ok(r.sent.length === 0 && r.s.reply_draft_id === "draft-7", "not sent without the server switch"); }

  console.log("\n[3] the switch alone: still a draft");
  { const r = await run({ reply_delivery: "draft" }, "1"); ok(r.sent.length === 0, "not sent while the setting says draft"); }

  console.log("\n[4] a failed send leaves the draft and says so");
  {
    const r = await run({ reply_delivery: "send" }, "1", true);
    ok(r.s.reply_draft_id === "draft-7" && !(r.s as any).reply_sent_id && r.s.notes.some((n) => /not sent/i.test(n)), "draft kept, reason noted", JSON.stringify(r.s.notes.slice(-1)));
  }

  console.log("\n[5] the Gmail call sends that draft by id");
  {
    const calls: Array<{ path: string; body: any }> = [];
    const id = await sendDraft(async (_m, path, body) => { calls.push({ path, body }); return { id: "msg-1" }; }, "draft-3");
    ok(calls[0]?.path === "drafts/send" && calls[0]?.body?.id === "draft-3" && id === "msg-1", "POST drafts/send {id}", JSON.stringify(calls));
  }

  delete process.env.SPARTAN_SEND_REPLIES;
  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
