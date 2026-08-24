// ============================================================================
// The rig the 100 simulated bookings run on.
// ----------------------------------------------------------------------------
// Everything side-effecting is a fixture, and every fixture is REAL tenant data
// where real data exists: the 43 professions and 6,847 places are the live lists
// (.tmp-data, verified against OnSinch at run time by sim/run.ts). That matters
// most for venues — 3,000 of those 6,847 rows are context-free shells of about
// twenty real buildings, and a resolver tested against a three-row fixture never
// meets the failure the tenant actually contains.
//
// The MODEL is scripted, not called. A run costs nothing and is deterministic,
// and what is being measured here is the deterministic engine — composition,
// the chief bands, resolution, the hold decisions, the write path. Extraction
// accuracy is a separate question with a separate (paid) instrument, and mixing
// the two would leave every failure ambiguous between them.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { OnsinchClient, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { createOrderWithPlace } from "../app/lib/deps";
import { DEFAULT_SETTINGS, type ConversationFacts, type HydratedThread, type ThreadMessage } from "../app/lib/engine/types";
import type { Executor, PipelineDeps } from "../app/lib/engine/pipeline";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import type { ProfessionRec } from "../app/lib/engine/professions";
import { PROFESSION_LIST } from "../app/lib/engine/professionList";
import type { PlaceCandidate } from "../app/lib/engine/types";
import type { SimBlock, SimCase } from "./types";

const ROOT = join(import.meta.dirname, "..");

// ------------------------------------------------------------------ tenant data
// Both caches live under .tmp-data, which is gitignored: 2MB of the client's venue
// records is not repo content. So a fresh checkout has to be told how to get them
// rather than failing on a missing file it has never heard of.
function cached(file: string): unknown | null {
  const p = join(ROOT, ".tmp-data", file);
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, "utf8"));
  return Array.isArray(j) ? j : (j as { data?: unknown }).data ?? null;
}

/** The live 43, or the committed list — which the engine itself falls back to. */
export function loadProfessions(): ProfessionRec[] {
  return (cached("professions.json") as ProfessionRec[] | null) ?? PROFESSION_LIST;
}

/**
 * The live venue list. There is no committed substitute and no point inventing one:
 * the venue cases exist to meet the 3,000 context-free duplicate rows, and a fixture
 * without them tests nothing.
 */
export function loadPlaces(): PlaceCandidate[] {
  const p = cached("places.json") as PlaceCandidate[] | null;
  if (!p) {
    throw new Error(
      "sim needs the tenant's venue list, which is gitignored client data.\n" +
        "  node scripts/pull-places.mjs        (~69 pages, writes .tmp-data/places.json)\n" +
        "  node scripts/pull-professions.mjs   (optional; the committed list is used otherwise)"
    );
  }
  return p;
}

/** The three synthetic clients, one per rate-card path. */
export const CLIENTS = {
  history: { id: 8801, name: "Meridian Exhibitions", domain: "meridianexhibitions.co.uk", contact_id: 55101, card: 342 },
  nohistory: { id: 8802, name: "Kestrel Brand Live", domain: "kestrelbrandlive.co.uk", contact_id: 55102, card: null },
  new: { id: 0, name: "Northwind Staging Collective", domain: "northwindstaging.co.uk", contact_id: null, card: null },
} as const;

export const PLACEHOLDER_CONTACT_ID = 1; // matches compiler.ts's stand-in

// ------------------------------------------------------------------ email bodies
const timeWords = (b: SimBlock): string => {
  if (b.start && b.end) return ` from ${b.start} to ${b.end}`;
  if (b.start) return ` starting at ${b.start}`;
  if (b.end) return ` finishing at ${b.end}`;
  return "";
};

/**
 * One line of prose per block, stating exactly and only what the block states.
 *
 * The omissions are the point: a block with no start time must produce a sentence
 * with no start time in it, or parseWork fills the gap from the text and the
 * engine's 08:00 default is never reached. The body and the facts are two views of
 * one declaration, never two sources.
 */
export function bodyFor(c: SimCase, blocks: SimBlock[], kind: "new" | "amend"): string {
  if (c.classification === "not-a-job") return "Morning — just chasing the invoice for last month, nothing else needed. Cheers.";
  if (c.classification === "confirmation-only") return "Perfect, thanks for that.";
  const lead = kind === "new"
    ? `Hi, we'd like to book crew for an upcoming job.`
    : `Following up on the below — please update the booking.`;
  const lines = blocks.map((b) => {
    const who = b.prof ? `${b.size ?? "some"} x ${b.prof}` : `${b.size ?? "some"} crew`;
    const when = b.date ? ` on ${b.date}` : ` (date still TBC)`;
    const where = b.venue ? ` at ${b.venue}` : "";
    const what = b.task ? ` — ${b.task}` : "";
    return `- ${who}${when}${timeWords(b)}${where}${what}`;
  });
  const venue = c.venue ? `\nVenue: ${c.venue}` : "";
  const po = c.po ? `\nOur PO is ${c.po}.` : "";
  return `${lead}\n${lines.join("\n")}${venue}${po}\n\nThanks`;
}

