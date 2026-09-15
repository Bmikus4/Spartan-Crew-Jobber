// ============================================================================
// THE ADVERSARIAL LEG. Cases written to break one named mechanism each.
// ----------------------------------------------------------------------------
// WHY THE EXISTING FREE LEG CANNOT DO THIS, and it is the finding that made this
// file necessary. `scriptedReasoner` is a PERFECT extractor: `classify()` returns
// the case's own declared `kind` and `extractFacts()` returns its declared truth
// blocks, ISO dates and all. So on the free leg —
//
//   classification 100.0% (500/500)   is the harness handing back what it declared
//   dates          100.0% (334/334)   never reaches parseWork.ts at all
//   headcount / teamCount / windows / professions   the same, fed in as structure
//
// — and the ONLY gate genuinely under test is venue, because the extractor
// deliberately emits the client's words rather than the tenant's row. That is
// exactly what the free leg reports: 79.8% end to end, every gate 100% except
// venue at 73.1%. The number is honest about what it measures. It is not an
// end-to-end accuracy figure, and it cannot see a single one of the three
// failures the live mailbox produced on 2026-09-15.
//
// WHAT THIS LEG DOES INSTEAD. It keeps the perfect extractor for every field
// except the one under attack, and on that field it injects THE ERROR A MODEL
// PLAUSIBLY MAKES. The case then measures the engine's own defences — the
// reconciliation layer in parseWork.ts, the resolver, the identity rule — rather
// than measuring a model. Free, deterministic, offline, no writes.
//
// EVERY ATTACK IS PAIRED WITH A CONTROL. A mechanism that scores 0% because its
// gate never fires and a mechanism that scores 0% because it is broken produce
// the same number, and this repo has already published that number once. The
// control is the same case with the benign input: if the control fails, the
// attack result means nothing and the runner says so instead of reporting it.
//
// HARD GATES ARE REPORTED APART. Ben's 99% excludes what the API makes
// impossible, so a case marked `hardGate` is counted in its own bucket with the
// reason, never folded into the error rate.
//
// WHAT THIS LEG STILL CANNOT REACH, stated rather than implied:
//   company matching   every case runs on company 515; the tenant's 796 rows and
//                      the alias store are not in the fixture at all
//   intake recall      a thread that never reaches the engine cannot be run
//                      through it — see data/testset/recall.jsonl
//   identity across orders  the fixture holds no prior orders for the client, so
//                      matchExistingOrder has nothing to pick between. It is
//                      scored on real data by scripts/score-successor-recovery.ts
//   the four labels    NOT YET WRITTEN, and it is the one mechanism in §4's table
//                      that no instrument covers. The case to write is a thread
//                      that finishes clean still wearing "Order Needs Built" —
//                      `needs_label` on the state row is what decides it.
//
// So §4's mechanism table is covered by THREE instruments, not one: this file for
// classification, dates, venue, shape and the amendability hard gate; the live
// test set for company matching and intake recall; score-successor-recovery.ts for
// identity. Anything claiming a single end-to-end number has to say which.
//
//   npx tsx study/adversarial.ts
//   npx tsx study/adversarial.ts --only=dates
//   npx tsx study/adversarial.ts --verbose
// ============================================================================
import { handleThread } from "../app/lib/engine/pipeline";
import { coerceThread } from "../app/lib/engine/intake";
import { COMPANY_ID, COMPANY_NAME, CONTACT, type StudyCase, type TruthBlock } from "./cases";
import { expect as oracleExpect } from "./oracle";
import { scoreCase, type Observed } from "./score";
import { buildRig, loadPlaces, loadProfessions, payloadFor, scriptedReasoner, type Wire } from "./rig";
import { PLACEHOLDER_PLACE_NAME } from "./gold";
import type { ConversationFacts } from "../app/lib/engine/types";

const argv = process.argv.slice(2);
const ONLY = argv.find((a) => a.startsWith("--only="))?.split("=")[1] ?? null;
const VERBOSE = argv.includes("--verbose");

/**
 * One case, and what it is trying to break.
 *
 * `inject` receives the facts a perfect extractor would emit and returns the
 * facts a MODEL would plausibly emit on this text. Returning them unchanged is
 * what makes a case a control.
 */
