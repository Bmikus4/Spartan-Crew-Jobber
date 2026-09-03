// ============================================================================
// The rig the study runs on. ONE rig, two transports and two reasoners.
// ----------------------------------------------------------------------------
// Everything downstream of the reasoner is the PRODUCTION code path —
// coerceThread, handleThread, createOrderWithPlace, amendOrderInPlace,
// replaceProvisionalOrder. A study that reimplements the thing it is measuring
// measures the reimplementation, and this repo has already been bitten: an
// earlier corpus executor duplicated the two-phase create WITHOUT its rollback
// and left half-built orders behind, a defect of the harness that read as a
// defect of the engine.
//
// The two axes are deliberately orthogonal, and that is what makes a failure
// attributable:
//
//   reasoner  scripted | model     scripted is a PERFECT extractor, so a failure
//                                  under it is the engine's. The same case under
//                                  the model isolates extraction exactly.
//   transport fixture  | live      fixture answers from the REAL tenant lists and
//                                  records every write; live is OnSinch itself on
//                                  TEST company 515.
//
// THE FIXTURE SERVES THE REAL VENUE TABLE. All 5,567 rows, 61% of which carry no
// address at all. A resolver tested against a three-row fixture never meets the
// failure the tenant actually contains, and venue is where this engine's misses
// live.
// ============================================================================
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OnsinchClient, httpTransport, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { createOrderWithPlace } from "../app/lib/deps";
import { DEFAULT_SETTINGS, type ConversationFacts, type PlaceCandidate } from "../app/lib/engine/types";
import type { Executor, PipelineDeps } from "../app/lib/engine/pipeline";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { PROFESSION_LIST } from "../app/lib/engine/professionList";
import type { ProfessionRec } from "../app/lib/engine/professions";
import { COMPANY_ID, COMPANY_NAME, CONTACT, type StudyCase, type TruthBlock } from "./cases";
import { ROLE_BY_KEY, VENUE_BY_KEY } from "./gold";

const ROOT = join(import.meta.dirname, "..");

// ---------------------------------------------------------------- tenant data
function cached(file: string): unknown | null {
  const p = join(ROOT, ".tmp-data", file);
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, "utf8"));
  return Array.isArray(j) ? j : (j as { data?: unknown }).data ?? null;
}

export function loadProfessions(): ProfessionRec[] {
  return (cached("professions.json") as ProfessionRec[] | null) ?? PROFESSION_LIST;
}

/**
 * The live venue list. There is no committed substitute and no point inventing
 * one: the venue cases exist to meet the thousands of context-free duplicate
 * rows the tenant holds, and a fixture without them tests nothing.
 */
export function loadPlaces(): PlaceCandidate[] {
  const p = cached("places.json") as PlaceCandidate[] | null;
  if (!p) {
    throw new Error(
      "the study needs the tenant's venue list, which is gitignored client data.\n" +
      "  node scripts/pull-places.mjs        (writes .tmp-data/places.json)\n" +
      "  node scripts/pull-professions.mjs   (optional; the committed list is used otherwise)"
    );
  }
  return p;
}

// ---------------------------------------------------------------- reasoner
/**
 * A PERFECT extractor. It reports exactly and only what the case declares —
 * an unstated field is absent from the body AND absent from the facts, so the
 * engine's own defaults are what get exercised rather than the generator's.
 *
 * `pass` is flipped by the runner between the two emails of an amendment case,
 * because classification is a property of the message and the runner is the
 * only thing that knows which message it is sending.
 */