/** The facts a perfect extractor would return for these blocks. */
export function factsFor(c: SimCase, blocks: SimBlock[]): ConversationFacts {
  const cl = CLIENTS[c.client];
  return {
    company_name: cl.name,
    contact_name: "Sim Contact",
    contact_email: `bookings@${cl.domain}`,
    ...(c.po ? { customer_reference: c.po } : {}),
    ...(c.venue ? { location_text: c.venue } : {}),
    requests: blocks.map((b) => ({
      ...(b.date ? { date: b.date } : {}),
      ...(b.start ? { start_time: b.start } : {}),
      ...(b.end ? { end_time: b.end } : {}),
      ...(b.size !== undefined ? { size: b.size } : {}),
      ...(b.task ? { task: b.task } : {}),
      ...(b.prof ? { profession_hint: b.prof } : {}),
      ...(b.venue ? { location_text: b.venue } : {}),
    })),
  };
}

/**
 * The scripted model. `pass` is flipped by the runner between the two emails of an
 * amendment case, because classification is a property of the message and the
 * runner is the only thing that knows which message it is sending.
 */
export function scriptedReasoner(c: SimCase, pass: () => "new" | "amend"): Reasoner {
  return {
    async classify(): Promise<ClassifyResult> {
      if (pass() === "amend") {
        return {
          classification: c.amend?.classification ?? "update",
          priority: "medium",
          job_summary: "amendment to the booking",
          ...(c.amend?.cancellation ? { cancellation: true } : {}),
        } as ClassifyResult;
      }
      return {
        classification: c.classification ?? "new-job",
        priority: "high",
        job_summary: `crew request — ${c.label}`,
      };
    },
    async extractFacts(): Promise<ConversationFacts> {
      const blocks = pass() === "amend" ? c.amend!.blocks : c.blocks;
      return factsFor(c, blocks);
    },
    async composeReply(): Promise<ReplyResult> {
      return { subject: "Re: Crew request", html: "<p>Noted, thanks.</p>", priority: "high" };
    },
  };
}

// ------------------------------------------------------------------ transport
export interface CallLog {
  calls: string[];
  created: Array<{ id: number; body: unknown }>;
  patched: unknown[];
  deleted: number[][];
}

/**
 * A fixture OnSinch. It answers the five endpoints the engine reads and records the
 * three it writes, so "what would have reached the tenant" is a value the report can
 * show rather than a thing that has to be trusted.
 */
export function fixtureTransport(c: SimCase, places: PlaceCandidate[], log: CallLog): Transport {
  const cl = CLIENTS[c.client];
  // Derived from the case id, never random: a simulation whose order ids move
  // between runs cannot be diffed against its own previous run.
  let nextOrderId = 90000 + (parseInt(createHash("md5").update(c.id).digest("hex").slice(0, 6), 16) % 1000);
  let nextTeamId = 300000;
  const companies =
    c.client === "new"
      ? [{ id: 8801, name: CLIENTS.history.name, invoice_name: CLIENTS.history.name, Client: [{ id: CLIENTS.history.contact_id, email: `bookings@${CLIENTS.history.domain}` }] }]
      : [
          {
            id: cl.id,
            name: cl.name,
            invoice_name: cl.name,
            Client: [{ id: (cl as { contact_id: number | null }).contact_id, email: `bookings@${cl.domain}` }],
          },
        ];

  /** 20 orders all on one card, so resolveRateCard's 70% share test passes. */
  const history =
    c.client === "history"
      ? Array.from({ length: 20 }, (_, i) => ({
          id: 7000 + i,
          number: String(10000 + i),
          happening: "2025-11-0" + ((i % 8) + 1) + "T08:00:00+00:00",
          Job: [{ id: 6000 + i, pricelist_category_id: CLIENTS.history.card }],
        }))
      : [];

  const page = (rows: unknown[]) => ({
    status: 200,
    data: { data: rows, pagination: { count: rows.length, pageCount: 1, nextPage: false } },
  });

  return async (method, path, body) => {
    log.calls.push(`${method} ${path.split("?")[0]}`);

    if (method === "POST" && path === "/orders") {
      const id = nextOrderId++;
      log.created.push({ id, body });
      return { status: 201, data: { data: [{ id, number: String(20000 + (id % 1000)) }] } };
    }
    /**
     * The create is two-phase: an empty order, then one block at a time, because a
     * block's id only ever comes back from POST /slotTeams (API reference §12).
     *
     * Each posted block is folded back into the recorded order body, so `log.created`
     * still means "everything written for this order" and the wire invariant compares
     * the same quantity it always did. It is one write split across N+1 calls, not a
     * different write.
     */
    if (method === "POST" && path === "/slotTeams") {
      const last = log.created[log.created.length - 1];
      const body0 = (last?.body as Array<{ SlotTeam?: unknown[] }> | undefined)?.[0];
      if (body0) (body0.SlotTeam ??= []).push((body as unknown[])[0]);
      return { status: 201, data: { data: [{ id: nextTeamId++ }] } };
    }
    if (method === "PATCH" && path === "/orders") {
      log.patched.push(body);
      return { status: 204, data: null };
    }
    if (method === "DELETE" && path === "/orders") {
      log.deleted.push(body as number[]);
      return { status: 200, data: null };
    }
    if (method === "POST" && path === "/places") return { status: 201, data: { data: [{ id: 99001 }] } };
    if (method === "POST" && path === "/companies") return { status: 201, data: { data: [{ id: 99002, name: cl.name }] } };

    if (path.startsWith("/places")) return page(places);
    if (path.startsWith("/companies")) return page(companies);

    if (path.startsWith("/orders")) {
      // orderById, used by the replace preflight. `provisional` is the whole gate.
      const m = /[?&]id=(\d+)/.exec(path);
      if (m) {
        const id = Number(m[1]);
        const mine = log.created.find((o) => o.id === id);
        if (!mine) return page([]);
        return page([
          {
            id,
            number: String(20000 + (id % 1000)),
            happening: "2026-05-01T08:00:00+00:00",
            provisional: !c.orderConfirmed,
            quote: false,
            company_id: c.client === "new" ? 99002 : cl.id,
            Job: [{ id: 60000 + (id % 1000) }],
          },
        ]);
      }
      return page(history);
    }
    return page([]);
  };
}

