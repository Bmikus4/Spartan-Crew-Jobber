// ============================================================================
// Replay: production's stored readings through the CURRENT planner, on the time-correct world.
// ----------------------------------------------------------------------------
// The reader is the model reading production stored for the email (readings.json, the
// interpretation's extraction). Nothing calls a model: `extract` returns the stored reading or
// throws, and the network is closed before the first email. decideMessage is production's own
// entry (process.ts:359); every boundary it reads is rebuilt as of the email's arrival:
//   world          TimeWorld (world.ts)
//   threadOrderId  the thread's link as it stood then (TimeWorld.threadOrderAt)
//   thread         the thread's earlier messages, last 6, each cut to its newest part (process.ts:475)
//   threadMessages the thread up to and including the email (production reads the whole thread;
//                  later messages did not exist when it decided)
//   prior          the grounded requests of the thread's earlier decided emails, as THIS replay
//                  grounded them: earlier emails are replayed first, oldest first, unscored
//   now            the email's arrival; a day before it is refused, as at intake
//   run            a recorder that answers "verified": what OnSinch would have refused is unknown
// Emails production read together with a later one (process.ts:204-224) are joined to it the
// same way processMessage joins them (process.ts:494-495).
// ============================================================================
import { decideMessage, readContext, type MessageIn, type Recorded } from "../../app/lib/v2/process";
import { PROMPT_ID } from "../../app/lib/v2/interpret/extract";
import { latestText } from "../../app/lib/v2/interpret/ground";
import type { Request } from "../../app/lib/v2/interpret/interpret";
import type { Decision } from "../../app/lib/v2/interpret/plan";
import { opKey, utcToLondon } from "../../app/lib/v2/bot/ops";
import { noTrace } from "../../app/lib/v2/trace";
import { coded } from "../../app/lib/v2/reasons";
import { closeNetwork, preflight } from "../core/preflight";
import { addr, gold, type GoldDecision, type GoldMessage } from "./data";
import { carrierOf, cardOf, outcomeOfCard, proposesNew, type SystemRow } from "./system";
import { Index, TimeWorld, placeCeiling, type Limits } from "./world";

export type EmailLimits = Limits & {
  links_state_unknown: number;
  absent_staff_orders_unrebuildable: number;
  absent_api_orders_unrebuildable: number;
  thread_msgs_stored_after_decision: number;
  reading_pick_not_offered: number;
  reading_made_late: boolean;
  no_stored_reading: boolean;
  /** Replay named a different client than production did: contacts are as of the snapshot, so one added later shows here. */
  client_differs: boolean;
  /** Places the replay's write names above every place id in use when the email arrived: possibly created after it. */
  write_place_after: number;
};

const T = (s: unknown) => Date.parse(String(s ?? "")) || 0;
const ours = (m: GoldMessage) => !!m.is_from_spartan || /@spartancrew\.co\.uk$/i.test(addr(m.from_address));

/**
 * `askedDays`: the days the readers named, for checking a replayed "already booked" against the
 * time-correct world the way booked.mts checked production's (an order the reason names with a
 * live shift on an asked day). The check is reported beside the score; it never changes it.
 */
