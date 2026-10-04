// ============================================================================
// SP-11: a change only to the job summary is not a change OnSinch can take.
// ----------------------------------------------------------------------------
// PATCH /orders answers 204 and ignores `specification` (S-0017, #15805). It was in the
// order hash and in patchOrder's applied list, so a reworded summary on a later email was
// patched, logged as applied and tagged Order Updated while OnSinch kept the old text.
//
// Offline.  npx tsx test/specNotApplied.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { writeShape } from "../app/lib/engine/compiler";
import { OnsinchClient, __resetListCache } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts, type DesiredOrder } from "../app/lib/engine/types";
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
const first = msg({ message_id: "v1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "Please book 4 crew on 9 March 08:00-16:00 at 2 Savoy Place London WC2R 0BL. RedBeast Energy" });
const second = msg({ message_id: "v2", date_iso: "2026-03-02T09:00:00Z", subject: "Re: Crew", body: "Just to say it is the product launch. Same crew and times. RedBeast Energy" });

function rig() {
  let summary = "crew for a launch";
  const patches: unknown[] = [];
  const updatedTags: unknown[] = [];
  const reasoner: Reasoner = {
    async classifyAndExtract() { return { classification: "update", priority: "high", job_summary: summary, facts: FACTS } as ClassifyResult & { facts: ConversationFacts }; },
    async classify(): Promise<ClassifyResult> { return { classification: "update", priority: "high", job_summary: summary }; },
    async extractFacts() { return FACTS; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  const onsinch = new OnsinchClient(mockTransport);
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder(p) { patches.push(p); return ["specification"]; },
  };
  let clock = Date.parse("2026-03-01T09:00:00Z");
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    flagForManual: async () => {},
    flagOrderUpdated: async (t: unknown) => { updatedTags.push(t); },
  };
  return { deps, patches, updatedTags, reword: (s: string) => { summary = s; } };
}

async function main() {
  console.log("\n[1] writeShape drops what PATCH cannot write and nothing else");
  {
    const d = { company_id: 1, specification: "x", intern_name: "PO-1", slot_teams: [] } as unknown as DesiredOrder;
    const w = writeShape(d) as any;
    ok(!("specification" in w) && w.intern_name === "PO-1" && w.company_id === 1, "specification out, the rest kept", JSON.stringify(w));
  }

  console.log("\n[2] booked, then an email that only rewords the summary");
  {
    __resetListCache();
    const r = rig();
    const booked = await handleThread({ thread_id: "t-spec", messages: [first] }, r.deps);
    ok(Number(booked.onsinch_order_id) > 0, "the first email booked", String(booked.onsinch_order_id));
    r.reword("crew for the product launch at the IET");
    const after = await handleThread({ thread_id: "t-spec", messages: [first, second] }, r.deps);
    ok(r.patches.length === 0, "no PATCH is sent for it", JSON.stringify(r.patches).slice(0, 200));
    ok(r.updatedTags.length === 0, "and the thread is not tagged Order Updated", String(r.updatedTags.length));
    ok(!(after.order_action_log ?? []).some((a) => a.kind === "patch" && a.ok), "and no patch is logged as applied",
      JSON.stringify((after.order_action_log ?? []).map((a) => `${a.kind}:${a.ok}`)));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
