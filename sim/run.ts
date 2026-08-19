// ============================================================================
// Run the 100 bookings and write the observations to disk.
// ----------------------------------------------------------------------------
//   npx tsx sim/run.ts            offline, deterministic, free
//   npx tsx sim/run.ts --verify   also confirms the cached tenant lists are current
//
// Costs nothing and calls no model. Output: .tmp-data/sim/results.json, which
// sim/report.ts turns into the page.
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleThread } from "../app/lib/engine/pipeline";
import { matchPlace } from "../app/lib/engine/resolve";
import type { ConversationState, PlaceCandidate } from "../app/lib/engine/types";
import { buildRig, loadPlaces, loadProfessions, threadFor, CLIENTS } from "./harness";
import { SCENARIOS } from "./scenarios";
import { checkInvariants, predict, requestedChief, type Violation } from "./oracle";
import type { SimCase } from "./types";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, ".tmp-data/sim");

const PLACEHOLDER_PLACE_NAME = "No Location";

export interface CaseResult {
  id: string;
  label: string;
  tags: string[];
  client: string;
  /** What the engine did. */
  classification: string;
  status: string;
  needs_human: boolean;
  held: boolean;
  held_reason: string | null;
  outcome: string;
  predicted_outcome: string;
  predicted_reason: string | null;
  reason_agrees: boolean;
  order_id?: number;
  rate_card?: number;
  rate_card_source?: string;
  place_id?: number;
  provisioned_company: boolean;
  provisioned_place: boolean;
  teams: Array<{ name: string; profession_id: number; size: number; beginning: string; end: string; place_id: number }>;
  headcount: number;
  chiefs: number;
  notes: string[];
  /** What reached the fixture tenant. */
  onsinch_calls: string[];
  wire_orders: number;
  deleted_orders: number[];
  /** How it compares. */
  predicted_teams: Array<{ profession_id: number; size: number; beginning: string; end: string }>;
  predicted_headcount: number;
  predicted_hold: string | null;
  agrees: boolean;
  disagreement: string[];
  violations: Violation[];
  idempotent: boolean;
}

/**
 * Which place a venue string resolves to, answered the same way the compiler answers
 * it — including the "No Location" placeholder when no venue was named at all.
 */
function placeResolver(places: PlaceCandidate[], c: SimCase) {
  const orderPlace = matchPlace(c.venue || PLACEHOLDER_PLACE_NAME, places) ?? 0;
  return (blockVenue?: string): number => {
    if (!blockVenue) return orderPlace;
    const id = matchPlace(blockVenue, places);
    // A per-block venue that does not resolve keeps the job's venue, and one that
    // resolves to the SAME place is not a move.
    return id && id !== orderPlace ? id : orderPlace;
  };
}

/** A sibling thread that agrees on client, date and venue — the cross-thread floor. */
function twinState(c: SimCase, placeId: number): ConversationState {
  const b = c.blocks[0];
  const sameWindow = c.twin === "duplicate";
  return {
    thread_id: `${c.id}-twin`,
    subject: `Crew for the same job — ${c.label}`,
    participants: [],
    last_message_id: `${c.id}-twin-m1`,
    last_processed_epoch: 1,
    classification: "new-job",
    facts: {
      company_name: CLIENTS[c.client].name,
      location_text: c.venue,
      requests: [
        {
          date: b.date,
          start_time: sameWindow ? b.start : "18:00",
          end_time: sameWindow ? b.end : "23:00",
          size: sameWindow ? b.size : 3,
        },
      ],
    },
    company_id: CLIENTS[c.client].id || 8801,
    place_id: placeId,
    onsinch_order_id: 88888,
    desired_order: null,
    priority: "medium",
    needs_human: false,
    status: "ordered",
    notes: [],
    order_action_log: [],
  };
}

function heldReason(s: ConversationState): string | null {
  const n = s.notes.join(" | ");
  if (/looks like the same job as thread/.test(n)) return "cross-thread";
  if (/client is cancelling/.test(n)) return "cancellation";
  if (/would empty an order/.test(n)) return "empty-order";
  if (/rate card was assumed/.test(n)) return "assumed-rate";
  if (/no longer provisional/.test(n)) return "confirmed-order";
  if (/nothing bookable could be built/.test(n)) return "empty-order";
  if (/missing times/.test(n)) return "tbc-has-no-times";
  return null;
}

/**
 * What became of the enquiry, read off the state the way a person reads the board.
 * Deliberately not a pass-through of `status`: "needs-info" covers both "we could not
 * build anything" and "we built it and OnSinch would not take the change", and those
 * are different answers to the client.
 */
function engineOutcome(s: ConversationState): string {
  if (s.pending_order) return "held";
  if (s.notes.some((n) => /NOT applied/.test(n))) return "refused";
  if (s.classification === "confirmation-only" || s.classification === "not-a-job") return "no-change";
  if (s.status === "ordered") return "written";
  if (s.status === "needs-info") return "not-bookable";
  if (s.status === "drafted" || s.status === "ignored") return "no-change";
  return s.status;
}