export async function replay(evalIds: string[], askedDays: (id: string) => string[] = () => []): Promise<{ rows: Map<string, SystemRow>; limits: Map<string, EmailLimits>; booked: Map<string, boolean>; runs: number; warmups: number; modelCalls: number; netAttempts: number; preflight: string[] }> {
  // Isolation first: no production credential, no network, the world a fake (OPERATING §8.1).
  const ix = new Index();
  const pf = preflight({ env: process.env, allowHosts: [], adapterChecks: [{ name: "the world is the time-correct fake", ok: new TimeWorld(ix, 0).fake === true, detail: "TimeWorld" }] });
  if (!pf.ok) throw new Error(`preflight failed: ${pf.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join("; ")}`);
  closeNetwork([]);
  let netAttempts = 0;
  const closed = globalThis.fetch;
  globalThis.fetch = ((...a: Parameters<typeof fetch>) => { netAttempts++; return closed(...a); }) as typeof fetch;

  const msgs = gold<GoldMessage[]>("messages.json");
  const byId = new Map(msgs.map((m) => [m.message_id, m]));
  const dec = new Map(gold<GoldDecision[]>("decisions.json").map((d) => [d.message_id, d]));
  const reading = new Map(gold<any[]>("readings.json").map((r) => [r.message_id, r.extraction]));
  const byThread = new Map<string, GoldMessage[]>();
  for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
  for (const l of byThread.values()) l.sort((a, b) => T(a.date_iso) - T(b.date_iso));
  // Production's read-together groups: the earlier emails joined into the later one's body.
  const together = new Map<string, string[]>();
  for (const d of dec.values()) {
    const later = /^read together with the later email (\S+)/.exec(String(d.decision?.reason ?? ""))?.[1];
    if (later) together.set(later, [...(together.get(later) ?? []), d.message_id]);
  }
  for (const [k, v] of together) together.set(k, v.sort((a, b) => T(byId.get(a)?.date_iso) - T(byId.get(b)?.date_iso)));

  const evalSet = new Set(evalIds);
  const last = Math.max(...evalIds.map((id) => T(byId.get(id)!.date_iso)));
  const threads = new Set(evalIds.map((id) => byId.get(id)!.thread_id));
  // Warm-ups: earlier emails on the same threads whose reading production stored, so `prior` is HEAD's own.
  const warm = [...dec.values()].filter((d) => threads.has(d.thread_id) && !evalSet.has(d.message_id) && reading.has(d.message_id) && byId.has(d.message_id) && T(byId.get(d.message_id)!.date_iso) < last);
  const order = [...evalIds, ...warm.map((d) => d.message_id)].map((id) => byId.get(id)!).sort((a, b) => T(a.date_iso) - T(b.date_iso) || a.message_id.localeCompare(b.message_id));

  const done = new Map<string, Recorded>();
  const rows = new Map<string, SystemRow>();
  const limits = new Map<string, EmailLimits>();
  const booked = new Map<string, boolean>();
  let modelCalls = 0;
  for (const m0 of order) {
    const at = T(m0.date_iso);
    // AN EMAIL INTAKE READ WITH A LATER ONE IS NEVER DECIDED ON ITS OWN (process.ts:216): its text is
    // in the later email's body here too, and its own row is "read together", as production's was.
    const carrier = carrierOf(dec.get(m0.message_id)?.decision);
    if (carrier) {
      if (!evalSet.has(m0.message_id)) continue;
      const decision: Decision = coded({ kind: "none", reason: `read together with the later email ${carrier}` });
      rows.set(m0.message_id, { message_id: m0.message_id, kind: "none", decision, executed: null, outcome: "none", card: null, code: decision.code ?? "uncoded", proposes_new: false, company_id: null, latency_ms: 0, cost_usd: 0, carried_by: carrier });
      // Not replayed, so no limits row: the limits table counts emails the world was rebuilt for.
      continue;
    }
    const world = new TimeWorld(ix, at);
    const withIds = together.get(m0.message_id) ?? [];
    const body = withIds.length ? [...withIds.map((id) => latestText(String(byId.get(id)?.body ?? ""))), latestText(String(m0.body ?? ""))].join("\n\n") : m0.body;
    const m: MessageIn = { message_id: m0.message_id, thread_id: m0.thread_id, from_address: m0.from_address, date_iso: m0.date_iso, subject: m0.subject, body, is_from_spartan: m0.is_from_spartan };
    const thread = byThread.get(m0.thread_id) ?? [];
    const skip = new Set([m0.message_id, ...withIds]);
    const lines = thread.filter((x) => T(x.date_iso) < at && !skip.has(x.message_id)).slice(-6)
      .map((x) => ({ who: x.is_from_spartan ? ("spartan" as const) : ("client" as const), at: String(x.date_iso), text: latestText(String(x.body ?? "")) }));
    const prior = (): Request[] => thread
      .filter((x) => T(x.date_iso) < at && done.get(x.message_id)?.interpretation && T(dec.get(x.message_id)?.created_at) <= at)
      .flatMap((x) => done.get(x.message_id)!.interpretation!.grounded.requests ?? []);
    const link = world.threadOrderAt(m0.thread_id);
    const x = reading.get(m0.message_id);
    let recorded: Recorded | null = null;
    const t0 = Date.now();
    await decideMessage(m, {
      extract: async () => {
        if (!x) throw new Error("no stored reading for this email");
        return { x: structuredClone(x), meta: { model: "stored reading", prompt_id: PROMPT_ID, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } };
      },
      world,
      threadOrderId: async () => link.order_id,
      thread: async () => lines,
      prior: async () => prior(),
      threadMessages: async () => thread.filter((t) => T(t.date_iso) <= at).map((t) => ({
        message_id: t.message_id, from: addr(t.from_address), to: ([] as unknown[]).concat(t.to_addresses ?? []).map(String), at: T(t.date_iso),
        subject: String(t.subject ?? ""), body: String(t.body ?? ""), ours: ours(t),
      })),
      run: async (source, op) => ({ op_key: opKey(source, op), status: "verified", reasons: [] }),
      now: () => at,
      link: async () => {},
      record: async (r) => { recorded = structuredClone(r); },
      trace: noTrace,
    });
    const ms = Date.now() - t0;
    const r = recorded as Recorded | null;
    if (!r) throw new Error(`replay: ${m0.message_id} ended with no recorded decision`);
    done.set(m0.message_id, r);
    if (!evalSet.has(m0.message_id)) continue;

    const card = cardOf({ thread_id: m0.thread_id, message_id: m0.message_id, sent_at: m0.date_iso, subject: m0.subject, from_address: addr(m0.from_address) }, r.kind, r.decision, r.executed, r.interpretation?.grounded ?? null, r.client.id);
    rows.set(m0.message_id, {
      message_id: m0.message_id, kind: r.kind, decision: r.decision, executed: r.executed, outcome: outcomeOfCard(card), card, code: r.decision.code ?? "uncoded",
      proposes_new: proposesNew(r.kind, r.decision, card), company_id: r.client.id, latency_ms: ms, cost_usd: 0, carried_by: carrierOf(r.decision),
    });
    // What the time-correct world could not restore for this email.
    let notOffered = 0;
    if (x && r.client.id) {
      const ctx = await readContext(world, r.client.id, m0.date_iso, lines);
      const offered = new Set(ctx.bookings.map((b) => b.order.replace(/^R/i, "")));
      const picks = [x.order, ...(x.requests ?? []).map((q: any) => q.order)].filter(Boolean).map((p: string) => String(p).replace(/^R/i, ""));
      notOffered = picks.filter((p) => !offered.has(p)).length;
    }
    const pd = dec.get(m0.message_id);
    const gone = world.absentUnrebuildable();
    limits.set(m0.message_id, {
      ...world.limits,
      links_state_unknown: link.links_state_unknown,
      absent_staff_orders_unrebuildable: gone.staff,
      absent_api_orders_unrebuildable: gone.api,
      thread_msgs_stored_after_decision: pd ? thread.filter((t) => T(t.date_iso) < at && T(t.first_seen_at) > T(pd.created_at)).length : 0,
      reading_pick_not_offered: notOffered,
      reading_made_late: !!pd && T(pd.created_at) - T(pd.sent_at) > 3600e3,
      no_stored_reading: !x && r.kind !== "none",
      client_differs: !!pd && (pd.company_id ?? null) !== (r.client.id ?? null),
      write_place_after: r.decision.kind === "write" ? r.decision.ops.flatMap(({ op }: any) => (op.shifts ?? []).map((sh: any) => Number(sh.place_id))).filter((p: number) => p > placeCeiling(ix, at)).length : 0,
    });
    if (r.interpretation?.meta && r.interpretation.meta.model !== "stored reading") modelCalls++;
    if (r.decision.kind === "none" && r.decision.code === "none_already_booked") {
      const days = new Set(askedDays(m0.message_id));
      let hit = false;
      for (const rn of [...String(r.decision.reason).matchAll(/R(\d{3,6})/g)].map((x) => x[1])) {
        const o = await world.orderByNumber(rn);
        const live = ([] as any[]).concat(o?.Job ?? []).flatMap((j: any) => ([] as any[]).concat(j.SlotTeam ?? []).flatMap((t: any) => ([] as any[]).concat(t.Slot ?? []))).filter((sl: any) => sl.beginning && sl.cancelled !== true);
        if (live.some((sl: any) => !days.size || days.has(utcToLondon(String(sl.beginning)).date))) hit = true;
      }
      booked.set(m0.message_id, hit);
    }
  }
  globalThis.fetch = closed;
  return { rows, limits, booked, runs: order.length, warmups: order.length - evalIds.length, modelCalls, netAttempts, preflight: pf.checks.map((c) => `${c.ok ? "ok" : "FAIL"} ${c.name}: ${c.detail}`) };
}
