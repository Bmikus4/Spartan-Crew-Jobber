// ============================================================================
// The runner. One corpus, two reasoners, two transports.
// ----------------------------------------------------------------------------
//   npx tsx study/run.ts --leg=free               500 cases, scripted, fixture, FREE
//   npx tsx study/run.ts --leg=free --n=20        a pilot
//   npx tsx study/run.ts --leg=model --n=50       the real model. THIS SPENDS MONEY.
//   npx tsx study/run.ts --leg=free --live        write to OnSinch company 515
//   npx tsx study/run.ts --cleanup                delete everything the ledger lists
//
// THE FREE LEG IS THE CONTROL. Its reasoner is a perfect extractor, so every
// failure it finds is the engine's — composition, the bands, resolution, the
// hold decisions, the write path. The model leg runs the SAME cases with the
// real reasoner, so the difference between the two numbers is extraction, and
// nothing else. The prior study could not do this and said so: "a live model
// call adds a second variable to every failure".
//
// Results are appended per case rather than written at the end, so a crash
// keeps everything up to the crash.
// ============================================================================
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleThread } from "../app/lib/engine/pipeline";
import { coerceThread } from "../app/lib/engine/intake";
import { buildCases, COMPANY_ID, COMPANY_NAME, type StudyCase } from "./cases";
import { expect as oracleExpect, type Expectation } from "./oracle";
import { scoreCase, dispositionOf, type Observed, type Scored } from "./score";
import { buildRig, loadPlaces, loadProfessions, payloadFor, type Wire } from "./rig";
import { PLACEHOLDER_PLACE_NAME } from "./gold";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const numOf = (n: string, d: number) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? Number(a.split("=")[1]) : d;
};
const strOf = (n: string, d: string) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? String(a.split("=")[1]) : d;
};

const LEG = strOf("leg", "free") as "free" | "model";
const N = numOf("n", 500);
const CONCURRENCY = numOf("concurrency", LEG === "model" ? 3 : 8);
const LIVE = has("--live");
const SEED = numOf("seed", 20260902);
/** A hard stop IN DOLLARS, checked between batches, for the model leg. */
const CEILING = numOf("ceiling", 8);

const OUT = join(import.meta.dirname, "..", ".tmp-data", "study");
mkdirSync(OUT, { recursive: true });
const RESULTS = join(OUT, `results-${LEG}${LIVE ? "-live" : ""}.jsonl`);
const LEDGER = join(OUT, "ledger.json");
const led: { orders: number[]; places: number[] } =
  existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { orders: [], places: [] };
const saveLedger = () => writeFileSync(LEDGER, JSON.stringify(led, null, 2));

export interface CaseResult {
  id: string;
  leg: string;
  cell: Record<string, string | number | boolean>;
  ms: number;
  new_: { expected: Expectation; observed: Observed; scored: Scored };
  amend_?: { shape: string; expected: Expectation; observed: Observed; scored: Scored };
  wire: string[];
  created: number[];
}

/**
 * The placeholder ids in force for one case: the tenant's own row plus any this
 * case provisioned under that name. Recomputed per case because the fixture
 * hands out a fresh id each time and a set built once at start-up would call
 * every later placeholder a wrong building.
 */
function phIds(wire: Wire, base: Set<number>): Set<number> {
  const out = new Set(base);
  for (const p of wire.provisioned) {
    if (p.name.trim().toLowerCase() === PLACEHOLDER_PLACE_NAME.toLowerCase()) out.add(p.id);
  }
  return out;
}

/** What the engine actually did, read off the state it returned. */
function observe(state: any, wire: Wire, err?: unknown): Observed {
  const order = state?.desired_order ?? null;
  const teams = (order?.slot_teams ?? []).map((t: any) => ({
    size: t.size, profession_id: t.profession_id, place_id: t.place_id,
    beginning: t.beginning, end: t.end, name: t.name ?? "",
  }));
  return {
    classification: state?.classification,
    status: state?.status,
    needs_human: state?.needs_human,
    teams,
    order,
    pending_order: state?.pending_order,
    onsinch_order_id: state?.onsinch_order_id,
    notes: state?.notes ?? [],
    ...(err ? { error: String((err as Error)?.message ?? err).slice(0, 300) } : {}),
  };
}