async function runCase(c: SimCase, professions: ReturnType<typeof loadProfessions>, places: PlaceCandidate[]): Promise<CaseResult> {
  const rig = buildRig(c, professions, places);
  const placeOf = placeResolver(places, c);

  if (c.twin) await rig.deps.store.put(twinState(c, placeOf(undefined)));

  rig.setPass("new");
  let state = await handleThread(threadFor(c, "new"), rig.deps);

  // Idempotency: the same thread again must not produce a second order. Measured on
  // every case, because it is the guarantee the nightly Gmail sweep rests on.
  const createdBefore = rig.log.created.length;
  rig.setPass("new");
  await handleThread(threadFor(c, "new"), rig.deps);
  const idempotent = rig.log.created.length === createdBefore;

  const which: "new" | "amend" = c.amend ? "amend" : "new";
  if (c.amend) {
    rig.setPass("amend");
    state = await handleThread(threadFor(c, "amend"), rig.deps);
  }

  const pred = predict(c, placeOf, which);
  const blocks = which === "amend" ? c.amend!.blocks : c.blocks;
  const clientChief = requestedChief(blocks);

  const teams = (state.desired_order?.slot_teams ?? []).map((t) => ({
    name: t.name, profession_id: t.profession_id, size: t.size,
    beginning: t.beginning, end: t.end, place_id: t.place_id,
  }));
  const headcount = teams.reduce((n, t) => n + t.size, 0);
  const chiefs = teams.filter((t) => t.profession_id === 36).reduce((n, t) => n + t.size, 0);

  // Comparison on the multiset of teams: a team is its role, its size and its window.
  const key = (t: { profession_id: number; size: number; beginning: string; end: string }) =>
    `${t.profession_id}|${t.size}|${t.beginning}|${t.end}`;
  const got = teams.map(key).sort();
  const want = pred.teams.map(key).sort();
  const disagreement: string[] = [];
  if (got.join(";") !== want.join(";")) {
    disagreement.push(`teams: engine [${got.join(", ")}] vs rules [${want.join(", ")}]`);
  }
  const outcome = engineOutcome(state);
  if (outcome !== pred.outcome) {
    disagreement.push(`outcome: engine ${outcome} vs rules ${pred.outcome}`);
  }
  // The reason is reported rather than scored: two modules can reach the same correct
  // answer by different routes, and which route was taken is a finding, not a failure.
  const reason = heldReason(state);
  const reasonAgrees = pred.reason === null || reason === pred.reason;

  const violations = checkInvariants(c, state, pred, rig.log.created.map((x) => x.body), clientChief);

  return {
    id: c.id, label: c.label, tags: c.tags, client: c.client,
    classification: state.classification,
    status: state.status,
    needs_human: state.needs_human,
    held: !!state.pending_order,
    held_reason: reason,
    outcome,
    predicted_outcome: pred.outcome,
    predicted_reason: pred.reason,
    reason_agrees: reasonAgrees,
    order_id: state.onsinch_order_id,
    rate_card: state.desired_order?.pricelist_category_id,
    rate_card_source: state.desired_order?.rate_card_source,
    place_id: state.place_id,
    provisioned_company: !!state.desired_order?.provision_company,
    provisioned_place: !!state.desired_order?.provision_place,
    teams, headcount, chiefs,
    notes: state.notes,
    onsinch_calls: rig.log.calls,
    wire_orders: rig.log.created.length,
    deleted_orders: rig.log.deleted.flat(),
    predicted_teams: pred.teams.map((t) => ({ profession_id: t.profession_id, size: t.size, beginning: t.beginning, end: t.end })),
    predicted_headcount: pred.headcount,
    predicted_hold: pred.reason,
    agrees: disagreement.length === 0,
    disagreement,
    violations,
    idempotent,
  };
}

(async () => {
  const professions = loadProfessions();
  const places = loadPlaces();
  console.log(`tenant fixtures: ${professions.length} professions, ${places.length} places`);

  const results: CaseResult[] = [];
  for (const c of SCENARIOS) {
    try {
      results.push(await runCase(c, professions, places));
    } catch (err) {
      console.error(`  THREW  ${c.id}: ${(err as Error).message}`);
      results.push({
        id: c.id, label: c.label, tags: c.tags, client: c.client,
        classification: "THREW", status: "THREW", needs_human: true, held: false, held_reason: null,
        provisioned_company: false, provisioned_place: false, teams: [], headcount: 0, chiefs: 0,
        notes: [String((err as Error).message)], onsinch_calls: [], wire_orders: 0, deleted_orders: [],
        predicted_teams: [], predicted_headcount: 0, predicted_hold: null, outcome: "THREW", predicted_outcome: "written", predicted_reason: null, reason_agrees: false,
        agrees: false, disagreement: [`threw: ${(err as Error).message}`],
        violations: [{ rule: "no-throw", detail: String((err as Error).message) }], idempotent: false,
      });
    }
  }

  const agree = results.filter((r) => r.agrees).length;
  const clean = results.filter((r) => r.violations.length === 0).length;
  const wrote = results.filter((r) => r.order_id !== undefined).length;
  const held = results.filter((r) => r.held).length;
  const idem = results.filter((r) => r.idempotent).length;

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "results.json"), JSON.stringify({
    generated_for: "Spartan Crew Jobber — 100-booking simulation",
    cases: results.length,
    professions: professions.length,
    places: places.length,
    summary: { agree, clean, wrote, held, idempotent: idem },
    results,
  }, null, 2));

  console.log(`\n  cases            ${results.length}`);
  console.log(`  rule agreement   ${agree}/${results.length}`);
  console.log(`  invariant-clean  ${clean}/${results.length}`);
  console.log(`  idempotent       ${idem}/${results.length}`);
  console.log(`  wrote an order   ${wrote}`);
  console.log(`  held             ${held}`);

  const bad = results.filter((r) => !r.agrees || r.violations.length);
  if (bad.length) {
    console.log(`\n${bad.length} case(s) to look at:\n`);
    for (const r of bad) {
      console.log(`  ${r.id}  ${r.label}`);
      for (const d of r.disagreement) console.log(`      disagreement: ${d}`);
      for (const v of r.violations) console.log(`      violation ${v.rule}: ${v.detail}`);
    }
  }
  console.log(`\nwritten: ${join(OUT, "results.json")}\n`);
})();