interface Attack {
  mechanism: "dates" | "venue" | "classification" | "shape" | "amendability";
  /** What is being attacked, in one line, for the report. */
  attack: string;
  /** The control this attack is paired with. A control names itself. */
  control?: true;
  /** The API makes this impossible; report it apart from the misses. */
  hardGate?: string;
  /** Where the live failure came from, when it came from one. */
  seenLive?: string;
  inject?: (f: ConversationFacts) => ConversationFacts;
  /**
   * The classification a model plausibly returns on this text, where that is the
   * thing being attacked. Without it a classification case is unreachable: the
   * scripted classifier answers from the case's own declared `kind`, so it always
   * says "new-job" for a booking and the case measures composition instead. That
   * is the self-measurement this whole file exists to avoid, so a classification
   * attack with no `injectClass` is reported UNMEASURABLE rather than as a pass.
   */
  injectClass?: "not-a-job" | "confirmation-only" | "update" | "new-job";
}
type AttackCase = StudyCase & { mechanism: Attack["mechanism"] } & Omit<Attack, "mechanism">;

// ---------------------------------------------------------------- building
// A bare DATE: payloadFor appends its own T09:00:00Z, so a timestamp here makes NaN.
const SENT = "2026-08-17";
const block = (over: Partial<TruthBlock> = {}): TruthBlock => ({
  size: 4, role: "crew", date: "2026-09-04", start: "07:30", end: "09:30",
  venue: "dock", said: "Tobacco Dock", task: "get-in", ...over,
});

function mail(id: string, subject: string, body: string, t: {
  blocks: TruthBlock[]; sentAt?: string;
} & Omit<Attack, "mechanism"> & { mechanism: Attack["mechanism"] }): AttackCase {
  return {
    id,
    cell: { mechanism: t.mechanism, kind: t.control ? "control" : "attack" },
    kind: "booking",
    truth: { blocks: t.blocks, po: null },
    sentAt: t.sentAt ?? SENT,
    subject,
    messages: [{ from: "client", body, subject }],
    amend: null,
    mechanism: t.mechanism,
    attack: t.attack,
    ...(t.control ? { control: true as const } : {}),
    ...(t.hardGate ? { hardGate: t.hardGate } : {}),
    ...(t.seenLive ? { seenLive: t.seenLive } : {}),
    ...(t.inject ? { inject: t.inject } : {}),
    ...(t.injectClass ? { injectClass: t.injectClass } : {}),
  };
}

/** Rewrite every request's date, as a model reading the text literally would. */
const dateAs = (iso: string) => (f: ConversationFacts): ConversationFacts => ({
  ...f, requests: (f.requests ?? []).map((r) => ({ ...r, date: iso })),
});