async function runCase(
  c: StudyCase,
  places: any[],
  professions: any[],
  live: { baseUrl: string; apiKey: string } | null,
  placeholderIds: Set<number>,
  makeReasoner: null | ((c: StudyCase, pass: () => "new" | "amend") => any),
  venueJudge: any
): Promise<CaseResult> {
  const t0 = Date.now();
  const created: number[] = [];
  let pass: "new" | "amend" = "new";

  const rig = buildRig({
    case: c, places, professions, venueJudge,
    ...(makeReasoner ? { reasoner: makeReasoner(c, () => pass) } : {}),
    ...(live
      ? {
          live: {
            ...live,
            // LEDGERED BEFORE ANYTHING ELSE HAPPENS TO THE ID. An order that
            // exists is always an order the cleanup knows about, whichever path
            // made it and whether or not that path rolled it back.
            onOrderCreated: (id) => { created.push(id); if (!led.orders.includes(id)) { led.orders.push(id); saveLedger(); } },
            onPlaceCreated: (id) => { if (!led.places.includes(id)) { led.places.push(id); saveLedger(); } },
          },
        }
      : {}),
  });
  // The scripted reasoner reads `pass` through the rig's own flag; the model
  // reasoner is handed the same closure. Keep the two in step.
  rig.setPass("new");

  const res: Partial<CaseResult> = { id: c.id, leg: LEG + (LIVE ? "-live" : ""), cell: c.cell };

  // ------------------------------------------------------------ the first email
  const expNew = oracleExpect(c, "new");
  let stateNew: any = null, errNew: unknown = undefined;
  try {
    const thread = coerceThread(payloadFor(c, "new"));
    if (!thread) throw new Error("coerceThread refused the payload");
    stateNew = await handleThread(thread, rig.deps);
  } catch (e) { errNew = e; }
  const obsNew = observe(stateNew, rig.wire, errNew);
  res.new_ = { expected: expNew, observed: obsNew, scored: scoreCase(c, expNew, obsNew, "new", phIds(rig.wire, placeholderIds)) };

  // ------------------------------------------------------------ the follow-up
  if (c.amend && !errNew) {
    pass = "amend";
    rig.setPass("amend");
    const expAm = oracleExpect(c, "amend");
    let stateAm: any = null, errAm: unknown = undefined;
    try {
      const thread = coerceThread(payloadFor(c, "amend"));
      if (!thread) throw new Error("coerceThread refused the payload");
      stateAm = await handleThread(thread, rig.deps);
    } catch (e) { errAm = e; }
    const obsAm = observe(stateAm, rig.wire, errAm);
    res.amend_ = { shape: c.amend.shape, expected: expAm, observed: obsAm, scored: scoreCase(c, expAm, obsAm, "amend", phIds(rig.wire, placeholderIds)) };
  }

  res.wire = rig.wire.calls;
  res.created = created;
  res.ms = Date.now() - t0;
  const full = res as CaseResult;
  appendFileSync(RESULTS, JSON.stringify(full) + "\n");
  return full;
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
  const { loadEnv, requireEnv, onsinchBase } = await import("../scripts/_env.mjs");
  const { OnsinchClient, httpTransport } = await import("../app/lib/engine/onsinch");
  loadEnv();
  const onsinch = new OnsinchClient(httpTransport({ baseUrl: onsinchBase(), apiKey: requireEnv("ONSINCH_API_KEY") }));
  const ids = [...new Set(led.orders)];
  if (!ids.length) { console.log("ledger clean — nothing to delete"); return; }
  console.log(`cleanup: ${ids.length} order(s)`);
  let gone = 0; const stuck: number[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    await Promise.all(batch.map(async (id) => {
      try {
        const still = await onsinch.orderById(id);
        if (!still) { gone++; return; }
        await onsinch.deleteOrders([id]);
        // RE-READ. A 200 on the delete is not proof the row is gone.
        const after = await onsinch.orderById(id);
        if (after) stuck.push(id); else gone++;
      } catch { stuck.push(id); }
    }));
    process.stdout.write(`\r  ${Math.min(i + 20, ids.length)}/${ids.length}`);
  }
  console.log(`\n  gone ${gone}, still present ${stuck.length}${stuck.length ? " -> " + stuck.join(",") : ""}`);
  if (led.places.length) console.log(`  NOTE ${led.places.length} place(s) were provisioned and are NOT auto-deleted: ${led.places.join(",")}`);
  led.orders = stuck; saveLedger();
}

