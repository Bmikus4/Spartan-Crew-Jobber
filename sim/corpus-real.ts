// ============================================================================
// The corpus study WITH THE MODEL IN THE LOOP. 100 enquiries written like client mail.
// ----------------------------------------------------------------------------
//   npx tsx sim/corpus-real.ts --n=3            a pilot, and it costs real money
//   npx tsx sim/corpus-real.ts --n=100          the study
//   npx tsx sim/corpus-real.ts --cleanup        delete everything the ledger lists
//
// THIS SPENDS MONEY. Priced first with sim/corpus-price.ts, at roughly $0.05 a case on
// the engine's default model, and guarded here by a hard ceiling that aborts the run
// rather than discovering the bill afterwards. Ben signed off the figure before it ran.
//
// It differs from sim/corpus.ts in exactly one way, and that way is the point: the
// reasoner is the REAL OpenRouter one, so classification and extraction are under test
// rather than scripted. Everything downstream — the engine, the executor, the tenant —
// is the same rig (sim/corpusRig.ts), so the two runs are comparable.
//
// THE EMAILS ARE NOT GENERATED FROM THE ANSWER. See sim/randomCases.ts: each case
// declares the booking a competent human would take, then renders it the way a client
// types it. The declared truth is what extraction is scored against.
// ============================================================================
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "../scripts/_env.mjs";
import { OnsinchClient, httpTransport, __resetListCache } from "../app/lib/engine/onsinch";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { guardReasoner } from "../app/lib/engine/spend";
import { handleThread } from "../app/lib/engine/pipeline";
import type { HydratedThread, ThreadMessage } from "../app/lib/engine/types";
import { buildRig } from "./corpusRig";
import { UNRECOGNISED_MARK, resolveProfession } from "../app/lib/engine/professions";
import { loadProfessions } from "./harness";
import { buildRandomCases, VENUE_FORMAL, type RandomCase, type TruthBlock } from "./randomCases";
import { COMPANY_NAME, COMPANY_ID, CONTACT } from "./corpusCases";

loadEnv();
const KEY = requireEnv("ONSINCH_API_KEY");
const AI_KEY = requireEnv("OPENROUTER_API_KEY");
const BASE = onsinchBase();
const MODEL = process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6";

const argOf = (n: string, d: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? Number(a.split("=")[1]) : d;
};
const N = argOf("n", 100);
const CONCURRENCY = argOf("concurrency", 3);
/**
 * A hard stop, IN DOLLARS, checked between batches. The run aborts rather than
 * discovering the bill afterwards.
 *
 * Distinct from the per-case guard below, whose `limit` counts CALLS, not money — the
 * first pilot passed dollars into it and every case died after one call. Both exist: the
 * guard stops one runaway thread, this stops a runaway run.
 */
const CEILING = argOf("ceiling", 12);
/** Calls one case may make: 2 combined + 2 replies, plus headroom for a retry. */
const CALLS_PER_CASE = argOf("calls", 8);
const mode = process.argv.includes("--cleanup") ? "cleanup" : process.argv.includes("--keep") ? "keep" : "full";

const OUT = join(import.meta.dirname, "..", ".tmp-data", "corpus-real");
const LEDGER = join(OUT, "ledger.json");
const RESULTS = join(OUT, "results.jsonl");
mkdirSync(OUT, { recursive: true });
const led: { orders: number[]; places?: number[] } = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { orders: [], places: [] };
led.places = led.places ?? [];
const saveLedger = () => writeFileSync(LEDGER, JSON.stringify(led, null, 2));

// ---------------------------------------------------------------- scoring extraction
/**
 * Which OnSinch profession a role SHOULD land in — READ OFF THE TENANT'S OWN 43
 * ROWS, not asserted.
 *
 * This ruler was broken and it made the study's headline role figure meaningless.
 * `rigger: /rigg/i` demanded a Rigger profession and THE TENANT HAS NONE. Roughly
 * one case in seven drew that role, so for every one of them booking general Crew
 * was the correct answer and the scorer marked it wrong. 55/100 was therefore
 * partly a measurement of the scorer.
 *
 * A role the tenant does not hold expects Crew — and separately expects the ticket
 * to CALL A HUMAN, which is the assertion that actually protects anybody: a rigger
 * silently booked as labour and a rigger booked as labour with somebody called are
 * the same order and completely different outcomes.
 */
