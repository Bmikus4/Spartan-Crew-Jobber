// ============================================================================
// SP-13: a dry reconcile writes nothing, by construction.
// ----------------------------------------------------------------------------
// The old sandbox overrode the writes it knew about and passed everything else through,
// so a dry `lost` still posted its Gmail label and a dry run still wrote metrics. The
// sandbox is now an allowlist: any deps key not named is absent, and OnSinch refuses
// every non-GET at the transport.
//
// Offline.  npx tsx test/drySandbox.ts
// ============================================================================
import { reconcileThread, __resetApiUser } from "../app/lib/engine/sweep";
import { drySandbox, DRY_PASS_THROUGH } from "../app/lib/engine/sweepSandbox";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { PipelineDeps } from "../app/lib/engine/pipeline";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const TODAY = "2026-09-14T09:00:00Z";
const DAY = "2026-09-20";
const ORDER = 15998;
const TEAM = 40988;
const TEAMS = [{ name: "General", size: 4, profession_id: 1, place_id: 16689, beginning: `${DAY}T09:30:00+00:00`, end: `${DAY}T14:00:00+00:00` }];
const bound = (): ConversationState =>
  ({
    thread_id: "T-dry", subject: "Re: Crew", status: "ordered", classification: "update", needs_human: false, notes: [],
    order_action_log: [{ ts: 0, kind: "create", order_id: ORDER, ok: true }],
    company_id: 42, place_id: 16689, onsinch_order_id: ORDER, onsinch_order_number: "10998", onsinch_job_id: 16055,
    desired_order: { company_id: 42, slot_teams: TEAMS }, last_ordered_teams: TEAMS, last_ordered_team_ids: [TEAM],
    facts: { requests: [{ date: DAY, start_time: "09:30", end_time: "14:00", size: 4 }], location_text: "HQ" },
    built_flagged: true,
  }) as unknown as ConversationState;

/** A deps object shaped like buildDeps(), every write recorded. */
function fullDeps(orders: any[], slot?: Record<string, unknown>) {
  __resetApiUser();
  const writes: string[] = [];
  const onsinch = new OnsinchClient(async (method, path) => {
    if (method !== "GET") { writes.push(`onsinch ${method} ${path}`); return { status: 204, data: null }; }
    const page = (data: unknown[]) => ({ status: 200 as const, data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } } });
    if (path.startsWith("/users/profile")) return { status: 200 as const, data: { data: { id: 2257 } } };
    if (path.startsWith("/orders")) {
      const m = /[?&]id(?:\[eq\])?=(\d+)/.exec(path);
      return page(m ? orders.filter((o) => Number(o.id) === Number(m[1])) : orders);
    }
    if (path.startsWith("/attendance")) return page(slot ? [{ Slot: [{ slotteam_id: TEAM, ...slot, name: "" }], SlotTeam: [{ id: TEAM, name: "General" }] }] : []);
    return page([]);
  });
  const rec = (name: string) => async () => { writes.push(name); return [] as any; };
  const deps = {
    onsinch, now: () => 1, settings: {},
    readThread: async () => ({ thread_id: "T-dry", messages: [] }),
    store: { get: async () => undefined, put: rec("store.put"), all: async () => [] },
    executor: { patchOrder: rec("executor.patchOrder"), amendOrderInPlace: rec("executor.amend"), createOrder: rec("executor.createOrder") },
    metrics: { emit: rec("metrics.emit"), record: rec("metrics.record") },
    linkJudge: { decide: rec("linkJudge") },
    flagForManual: rec("flagForManual"), flagOrderBuilt: rec("flagOrderBuilt"), flagOrderUpdated: rec("flagOrderUpdated"), flagSupervised: rec("flagSupervised"),
    ensureOrderRecord: rec("ensureOrderRecord"), aliases: { record: rec("aliases.record") }, archiveOrder: rec("archiveOrder"),
  } as unknown as PipelineDeps;
  return { deps, writes };
}

(async () => {
  console.log("\n[1] the sandbox carries only the allowlist");
  {
    const { deps } = fullDeps([]);
    const dry = drySandbox(deps) as unknown as Record<string, unknown>;
    const allowed = new Set<string>([...DRY_PASS_THROUGH, "onsinch", "store", "executor"]);
    const extra = Object.keys(dry).filter((k) => !allowed.has(k));
    ok(extra.length === 0, "no key outside the allowlist", extra.join(", "));
    for (const k of ["flagForManual", "flagOrderBuilt", "flagOrderUpdated", "flagSupervised", "metrics", "linkJudge", "ensureOrderRecord", "aliases", "archiveOrder"]) {
      ok(dry[k] === undefined, `${k} is absent`);
    }
    let refused = 0;
    for (const f of Object.values(dry.executor as Record<string, () => Promise<unknown>>)) { try { await f(); } catch { refused++; } }
    ok(refused === Object.keys(dry.executor as object).length, "every executor method throws", String(refused));
    let onsinchRefused = false;
    try { await (dry.onsinch as OnsinchClient).patchOrder([{ id: 1 } as any]); } catch { onsinchRefused = true; }
    ok(onsinchRefused, "OnSinch refuses a write at the transport");
  }

  console.log("\n[2] a dry lost and a dry unapplied write nothing anywhere");
  {
    const other = { id: 16011, number: "11011", happening: "2026-12-01T09:30:00+00:00", name: "Elsewhere", Job: [{ id: 16071 }] };
    const lost = fullDeps([other]);
    const r1 = await reconcileThread(bound(), drySandbox(lost.deps), { todayISO: TODAY });
    ok(r1.action === "lost", "lost, as a real run would say", r1.action);
    ok(lost.writes.length === 0, "and zero writes: no label, no metric, no store", lost.writes.join(", "));

    const LIVE = { id: ORDER, number: "10998", happening: `${DAY}T09:30:00+00:00`, Job: [{ id: 16055, min_beginning: `${DAY}T09:30:00+00:00`, max_end: `${DAY}T11:00:00+00:00` }] };
    const s2 = bound(); s2.last_ordered_teams = undefined; s2.last_ordered_team_ids = undefined;
    const un = fullDeps([LIVE]);
    const r2 = await reconcileThread(s2, drySandbox(un.deps), { todayISO: TODAY });
    ok(r2.action === "unactionable", "a dry unactionable reads the same", r2.action);
    ok(un.writes.length === 0, "and writes nothing", un.writes.join(", "));
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