export function scriptedReasoner(c: StudyCase, pass: () => "new" | "amend"): Reasoner {
  const factsFor = (blocks: TruthBlock[], po: string | null): ConversationFacts => ({
    company_name: COMPANY_NAME,
    contact_name: "Dani Fowler",
    contact_email: CONTACT,
    ...(po ? { customer_reference: po } : {}),
    /**
     * THE JOB'S VENUE ALWAYS GOES AT THE TOP LEVEL, and a block only carries
     * one when it differs. That is what EXTRACT_SYSTEM asks for in as many
     * words — "the job's venue belongs in the top-level location_text and
     * repeating it here says the crew move when they do not" — so it is what a
     * PERFECT extractor emits, and this reasoner is the definition of one.
     *
     * The first draft omitted the top level entirely on any multi-venue job.
     * The engine then reported "no venue named" and put the first block on
     * place 87 — a row literally named "Location" — which read as a serious
     * engine defect and was a defect of this function. A harness that cannot
     * state the facts the spec asks for measures itself.
     *
     * Whether the engine survives an order with NO top-level venue is a real
     * question and a real hazard, but it is asked deliberately by its own cell
     * (cases whose `noTopVenue` flag is set), not by accident on every
     * multi-venue case.
     */
    ...(blocks[0] ? { location_text: blocks[0].said } : {}),
    requests: blocks.map((b) => ({
      ...(b.date ? { date: b.date } : {}),
      ...(b.start ? { start_time: b.start } : {}),
      ...(b.end ? { end_time: b.end } : {}),
      size: b.size,
      ...(b.task ? { task: b.task } : {}),
      ...(b.role !== "crew" ? { profession_hint: ROLE_BY_KEY.get(b.role)!.said[0] } : {}),
      // Only where THIS block is somewhere else than the job's own venue —
      // and in the CLIENT'S words, not the tenant's. See TruthBlock.said.
      ...(b.venue !== blocks[0].venue ? { location_text: b.said } : {}),
    })),
  });

  return {
    async classify(): Promise<ClassifyResult> {
      if (pass() === "amend") {
        return { classification: "update", priority: "medium", job_summary: `${c.id} amended`, order_title: `${COMPANY_NAME} job ${c.id}` };
      }
      const classification =
        c.kind === "not-a-job" ? "not-a-job" as const
        : c.kind === "confirmation-only" ? "confirmation-only" as const
        : "new-job" as const;
      return { classification, priority: "high", job_summary: c.id, order_title: `${COMPANY_NAME} job ${c.id}` };
    },
    async extractFacts(): Promise<ConversationFacts> {
      const which = pass() === "amend" ? c.amend!.truth : c.truth;
      if (c.kind !== "booking" && pass() === "new") return { requests: [], company_name: COMPANY_NAME, contact_email: CONTACT };
      return factsFor(which.blocks, which.po);
    },
    async composeReply(): Promise<ReplyResult> {
      return { subject: `Re: ${c.subject}`, html: "<p>noted</p>", priority: "high" };
    },
  };
}

// ---------------------------------------------------------------- transport
export interface Wire {
  calls: string[];
  created: Array<{ id: number; body: unknown }>;
  patched: unknown[];
  deleted: number[][];
  placesCreated: number[];
  /**
   * The rows this run created, WITH THEIR NAMES.
   *
   * The id alone is not enough to score a venue. "No Location" is provisioned
   * on the first enquiry that needs it and is an ordinary id for every enquiry
   * after, so a scorer holding only ids cannot tell the placeholder — a correct
   * answer — from a real building the engine picked by mistake. The name is
   * what separates them.
   */
  provisioned: Array<{ id: number; name: string }>;
  companiesCreated: number[];
}

export const emptyWire = (): Wire => ({ calls: [], created: [], patched: [], deleted: [], placesCreated: [], provisioned: [], companiesCreated: [] });

/**
 * A fixture OnSinch. It answers the endpoints the engine reads from the REAL
 * tenant lists and records the ones it writes, so "what would have reached the
 * tenant" is a value the report can show rather than a thing to be trusted.
 *
 * Order ids are derived from the case id, never random: a simulation whose ids
 * move between runs cannot be diffed against its own previous run.
 */