const ROLE_PATTERNS: Record<TruthBlock["role"], RegExp> = {
  crew: /^crew$/i,
  carpenter: /carpenter/i,
  // No Rigger row exists. Climber 65 is the nearest and whether a rigger books as
  // one is Ben's call, not the scorer's — so the correct answer is general Crew.
  rigger: /^crew$/i,
  // The counterbalance, hourly or day-rate twin. NOT Driver, which is a van driver.
  forklift: /counterbalance/i,
  ipaf: /^ipaf 3a\/3b$/i,
};

/** Roles the tenant has no row for: booking Crew is right, booking it QUIETLY is not. */
const ROLES_WITHOUT_A_ROW = new Set<TruthBlock["role"]>(["rigger"]);

/**
 * How many teams the client's blocks compose into: same window, same place, same
 * role is ONE team with the sizes summed. Size never splits a team.
 */
function mergedBlockCount(blocks: TruthBlock[]): number {
  return new Set(blocks.map((b) => `${b.date ?? ""}|${b.start ?? ""}|${b.end ?? ""}|${b.venue}|${b.role}`)).size;
}

interface Scored {
  crew_total: boolean;
  block_count: boolean;
  date: boolean;
  times: boolean;
  venue: boolean;
  roles: boolean;
  /**
   * Every block naming a role the tenant has no row for arrived with a human
   * called. Reported separately because it is a different property from getting
   * the profession right: booking Crew for a rigger IS right, and doing it in
   * silence is the failure. True when there was nothing to abstain on.
   */
  role_abstained: boolean;
}