// ------------------------------------------------------------------ deps
export interface Rig {
  deps: PipelineDeps;
  store: InMemoryStore;
  metrics: InMemoryMetrics;
  log: CallLog;
  setPass: (p: "new" | "amend") => void;
}

export function buildRig(c: SimCase, professions: ProfessionRec[], places: PlaceCandidate[]): Rig {
  // The list cache is module-global and keyed by list name, so a case would
  // otherwise resolve its client against the PREVIOUS case's company set.
  __resetListCache();

  const log: CallLog = { calls: [], created: [], patched: [], deleted: [] };
  let pass: "new" | "amend" = "new";
  const onsinch = new OnsinchClient(fixtureTransport(c, places, log));
  const store = new InMemoryStore();
  const metrics = new InMemoryMetrics();
  let clock = 1_800_000_000_000;

  const executor: Executor = {
    async createReplyDraft() { return "draft-sim"; },
    async createOrder(order) { return createOrderWithPlace(onsinch, order); },
    async patchOrder(p) {
      // Mirrors deps.ts: only top-level fields can go, and it reports what went.
      const applied: string[] = [];
      const patch: Record<string, unknown> = { id: p.order_id };
      if (p.desired.specification) { patch.specification = p.desired.specification; applied.push("specification"); }
      if (p.desired.intern_name) { patch.intern_name = p.desired.intern_name; applied.push("intern_name"); }
      if (applied.length) await onsinch.patchOrder([patch as { id: number }]);
      return applied;
    },
    async replaceOrder(p) {
      return replaceProvisionalOrder(
        onsinch,
        { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted, weCreatedIt: p.weCreatedIt },
        { onIntent: p.onIntent, onDeleted: p.onDeleted }
      );
    },
    async identifiersForOrder(order_id) { return { job_id: 60000 + (order_id % 1000), order_number: String(20000 + (order_id % 1000)) }; },
    async createInternalDraft() { return "internal-draft-sim"; },
  };

  const deps: PipelineDeps = {
    reasoner: scriptedReasoner(c, () => pass),
    onsinch,
    now: () => ++clock,
    store,
    metrics,
    executor,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    professions,
    defaultRateCard: DEFAULT_SETTINGS.default_rate_card,
    archiveOrder: async () => 1,
    recordReplacement: async () => {},
  };

  return { deps, store, metrics, log, setPass: (p) => { pass = p; } };
}

// ------------------------------------------------------------------ threads
export function msgOf(over: Partial<ThreadMessage>): ThreadMessage {
  return {
    message_id: "m1",
    from: "bookings@example.co.uk",
    to: ["bookings@spartancrew.co.uk"],
    date_iso: "2026-04-01T09:00:00Z",
    subject: "Crew request",
    body: "",
    is_from_spartan: false,
    ...over,
  };
}

export function threadFor(c: SimCase, kind: "new" | "amend"): HydratedThread {
  const cl = CLIENTS[c.client];
  const from = `bookings@${cl.domain}`;
  const first = msgOf({
    message_id: `${c.id}-m1`,
    from,
    subject: `Crew request — ${c.label}`,
    date_iso: "2026-04-01T09:00:00Z",
    body: bodyFor(c, c.blocks, "new"),
  });
  if (kind === "new") return { thread_id: c.id, messages: [first] };
  return {
    thread_id: c.id,
    messages: [
      first,
      msgOf({
        message_id: `${c.id}-m2`,
        from,
        subject: `Re: Crew request — ${c.label}`,
        date_iso: "2026-04-02T09:00:00Z",
        body: bodyFor(c, c.amend!.blocks, "amend"),
      }),
    ],
  };
}

export { buildOrderBody };