const CASES: AttackCase[] = [
  // ------------------------------------------------------------------ dates
  //
  // THE LIVE FAILURE. Event Concept, thread 1a00f755b3a1abeb, sent 2026-08-17:
  // "Here are our booking requests for September", then dates written 04.09.25,
  // 07.09.25, 08.09.25. The engine took the literal 25 and produced 23 blocks a
  // year in the past. parseWork.rollYearForward ALREADY returns 2026-09-04 for
  // that input — the roll is simply never applied, because the roll only runs on
  // a date the text wrote with NO year, and a two-digit year counts as written.
  mail("dates-stale-2digit", "September Crew Request #1",
    "Afternoon, here are our booking requests for September, could we please book in the below:\n04.09.25 Tobacco Dock 4x 2hr 07:30",
    { mechanism: "dates", attack: "a stale two-digit year the client typed out of habit",
      seenLive: "1a00f755b3a1abeb — 23 blocks placed in September 2025",
      blocks: [block()], inject: dateAs("2025-09-04") }),

  mail("dates-stale-4digit", "September Crew Request",
    "Could we book the below please:\n4th September 2025 — Tobacco Dock, 4 crew 07:30-09:30",
    { mechanism: "dates", attack: "a stale FOUR-digit year — the same error, unambiguous in the text",
      blocks: [block()], inject: dateAs("2025-09-04") }),

  mail("dates-2digit-correct", "September Crew Request",
    "Could we book the below please:\n04.09.26 Tobacco Dock 4x 2hr 07:30",
    { mechanism: "dates", control: true, attack: "CONTROL: a two-digit year that is right — must not be moved",
      blocks: [block()], inject: dateAs("2026-09-04") }),

  mail("dates-bare-rollover", "Crew request",
    "Could we book the below please:\n4th September — Tobacco Dock, 4 crew 07:30-09:30",
    { mechanism: "dates", control: true, attack: "CONTROL: no year written, the roll's own case",
      blocks: [block()], inject: dateAs("2025-09-04") }),

  mail("dates-future-year-kept", "Crew request for next year",
    "Booking ahead — 4th September 2027, Tobacco Dock, 4 crew 07:30-09:30",
    { mechanism: "dates", control: true, attack: "CONTROL: a year genuinely in the future is not 'corrected'",
      blocks: [block({ date: "2027-09-04" })], inject: dateAs("2027-09-04") }),

  // ------------------------------------------------------------------ venue
  //
  // THE LIVE FAILURE. The same Event Concept thread names a DIFFERENT venue per
  // line — Tower of London, Fairmont Windsor, Science Museum, the National
  // Gallery. The engine carries one thread-level location_text; it came back
  // null and all 23 blocks went to place 87, a row named "Location".
  mail("venue-per-block-no-top", "Crew for the week",
    "Please book:\n04.09.26 Tobacco Dock 4x 07:30-09:30\n05.09.26 Olympia London 4x 07:30-09:30\n06.09.26 Alexandra Palace 4x 07:30-09:30",
    { mechanism: "venue", attack: "a venue per block and NO thread-level venue — the shape the live thread had",
      seenLive: "1a00f755b3a1abeb — 23 blocks on place 87 \"Location\"",
      blocks: [block({ date: "2026-09-04" }), block({ date: "2026-09-05", venue: "olympia", said: "Olympia London" }),
               block({ date: "2026-09-06", venue: "ally", said: "Alexandra Palace" })],
      inject: (f) => { const g = { ...f }; delete (g as any).location_text; return g; } }),

  mail("venue-per-block-with-top", "Crew for the week",
    "Please book:\n04.09.26 Tobacco Dock 4x 07:30-09:30\n05.09.26 Olympia London 4x 07:30-09:30\n06.09.26 Alexandra Palace 4x 07:30-09:30",
    { mechanism: "venue", control: true, attack: "CONTROL: the same three venues, stated the way EXTRACT_SYSTEM asks",
      blocks: [block({ date: "2026-09-04" }), block({ date: "2026-09-05", venue: "olympia", said: "Olympia London" }),
               block({ date: "2026-09-06", venue: "ally", said: "Alexandra Palace" })] }),

  mail("venue-abbreviation", "Crew at the RAH",
    "4 crew at the RAH, 4th September 2026, 07:30 til 09:30 please",
    { mechanism: "venue", attack: "the short name a client uses and the tenant does not record",
      blocks: [block({ venue: "rah", said: "the RAH" })] }),

  mail("venue-unknown-provisions", "Crew at a new site",
    "4 crew at Pemberton Wharf Studios, 4th September 2026, 07:30 til 09:30 please",
    { mechanism: "venue", control: true, attack: "CONTROL: a venue the tenant has never seen must be created, not sunk",
      blocks: [block({ venue: "new", said: "Pemberton Wharf Studios" })] }),

  // --------------------------------------------------------- classification
  //
  // THE LIVE FAILURE. Solotech, thread 19fdb6f1b564320b: "Please see attached
  // PO-UK000016628 for x2 extra crew today (7th August) in relation to your
  // price quote - R10457." The engine extracted {date, size 2, task 'extra
  // crew'} correctly and then called the thread confirmation-only, took no
  // action, and bound to no order. A PO naming a quote reference AND a headcount
  // is an amendment, not an acknowledgement.
  mail("class-po-with-headcount", "x2 Extra Crew 4th September",
    "Hello, please see attached PO-UK000016628 for x2 extra crew today (4th September) in relation to your price quote - R10457.",
    { mechanism: "classification", attack: "a PO that also states a headcount — read as an acknowledgement",
      seenLive: "19fdb6f1b564320b — 2 crew added to a live job, nothing reached OnSinch",
      blocks: [block({ size: 2, task: "extra crew" })],
      injectClass: "confirmation-only" }),

  mail("class-plain-ack", "Re: Crew 4th September",
    "Thanks Zac, all confirmed. Have a good weekend.",
    { mechanism: "classification", control: true, attack: "CONTROL: an acknowledgement with no work in it",
      blocks: [] }),

  // ------------------------------------------------------------------ shape
  mail("shape-chief-band-edge", "Crew request",
    "10 crew at Tobacco Dock on 4th September 2026, 07:30 til 09:30",
    { mechanism: "shape", control: true, attack: "CONTROL: 10 crew sits exactly on the second chief band",
      blocks: [block({ size: 10 })] }),

  mail("shape-merge-same-window", "Crew request",
    "4 crew and 4 more crew at Tobacco Dock on 4th September 2026, both 07:30 til 09:30",
    { mechanism: "shape", attack: "two blocks that share window, venue and profession must merge, not split",
      blocks: [block({ size: 4 }), block({ size: 4 })] }),

  // ---------------------------------------------------------- amendability
  //
  // THE HARD GATE, declared here so the bucket is exercised and so nobody spends
  // another session trying to beat it. A multi-block order nobody is signed on to
  // cannot be paired at all: `/attendance` returns no rows for an unstaffed block,
  // and the audit tree carries only {id, name, model, created, data.path} — no day,
  // no venue, no size. Five of fourteen staff-raised orders are this shape. The
  // engine labelling the thread and stopping is the CORRECT outcome, so counting it
  // as a miss would put an unreachable number in the denominator of Ben's 99%.
  mail("amend-unstaffed-multiblock", "Crew request",
    "4 crew at Tobacco Dock on 4th September 2026 07:30-09:30, and 4 more on the 5th",
    { mechanism: "amendability",
      attack: "amending a multi-block order with nobody signed on to any block",
      hardGate: "attendance returns no rows for an unstaffed block, so our blocks cannot be paired with theirs — it is the API, not a gap",
      blocks: [block({ date: "2026-09-04" }), block({ date: "2026-09-05" })] }),
];