// ---------------------------------------------------------------- run
(async () => {
  if (has("--cleanup")) { await cleanup(); return; }

  const places = loadPlaces();
  const professions = loadProfessions();
  /**
   * The "No Location" row, if the tenant has one yet. Looked up ONCE rather
   * than assumed: it is absent today, so the engine provisions it, but the
   * moment somebody runs this against a tenant that has it the placeholder
   * arrives as an ordinary id and a scorer that only recognised the provision
   * would report every unheld venue as a miss.
   */
  const placeholderIds = new Set<number>(
    places.filter((p: any) => String(p.name ?? "").trim().toLowerCase() === PLACEHOLDER_PLACE_NAME.toLowerCase()).map((p: any) => Number(p.id))
  );
  console.log(`tenant fixtures: ${places.length} places, ${professions.length} professions, placeholder row(s) ${placeholderIds.size ? [...placeholderIds].join(",") : "absent (will be provisioned)"}`);

  let live: { baseUrl: string; apiKey: string } | null = null;
  if (LIVE) {
    const { loadEnv, requireEnv, onsinchBase } = await import("../scripts/_env.mjs");
    loadEnv();
    live = { baseUrl: onsinchBase(), apiKey: requireEnv("ONSINCH_API_KEY") };
    // The one assertion that keeps this off a real client.
    const { OnsinchClient, httpTransport } = await import("../app/lib/engine/onsinch");
    const check = new OnsinchClient(httpTransport(live));
    const companies = (await check.allCompanies()) as Array<{ id: number; name?: string }>;
    const test = companies.find((x) => String(x.name || "").trim() === COMPANY_NAME);
    if (!test || Number(test.id) !== COMPANY_ID) {
      throw new Error(`refusing to run: "${COMPANY_NAME}" is not company ${COMPANY_ID} on this tenant`);
    }
    console.log(`LIVE on company ${COMPANY_ID} "${COMPANY_NAME}" — every order id is ledgered before it is created`);
  }

  /** Per-case running total, so the shared counter can take a delta. */
  const lastUsd = new Map<string, number>();
  let makeReasoner: null | ((c: StudyCase, pass: () => "new" | "amend") => any) = null;
  let venueJudge: any = null;
  /**
   * CUMULATIVE, across every case in the run.
   *
   * Each case builds its OWN guardReasoner with its own counter, so reading
   * that counter reports what the last case spent and nothing else — the
   * ceiling check `spend.usd > CEILING` could never trip, and a run that was
   * meant to abort at $8 would have gone to completion at any price. Each
   * case's guard now reports its DELTA into a total the loop owns.
   */
  const spend = { calls: 0, usd: 0 };
  if (LEG === "model") {
    const { loadEnv, requireEnv } = await import("../scripts/_env.mjs");
    const { createOpenRouterReasoner, createVenueJudge } = await import("../app/lib/engine/reason");
    const { guardReasoner } = await import("../app/lib/engine/spend");
    loadEnv();
    const apiKey = requireEnv("OPENROUTER_API_KEY");
    const model = process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6";
    console.log(`model ${model}, ceiling $${CEILING}`);
    venueJudge = createVenueJudge({ apiKey, model });
    makeReasoner = (c) =>
      guardReasoner(createOpenRouterReasoner({ apiKey, model }), {
        model,
        label: `study ${c.id}`,
        // Calls one case may make: 2 combined + 2 replies, plus headroom.
        limit: 10,
        onCall: (r: any) => {
          spend.calls += 1;
          spend.usd += Math.max(0, r.estimatedUsd - (lastUsd.get(c.id) ?? 0));
          lastUsd.set(c.id, r.estimatedUsd);
        },
      });
  }

  const all = buildCases(500, SEED);
  /**
   * A subset is drawn by SEEDED SHUFFLE, never by prefix and never by stride.
   *
   * Both of the obvious ways are wrong here and one of them was in this file.
   * The grid is built by index arithmetic — size is i%13, the amendment is
   * i%2, the not-a-job cases are i%12 — so a prefix draws every factor from the
   * low end of its cycle, and a stride ALIASES against those periods. A pilot
   * of 8 at stride 62 drew indices 0,62,124,186,248,310,372,434: every one
   * even, so it contained zero amendments and zero non-bookings, and it
   * reported 6/8 on a sample that could not reach half the corpus.
   *
   * The shuffle is seeded from the same seed as the corpus, so the subset is
   * reproducible and one run is comparable to the next.
   */
  const shuffled = all.slice();
  let s = SEED >>> 0;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const j = ((t ^ (t >>> 14)) >>> 0) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const cases = N >= all.length ? all : shuffled.slice(0, N);

  console.log(
    `${cases.length} cases (${cases.filter((c) => c.amend).length} amended, ` +
    `${cases.filter((c) => c.kind !== "booking").length} not bookings), leg=${LEG}, ` +
    `transport=${LIVE ? "LIVE" : "fixture"}, concurrency ${CONCURRENCY}`
  );
  writeFileSync(RESULTS, "");

  const started = Date.now();
  let done = 0, passed = 0;
  for (let i = 0; i < cases.length; i += CONCURRENCY) {
    if (LEG === "model" && spend.usd > CEILING) {
      console.log(`\nABORTED at $${spend.usd.toFixed(2)} — over the $${CEILING} ceiling`);
      break;
    }
    const batch = cases.slice(i, i + CONCURRENCY);
    const out = await Promise.all(batch.map((c) =>
      runCase(c, places, professions, live, placeholderIds, makeReasoner, venueJudge).catch((e) => {
        const bad: any = { id: c.id, leg: LEG, cell: c.cell, ms: 0, wire: [], created: [], error: String(e) };
        appendFileSync(RESULTS, JSON.stringify(bad) + "\n");
        return bad as CaseResult;
      })
    ));
    done += out.length;
    passed += out.filter((r) => r.new_?.scored?.pass).length;
    const rate = (Date.now() - started) / done;
    process.stdout.write(
      `\r  ${done}/${cases.length}  pass ${passed} (${Math.round((passed / done) * 100)}%)` +
      (LEG === "model" ? `  ~$${spend.usd.toFixed(2)}` : "") +
      `  ~${Math.round(((cases.length - done) * rate) / 1000)}s left   `
    );
  }
  console.log(`\ndone in ${Math.round((Date.now() - started) / 1000)}s -> ${RESULTS}`);
  if (LIVE) console.log(`${led.orders.length} order(s) ledgered. Run --cleanup to remove them.`);
})();