export function fixtureTransport(c: StudyCase, places: PlaceCandidate[], wire: Wire): Transport {
  let nextOrderId = 90000 + (parseInt(createHash("md5").update(c.id).digest("hex").slice(0, 6), 16) % 9000);
  let nextTeamId = 300000;
  const createdTeamIds: number[] = [];
  const companies = [{
    id: COMPANY_ID, name: COMPANY_NAME, invoice_name: COMPANY_NAME,
    Client: [{ id: 55101, email: CONTACT }],
  }];
  /** 20 orders on one card, so a history-derived rate card is reachable. */
  const history = Array.from({ length: 20 }, (_, i) => ({
    id: 7000 + i, number: String(10000 + i),
    happening: `2026-11-0${(i % 8) + 1}T08:00:00+00:00`,
    Job: [{ id: 6000 + i, pricelist_category_id: 315 }],
  }));
  const page = (rows: unknown[]) => ({ status: 200, data: { data: rows, pagination: { count: rows.length, pageCount: 1, nextPage: false } } });

  return async (method, path, body) => {
    wire.calls.push(`${method} ${path.split("?")[0]}`);

    if (method === "POST" && path === "/orders") {
      const id = nextOrderId++;
      wire.created.push({ id, body });
      return { status: 201, data: { data: [{ id, number: String(20000 + (id % 1000)) }] } };
    }
    if (method === "POST" && path === "/slotTeams") {
      // Folded back into the recorded order body, so `created` still means
      // "everything written for this order" whether the create carried its crew
      // nested or posted it block by block. It is one write split across calls,
      // not a different write.
      const last = wire.created[wire.created.length - 1];
      const body0 = (last?.body as Array<{ SlotTeam?: unknown[] }> | undefined)?.[0];
      if (body0) (body0.SlotTeam ??= []).push(...(body as unknown[]));
      const teamId = nextTeamId++;
      createdTeamIds.push(teamId);
      return { status: 201, data: { data: [{ id: teamId }] } };
    }
    if (method === "PATCH" && path === "/slotTeams") { wire.patched.push(body); return { status: 204, data: null }; }
    if (method === "PATCH" && path === "/orders") { wire.patched.push(body); return { status: 204, data: null }; }
    if (method === "DELETE" && path === "/orders") { wire.deleted.push(body as number[]); return { status: 200, data: null }; }
    if (method === "POST" && path === "/places") {
      const id = 99000 + wire.placesCreated.length;
      wire.placesCreated.push(id);
      const name = String((body as Array<{ name?: string }> | undefined)?.[0]?.name ?? "");
      wire.provisioned.push({ id, name });
      return { status: 201, data: { data: [{ id }] } };
    }
    if (method === "POST" && path === "/companies") {
      const id = 98000 + wire.companiesCreated.length;
      wire.companiesCreated.push(id);
      return { status: 201, data: { data: [{ id, name: COMPANY_NAME }] } };
    }

    // Nobody is signed on to a fixture order, so a rebuild is never blocked by
    // attendance. The confirmed-order refusal is exercised by its own cases.
    if (path.startsWith("/attendance")) return page([]);
    if (path.startsWith("/places")) return page(places);
    if (path.startsWith("/companies")) return page(companies);
    if (path.startsWith("/orders")) {
      const m = /[?&]id(?:\[eq\])?=(\d+)/.exec(path);
      if (m) {
        const id = Number(m[1]);
        const mine = wire.created.find((o) => o.id === id);
        if (!mine) return page([]);
        return page([{
          id, number: String(20000 + (id % 1000)),
          happening: "2027-03-01T08:00:00+00:00",
          provisional: true, quote: false, company_id: COMPANY_ID,
          Job: [{ id: 60000 + (id % 1000), min_beginning: "2027-03-01T08:00:00+00:00", max_end: "2027-03-01T18:00:00+00:00" }],
        }]);
      }
      return page(history);
    }
    return page([]);
  };
}

// ---------------------------------------------------------------- the rig
export interface Rig {
  deps: PipelineDeps;
  store: InMemoryStore;
  wire: Wire;
  onsinch: OnsinchClient;
  setPass: (p: "new" | "amend") => void;
}