function scoreExtraction(c: RandomCase, truth: { blocks: TruthBlock[] }, state: {
  desired_order?: { slot_teams?: Array<{ size: number; beginning: string; end: string; profession_id: number; place_id: number }> } | null;
  facts?: { requests?: Array<{ date?: string; start_time?: string; end_time?: string; size?: number; profession_hint?: string }> };
  place_id?: number;
  notes?: string[];
}, professionName: (id: number) => string, placeName: (id: number) => string, placeIsAShell: (id: number) => boolean): Scored {
  const teams = state.desired_order?.slot_teams ?? [];
  const wanted = truth.blocks.reduce((n, b) => n + b.size, 0);
  const got = teams.reduce((n, t) => n + t.size, 0);
  const reqs = state.facts?.requests ?? [];

  // The DATE the client stated, against the date the engine booked. An undated case has
  // nothing to be right or wrong about, so it scores true and is counted separately.
  const wantDate = truth.blocks.find((b) => b.date)?.date ?? null;
  const gotDate = teams[0]?.beginning?.slice(0, 10) ?? reqs.find((r) => r.date)?.date ?? null;

  /**
   * READ THE ORDER WHERE THERE IS ONE, AND THE FACTS WHERE THERE IS NOT.
   *
   * An undated enquiry is HELD, correctly and by design — there is no window to book.
   * So it composes no order, `teams` is empty, and every field scored off the teams
   * came back false: a thread the engine got completely right was marked wrong on
   * times, roles and block count at once. Five of the hundred cases are undated, and
   * they account for all four "time misses" and all three "role misses" in the rerun
   * — in every one of them the extracted values match the truth exactly.
   *
   * This is not a lenient fallback. It scores the same claim against the same truth;
   * it just stops requiring an order to exist before extraction can be judged, which
   * is a property of the SCORER and never was a property of the engine.
   */
  const wantTimes = truth.blocks.filter((b) => b.start && b.end).length;
  const gotTimes = teams.length
    ? teams.filter((t, i) => {
        const b = truth.blocks[i];
        if (!b?.start || !b?.end) return false;
        return t.beginning?.slice(11, 16) === b.start && t.end?.slice(11, 16) === b.end;
      }).length
    : reqs.filter((q, i) => {
        const b = truth.blocks[i];
        if (!b?.start || !b?.end) return false;
        return q.start_time === b.start && q.end_time === b.end;
      }).length;

  const wantVenue = VENUE_FORMAL(truth.blocks[0].venue).toLowerCase();
  const gotVenue = placeName(state.place_id ?? teams[0]?.place_id ?? 0).toLowerCase();
  // A loose match on purpose: the tenant's rows for one building differ in punctuation
  // and suffix, and this is asking "did it find the right building", not "did it echo".
  const venueKey = wantVenue.split(",")[0].replace(/[^a-z0-9 ]/g, "").trim();
  // AN UNRESOLVED VENUE IS A MISS. The first version tested `venueKey.includes(gotVenue)`
  // with gotVenue = "", which is true for every string — so every venue the resolver
  // failed to find scored as found, including "o2 arena" being created as a new place
  // beside the O2 that already exists.
  /**
   * A ROW THAT DOES NOT SAY WHERE IT IS, IS NOT A RESOLUTION.
   *
   * `placeName` renders "<name> <address>", and the shells the engine's own misses
   * created carry their name as their address and no postcode — "O2 Arena" at "O2
   * Arena". Matching one of those exactly reads as a success and books crew to a
   * row nobody can drive to. Left unchecked the venue figure RISES as the tenant
   * gets worse, because every miss creates the row that makes the next run match.
   */
  const resolvedRow = state.place_id ?? teams[0]?.place_id ?? 0;
  const bookable = gotVenue !== "" && !placeIsAShell(resolvedRow);
  const venueOk = truth.blocks[0].venue === "new"
    ? /thornbury/i.test(gotVenue)              // the new venue must be the one provisioned
    : bookable && (gotVenue.includes(venueKey.slice(0, 8)) || venueKey.slice(0, 8).includes(gotVenue.split(",")[0].slice(0, 8)));

  /**
   * BY SET, NOT BY INDEX, AND WITHOUT THE CHIEFS.
   *
   * `truth.blocks[i]` against `teams[i]` assumes composition preserves both the
   * order and the count of the blocks. It preserves neither, by design and by Ben's
   * rule: two blocks at the same time and place MERGE into one team, and every team
   * of four or more has its chiefs CARVED OUT into a team of their own. A correct
   * order for "12 riggers for the build, 18 riggers for the derig, same window" is
   * one team of 22 plus a team of 3 chiefs — and the index comparison reads team[1]
   * as Crew Chief where the truth says rigger, and calls the booking wrong.
   *
   * Four of the rerun's cases are exactly this. So: every role the client asked for
   * must be present on some team, and the chief teams the rule invents are not
   * scored against a client block, because no client asked for them.
   */
  const CREW_CHIEF = 36;
  const workTeams = teams.filter((t) => t.profession_id !== CREW_CHIEF);
  const rolesOk = teams.length
    ? truth.blocks.every((b) =>
        workTeams.some((t) => ROLE_PATTERNS[b.role].test(professionName(t.profession_id))))
    : reqs.length > 0 && truth.blocks.every((b, i) => {
        const q = reqs[i] as { profession_hint?: string } | undefined;
        if (!q) return false;
        const m = resolveProfession(q.profession_hint, loadProfessions());
        return ROLE_PATTERNS[b.role].test(m.name);
      });

  return {
    crew_total: wanted === got,
    // CHIEF-AWARE. A block of 10 is composed as 9 crew + 1 chief — two teams for one
    // requested block — so comparing raw counts marks the carve-out as an error.
    /**
     * The WORK teams, against the blocks the client asked for after merging.
     *
     * Counting the chief teams here needs compose's merge rules restated in the
     * scorer, and restating them wrong is how this metric came to under-report: the
     * old expectation added one chief team per banded block, but chiefs merge across
     * professions sharing a window and a place, so three banded blocks in two windows
     * make two chief teams and not three. The chiefs are already pinned by
     * test/crewChief.ts and by the 100/100 rule agreement in sim/run.ts; what this
     * study is asking is whether the client's blocks survived, so it counts those.
     */
    block_count: teams.length
      ? (workTeams.length === truth.blocks.length || workTeams.length === mergedBlockCount(truth.blocks))
      : reqs.length === truth.blocks.length,
    date: wantDate === null ? true : gotDate === wantDate,
    times: wantTimes === gotTimes,
    venue: venueOk,
    roles: rolesOk,
    role_abstained: !truth.blocks.some((b) => ROLES_WITHOUT_A_ROW.has(b.role))
      || (state.notes ?? []).some((n) => n.includes(UNRECOGNISED_MARK)),
  };
}

