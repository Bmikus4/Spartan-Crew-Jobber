// ============================================================================
// SP-10 (interim guard): a later email does not silently remove days it never mentions.
// ----------------------------------------------------------------------------
// The request list is replaced wholesale on every email, so an email about one day read
// as the whole job and the other days were dropped from the order (12 crew became 8,
// characterisation A1). A removed day the client's latest words do not name holds for a
// person; a removal the client asked for ("drop Friday") still applies.
//
// Offline.  npx tsx test/amendmentGuard.ts
// ============================================================================
import { createHash } from "node:crypto";
import { assessAmendment } from "../app/lib/engine/amendment";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
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

const team = (day: string, size = 4) => ({ name: "Crew", profession_id: 1, place_id: 88, size, beginning: `${day}T08:00:00+00:00`, end: `${day}T16:00:00+00:00` });
const order = (...days: string[]) => ({ company_id: 42, slot_teams: days.map((d) => team(d)) }) as unknown as DesiredOrder;
const REF = new Date("2026-03-02T09:00:00Z");

async function main() {
  console.log("\n[1] the rule");
  {
    const prior = order("2026-03-11", "2026-03-12", "2026-03-13");
    const one = order("2026-03-12");
    const v = assessAmendment(prior, one, { text: "Can we make the 12th a 7am start please", reference: REF });
    ok(v.action === "hold", "days the email never names are not removed", v.note ?? "");
    ok(/2026-03-11, 2026-03-13/.test(v.note ?? "") && /2 block/.test(v.note ?? ""), "and the note names them", v.note ?? "");

    const byDate = assessAmendment(prior, one, { text: "Please drop the 11th and the 13th, just the 12th now", reference: REF });
    ok(byDate.action === "apply", "removals named by date apply", byDate.note ?? "");

    const byWeekday = assessAmendment(order("2026-03-12", "2026-03-13"), order("2026-03-12"), { text: "We no longer need Friday", reference: REF });
    ok(byWeekday.action === "apply", "a removal named by weekday applies (13 March 2026 is a Friday)", byWeekday.note ?? "");

    ok(assessAmendment(prior, order("2026-03-11", "2026-03-12", "2026-03-13")).action === "apply", "no day removed: nothing to guard");
    ok(assessAmendment(prior, one).action === "apply", "without the latest text the old rule stands (callers that have none)");
  }

  console.log("\n[2] through the pipeline: 3 days booked, the next email speaks of one");
  {
    __resetListCache();
    const DAYS = ["2026-03-11", "2026-03-12", "2026-03-13"];
    let facts: ConversationFacts = {
      company_name: "RedBeast Energy", contact_email: "pier@redbeast.co.uk", location_text: "2 Savoy Place London WC2R 0BL",
      requests: DAYS.map((date) => ({ date, start_time: "08:00", end_time: "16:00", size: 4, task: "load/unload" })),
    };
    let writes = 0;
    const reasoner: Reasoner = {
      async classifyAndExtract() { return { classification: "update", priority: "high", job_summary: "crew", facts } as ClassifyResult & { facts: ConversationFacts }; },
      async classify(): Promise<ClassifyResult> { return { classification: "update", priority: "high", job_summary: "crew" }; },
      async extractFacts() { return facts; },
      async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
    };
    const onsinch = new OnsinchClient(mockTransport);
    const executor: Executor = {
      async createReplyDraft() { return "draft"; },
      async createOrder(o) { return onsinch.createOrder(buildOrderBody(o)); },
      async patchOrder() { writes++; return []; },
      async amendOrderInPlace() { writes++; return { declined: "test" } as any; },
      async replaceOrder() { writes++; return { deleted: false, refused: "test" } as any; },
    };
    let clock = Date.parse("2026-03-01T09:00:00Z");
    const deps: PipelineDeps = {
      reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
      settings: { ...DEFAULT_SETTINGS },
      hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
      flagForManual: async () => {},
    };
    const m1 = msg({ message_id: "v1", date_iso: "2026-03-01T09:00:00Z", subject: "Crew", body: "4 crew each day 11, 12 and 13 March, 8am to 4pm, 2 Savoy Place London WC2R 0BL. RedBeast Energy" });
    const booked = await handleThread({ thread_id: "t-a1", messages: [m1] }, deps);
    ok(Number(booked.onsinch_order_id) > 0, "three days booked", String(booked.onsinch_order_id));

    facts = { ...facts, requests: [{ date: "2026-03-12", start_time: "07:00", end_time: "16:00", size: 4, task: "load/unload" }] };
    const m2 = msg({ message_id: "v2", date_iso: "2026-03-02T09:00:00Z", subject: "Re: Crew", body: "Can the 12th start at 7am instead? RedBeast Energy" });
    const after = await handleThread({ thread_id: "t-a1", messages: [m1, m2] }, deps);
    ok(after.status === "proposed" && !!after.pending_order, "held as proposed with the change staged", `${after.status} pending=${!!after.pending_order}`);
    ok(writes === 0, "and nothing was written to OnSinch", String(writes));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