// ---------------------------------------------------------------- running
function observe(state: any, err?: unknown): Observed {
  const order = state?.desired_order ?? null;
  return {
    classification: state?.classification,
    status: state?.status,
    needs_human: state?.needs_human,
    teams: (order?.slot_teams ?? []).map((t: any) => ({
      size: t.size, profession_id: t.profession_id, place_id: t.place_id,
      beginning: t.beginning, end: t.end, name: t.name ?? "",
    })),
    order,
    pending_order: state?.pending_order,
    onsinch_order_id: state?.onsinch_order_id,
    notes: state?.notes ?? [],
    ...(err ? { error: String((err as Error)?.message ?? err).slice(0, 300) } : {}),
  };
}

function phIds(wire: Wire, base: Set<number>): Set<number> {
  const out = new Set(base);
  for (const p of wire.provisioned) {
    if (p.name.trim().toLowerCase() === PLACEHOLDER_PLACE_NAME.toLowerCase()) out.add(p.id);
  }
  return out;
}

(async () => {
  const places = loadPlaces();
  const professions = loadProfessions();
  const placeholderIds = new Set<number>(
    places.filter((p: any) => String(p.name ?? "").trim().toLowerCase() === PLACEHOLDER_PLACE_NAME.toLowerCase()).map((p: any) => Number(p.id))
  );
  const cases = ONLY ? CASES.filter((c) => c.mechanism === ONLY) : CASES;
  console.log(`\nADVERSARIAL LEG — ${cases.length} case(s), fixture transport, no writes, no model calls`);
  console.log(`tenant fixtures: ${places.length} places, ${professions.length} professions\n`);

  const rows: Array<{ c: AttackCase; pass: boolean; firstFail: string | null; detail: string[] }> = [];

  for (const c of cases) {
    // The perfect extractor, with the attack applied to the field under test.
    const perfect = scriptedReasoner(c, () => "new");
    const reasoner = {
      ...perfect,
      async classify(...a: any[]) {
        const r = await (perfect as any).classify(...a);
        return c.injectClass ? { ...r, classification: c.injectClass } : r;
      },
      async extractFacts(...a: any[]) {
        const f = await (perfect as any).extractFacts(...a);
        return c.inject ? c.inject(f) : f;
      },
    };
    const rig = buildRig({ case: c, places, professions, venueJudge: null, reasoner: reasoner as any });
    rig.setPass("new");

    const exp = oracleExpect(c, "new");
    let state: any = null, err: unknown = undefined;
    try {
      const thread = coerceThread(payloadFor(c, "new"));
      if (!thread) throw new Error("coerceThread refused the payload");
      state = await handleThread(thread, rig.deps);
    } catch (e) { err = e; }
    const obs = observe(state, err);
    const scored = scoreCase(c, exp, obs, "new", phIds(rig.wire, placeholderIds));
    rows.push({ c, pass: scored.pass, firstFail: scored.firstFail, detail: scored.detail });
  }

  // ---- report -------------------------------------------------------------
  // CONTROLS FIRST, and they gate everything else. An attack result on a
  // mechanism whose control failed is not a finding about the engine — it is a
  // finding about this file, and reporting it as the former is the mistake this
  // repo has made four times.
  const byMech = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byMech.has(r.c.mechanism)) byMech.set(r.c.mechanism, []);
    byMech.get(r.c.mechanism)!.push(r);
  }

  let attacksRun = 0, attacksPassed = 0, hardGates = 0, unmeasurable = 0;
  for (const [mech, rs] of byMech) {
    const controls = rs.filter((r) => r.c.control);
    const attacks = rs.filter((r) => !r.c.control);
    const controlsOk = controls.every((r) => r.pass);
    console.log(`\n${mech.toUpperCase()}   control ${controls.filter((r) => r.pass).length}/${controls.length}${controlsOk ? "" : "  <-- BROKEN, the attacks below measure nothing"}`);
    for (const r of controls) {
      console.log(`   ${r.pass ? "ok  " : "FAIL"}  ${r.c.id.padEnd(26)} ${r.c.attack}`);
      if (!r.pass && VERBOSE) for (const d of r.detail) console.log(`            ${d}`);
    }
    for (const r of attacks) {
      if (r.c.hardGate) {
        hardGates++;
        console.log(`   GATE  ${r.c.id.padEnd(26)} ${r.c.attack}\n            hard gate: ${r.c.hardGate}`);
        continue;
      }
      if (!controlsOk) { unmeasurable++; console.log(`   ????  ${r.c.id.padEnd(26)} ${r.c.attack}`); continue; }
      if (r.c.mechanism === "classification" && !r.c.injectClass) {
        // The scripted classifier answers from the case's own `kind`, so without an
        // injected misread this case never reaches the classifier at all.
        unmeasurable++;
        console.log(`   ????  ${r.c.id.padEnd(26)} ${r.c.attack}
            no injectClass — the classifier was never asked`);
        continue;
      }
      attacksRun++;
      if (r.pass) attacksPassed++;
      console.log(`   ${r.pass ? "HELD" : "BROKE"} ${r.c.id.padEnd(26)} ${r.c.attack}`);
      if (r.c.seenLive) console.log(`            live: ${r.c.seenLive}`);
      if (!r.pass) {
        console.log(`            first gate to fail: ${r.firstFail}`);
        for (const d of r.detail.slice(0, VERBOSE ? 99 : 3)) console.log(`            ${d}`);
      }
    }
  }

  console.log(`\n------------------------------------------------------------------`);
  console.log(`  attacks held           ${attacksPassed}/${attacksRun}`);
  console.log(`  hard gates (excluded)  ${hardGates}`);
  if (unmeasurable) console.log(`  UNMEASURABLE           ${unmeasurable}  — their mechanism's control failed`);
  console.log(`\n  A run where every attack holds has almost certainly measured itself.`);
  console.log(`  Add the case that breaks before believing the number.\n`);
})();