// ---------------------------------------------------------------- one case
async function runCase(c: RandomCase, professionName: (id: number) => string, placeName: (id: number) => string, placeIsAShell: (id: number) => boolean) {
  const t0 = Date.now();
  let spent = 0;
  const base = createOpenRouterReasoner({ apiKey: AI_KEY, model: MODEL });
  const reasoner = guardReasoner(base, { model: MODEL, label: c.id, limit: CALLS_PER_CASE });

  const rig = buildRig({
    baseUrl: BASE, apiKey: KEY, reasoner,
    onOrderCreated: (id) => { if (!led.orders.includes(id)) { led.orders.push(id); saveLedger(); } },
    onPlaceCreated: (id) => { if (!led.places!.includes(id)) { led.places!.push(id); saveLedger(); } },
  });

  const m = (id: string, at: string, subject: string, body: string): ThreadMessage => ({
    message_id: id, from: CONTACT, to: ["bookings@spartancrew.co.uk"],
    date_iso: at, subject, body, is_from_spartan: false,
  });
  const thread = (msgs: ThreadMessage[]): HydratedThread => ({ thread_id: `real-${c.id}`, messages: msgs });

  const row: Record<string, unknown> = { id: c.id, subject: c.subject, body: c.body, truth: c.truth, amendShape: c.amend?.shape ?? null };

  try {
    const e1 = m("m1", "2026-08-24T09:00:00Z", c.subject, c.body);
    const s1 = await handleThread(thread([e1]), rig.deps);
    row.new_ = {
      classification: s1.classification,
      status: s1.status,
      order_id: s1.onsinch_order_id,
      r: s1.onsinch_order_number,
      crew: (s1.desired_order?.slot_teams ?? []).reduce((n, t) => n + t.size, 0),
      teams: (s1.desired_order?.slot_teams ?? []).length,
      notes: s1.notes,
      window: await rig.windowOf(s1.onsinch_order_id),
      score: scoreExtraction(c, c.truth, s1 as never, professionName, placeName, placeIsAShell),
      // The extraction itself, so a wrong booking can be traced to what was read rather
      // than guessed at from the order it produced.
      facts: (s1 as { facts?: unknown }).facts,
    };

    if (c.amend) {
      const s2 = await handleThread(thread([
        e1,
        m("m2", "2026-08-24T13:00:00Z", c.amend.subject, c.amend.body),
      ]), rig.deps);
      row.amend_ = {
        classification: s2.classification,
        status: s2.status,
        order_id: s2.onsinch_order_id,
        r: s2.onsinch_order_number,
        crew: (s2.desired_order?.slot_teams ?? []).reduce((n, t) => n + t.size, 0),
        path: s2.order_action_log.map((a) => `${a.kind}${a.ok ? "" : "!"}`).join(","),
        notes: s2.notes,
        window: await rig.windowOf(s2.onsinch_order_id),
        r_survived: !!(row.new_ as { r?: string }).r && (row.new_ as { r?: string }).r === s2.onsinch_order_number,
        score: scoreExtraction(c, c.amend.truth, s2 as never, professionName, placeName, placeIsAShell),
      };
    }
  } catch (err) {
    row.error = String((err as Error)?.message ?? err).slice(0, 400);
  }

  const rep = reasoner.spend();
  spent = rep.estimatedUsd ?? 0;
  row.spend = { calls: rep.calls, usd: Number(spent.toFixed(4)) };
  row.wire = rig.wire;
  row.ms = Date.now() - t0;
  appendFileSync(RESULTS, JSON.stringify(row) + "\n");
  return { spent, ok: !row.error };
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
  const onsinch = new OnsinchClient(httpTransport({ baseUrl: BASE, apiKey: KEY }));
  const ids = [...new Set(led.orders)];
  if (!ids.length) { console.log("ledger clean"); return; }
  console.log(`cleanup: ${ids.length} order(s)`);
  const stuck: number[] = [];
  let gone = 0;
  for (let i = 0; i < ids.length; i += 20) {
    await Promise.all(ids.slice(i, i + 20).map(async (id) => {
      try {
        if (!(await onsinch.orderById(id))) { gone++; return; }
        await onsinch.deleteOrders([id]);
        if (await onsinch.orderById(id)) stuck.push(id); else gone++;
      } catch { stuck.push(id); }
    }));
  }
  console.log(`  gone ${gone}, still present ${stuck.length}${stuck.length ? " -> " + stuck.join(",") : ""}`);
  led.orders = stuck; saveLedger();
  await cleanupPlaces(onsinch);
}