export function buildRig(opts: {
  case: StudyCase;
  places: PlaceCandidate[];
  professions: ProfessionRec[];
  /** Omit for the fixture. Supplying both means LIVE writes to the tenant. */
  live?: { baseUrl: string; apiKey: string; onOrderCreated: (id: number) => void; onPlaceCreated: (id: number) => void };
  /** The real model, when this leg is measuring extraction. */
  reasoner?: Reasoner;
  venueJudge?: PipelineDeps["venueJudge"];
}): Rig {
  // The list cache is module-global and keyed by list name, so a case would
  // otherwise resolve its client against the PREVIOUS case's company set.
  __resetListCache();

  const wire = emptyWire();
  let pass: "new" | "amend" = "new";

  const transport: Transport = opts.live
    ? async (m, p, b) => {
        const r = await httpTransport({ baseUrl: opts.live!.baseUrl, apiKey: opts.live!.apiKey })(m, p, b);
        if (m !== "GET") wire.calls.push(`${m} ${p.split("?")[0]} -> ${r.status}`);
        // LEDGERED FROM THE WIRE. An id that only exists in a variable is an id
        // a crash loses, and an order nobody deletes is a permanent edit to the
        // tenant made by a test.
        if (m === "POST" && p === "/orders" && r.status === 201) {
          const id = Number((r.data as { data?: { id?: number }[] })?.data?.[0]?.id);
          if (Number.isInteger(id)) { wire.created.push({ id, body: b }); opts.live!.onOrderCreated(id); }
        }
        if (m === "POST" && p === "/places" && r.status === 201) {
          const id = Number((r.data as { data?: { id?: number }[] })?.data?.[0]?.id);
          if (Number.isInteger(id)) {
            wire.placesCreated.push(id);
            wire.provisioned.push({ id, name: String((b as Array<{ name?: string }> | undefined)?.[0]?.name ?? "") });
            opts.live!.onPlaceCreated(id);
          }
        }
        return r;
      }
    : fixtureTransport(opts.case, opts.places, wire);

  const onsinch = new OnsinchClient(transport);
  const store = new InMemoryStore();

  /**
   * THE CLOCK TRAVELS WITH THE ENQUIRY, and this is load-bearing twice over.
   *
   * It must stand BEFORE the work: a clock after it makes every case unbookable
   * at once — crew cannot be sent to a day that has gone — and an earlier rig
   * ran seven months ahead of its own scenarios and scored rule agreement at
   * 9/100 while the engine was right about all of it.
   *
   * It must also stand WITH the email, because the year a bare date resolves to
   * is measured from the day the message was written. A fixed clock and a
   * moving corpus is what made the first pilot mark correct bookings as
   * year-misses.
   */
  let clock = Date.parse(`${opts.case.sentAt}T09:30:00Z`);

  const executor: Executor = {
    async createReplyDraft() { return "no-draft"; },
    // THE PRODUCTION FUNCTION, not a copy of it.
    async createOrder(order) { return createOrderWithPlace(onsinch, order); },
    async patchOrder(p) {
      const applied: string[] = [];
      const patch: Record<string, unknown> = { id: p.order_id };
      if (p.desired.specification) { patch.specification = p.desired.specification; applied.push("specification"); }
      if (p.desired.intern_name) { patch.intern_name = p.desired.intern_name; applied.push("intern_name"); }
      if (applied.length) await onsinch.patchOrder([patch as { id: number }]);
      return applied;
    },
    async amendOrderInPlace(p) {
      return amendOrderInPlace(
        onsinch,
        { order_id: p.order_id, previous: p.previous, desired: p.desired, alreadyCreated: p.alreadyCreated, known: p.known },
        { onCreated: p.onCreated },
      );
    },
    async replaceOrder(p) {
      return replaceProvisionalOrder(
        onsinch,
        { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted, weCreatedIt: p.weCreatedIt },
        { onIntent: p.onIntent, onDeleted: p.onDeleted },
      );
    },
    async identifiersForOrder(order_id) {
      const live = (await onsinch.orderById(order_id)) as { Job?: { id: number }[]; number?: string } | null;
      const job = Array.isArray(live?.Job) ? live?.Job?.[0] : (live?.Job as { id: number } | undefined);
      return { job_id: job?.id, order_number: live?.number != null ? String(live.number) : undefined };
    },
    async createInternalDraft() { return "internal-draft"; },
  };

  const deps: PipelineDeps = {
    reasoner: opts.reasoner ?? scriptedReasoner(opts.case, () => pass),
    onsinch, now: () => ++clock, store,
    metrics: new InMemoryMetrics(), executor, settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    professions: opts.professions,
    // Pinned, so a case measures the BOOKING rather than the rate-card path.
    // The rate card is Spartan's own number and has its own study.
    seededRateCard: async () => 315,
    defaultRateCard: DEFAULT_SETTINGS.default_rate_card,
    archiveOrder: async () => 1,
    recordReplacement: async () => {},
    venueJudge: opts.venueJudge ?? null,
  };

  return { deps, store, wire, onsinch, setPass: (p) => { pass = p; } };
}

// ---------------------------------------------------------------- the thread
/**
 * The n8n inbound payload, built from the case. The runner hands this to
 * `coerceThread` — the SAME function the live route calls — so the study enters
 * the system at the seam production does rather than one layer inside it.
 */
export function payloadFor(c: StudyCase, upTo: "new" | "amend"): Record<string, unknown> {
  const base = Date.parse(`${c.sentAt}T09:00:00Z`);
  const msgs = [...c.messages.map((m) => ({ ...m }))];
  if (upTo === "amend" && c.amend) msgs.push(...c.amend.messages.map((m) => ({ ...m })));
  return {
    thread_id: `study-${c.id}`,
    messages: msgs.map((m, i) => ({
      message_id: `${c.id}-m${i + 1}`,
      from: m.from === "spartan" ? "bookings@spartancrew.co.uk" : CONTACT,
      to: [m.from === "spartan" ? CONTACT : "bookings@spartancrew.co.uk"],
      date_iso: new Date(base + i * 3600_000).toISOString(),
      subject: i === 0 ? c.subject : `Re: ${c.subject}`,
      body: m.body,
      is_from_spartan: m.from === "spartan",
    })),
  };
}