/**
 * The venues the run provisioned. Deleted AFTER the orders, because a place an
 * order still points at cannot go.
 *
 * This is not tidiness. Every one of these rows is a nickname the resolver missed,
 * and leaving it behind means the next run matches its own residue exactly — a
 * venue score that rises because the tenant got worse.
 */
async function cleanupPlaces(onsinch: OnsinchClient) {
  const ids = [...new Set(led.places ?? [])];
  if (!ids.length) return;
  console.log(`cleanup: ${ids.length} place(s) this run created`);
  const stuck: number[] = [];
  let gone = 0;
  for (const id of ids) {
    try { await onsinch.deletePlaces([id]); gone++; }
    catch { stuck.push(id); }
  }
  console.log(`  gone ${gone}, still present ${stuck.length}${stuck.length ? " -> " + stuck.join(",") : ""}`);
  led.places = stuck; saveLedger();
}

// ---------------------------------------------------------------- run
(async () => {
  __resetListCache();
  if (mode === "cleanup") { await cleanup(); return; }

  const check = new OnsinchClient(httpTransport({ baseUrl: BASE, apiKey: KEY }));
  const companies = (await check.allCompanies()) as Array<{ id: number; name?: string }>;
  const test = companies.find((x) => String(x.name || "").trim() === COMPANY_NAME);
  if (!test || Number(test.id) !== COMPANY_ID) throw new Error(`refusing: "${COMPANY_NAME}" is not company ${COMPANY_ID}`);

  // Names, so extraction can be scored against what the resolver actually chose rather
  // than against an id nobody can read.
  // The same list the engine resolves against — loadProfessions prefers the live pull in
  // .tmp-data and falls back to the committed list, exactly as the engine does.
  const profs = loadProfessions();
  const professionName = (id: number) => String(profs.find((p) => Number(p.id) === Number(id))?.name || `#${id}`);
  const places = (await check.allPlaces()) as Array<{ id: number; name?: string; address?: string; zip?: string; city?: string }>;
  const placeName = (id: number) => {
    const p = places.find((x) => Number(x.id) === Number(id));
    return p ? `${p.name || ""} ${p.address || ""}`.trim() : "";
  };
  /**
   * A context-free duplicate: a row whose address is its own name, or that has no
   * postcode and no city. About 3,000 of the tenant's 6,864 rows are these, and
   * they exist because this engine created them.
   */
  const placeIsAShell = (id: number) => {
    const p = places.find((x) => Number(x.id) === Number(id));
    if (!p) return true;
    const norm = (s?: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (norm(p.address) === norm(p.name)) return true;
    return !p.zip && !p.city;
  };

  const cases = buildRandomCases(N);
  console.log(`model ${MODEL}`);
  console.log(`${cases.length} cases, ${cases.filter((c) => c.amend).length} amended, ceiling $${CEILING}`);
  writeFileSync(RESULTS, "");

  const started = Date.now();
  let done = 0, failed = 0, usd = 0;
  for (let i = 0; i < cases.length; i += CONCURRENCY) {
    const out = await Promise.all(cases.slice(i, i + CONCURRENCY).map((c) =>
      runCase(c, professionName, placeName, placeIsAShell).catch(() => ({ spent: 0, ok: false }))));
    done += out.length;
    failed += out.filter((o) => !o.ok).length;
    usd += out.reduce((n, o) => n + o.spent, 0);
    process.stdout.write(`\r  ${done}/${cases.length}  failed ${failed}  ~$${usd.toFixed(2)}  ${Math.round((Date.now() - started) / 1000)}s   `);
    // THE CEILING IS CHECKED BETWEEN BATCHES, not only inside the guard: the guard stops
    // one case's reasoner, and what matters is stopping the RUN.
    if (usd > CEILING) { console.log(`\nSTOPPED: $${usd.toFixed(2)} exceeds the $${CEILING} ceiling`); break; }
  }
  console.log(`\ndone in ${Math.round((Date.now() - started) / 1000)}s, ~$${usd.toFixed(2)} -> ${RESULTS}`);
  if (mode === "full") await cleanup();
  else console.log(`--keep: ${led.orders.length} order(s) left`);
})();
