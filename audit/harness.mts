// ============================================================================
// THE AUDIT HARNESS — production wiring, a fake tenant underneath, a scripted
// model above, and a recorder around everything that leaves the process.
// ----------------------------------------------------------------------------
// WHAT IS REAL HERE. `handleThread`, `compile`, every resolver, `composeOrder`,
// `validateOrder`, `assessAmendment`, `amendOrderInPlace`, `replaceProvisionalOrder`,
// `createOrderWithPlace`, `reconcileThread` and deps.ts's own `executor()` all run
// unmodified. Only two things are replaced, and each is replaced at the seam the
// system already has:
//
//   the network   -> audit/tenant.mts, at `Transport`
//   the model     -> scriptedReasoner below, at `Reasoner`
//
// WHAT THE SCRIPTED MODEL MAY AND MAY NOT SEE. It reads the email text and NOTHING
// else. It is never handed the scenario, the expected state, or the tenant. That
// matters because every accuracy figure this repo has ever had to withdraw was the
// test handing the engine its own answer (see study/harness.ts). `audit/selftest.mts`
// asserts the separation mechanically rather than trusting this paragraph.
//
// WHAT IS THEREFORE *NOT* MEASURED HERE, stated up front so no number is read as
// more than it is: the language model's own accuracy. Classification and extraction
// against real client prose are measured on the bought corpus runs in data/study,
// never here. What is measured here is everything the engine does with an answer
// once it has one — which is where state, idempotency, sequencing, duplication and
// recovery live, and none of that needs a model call to exercise.
// ============================================================================
import { handleThread, type PipelineDeps, type ThreadTag } from "../app/lib/engine/pipeline";
import { reconcileThread } from "../app/lib/engine/sweep";
import { executor as productionExecutor } from "../app/lib/deps";
import { OnsinchClient, __resetListCache } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { parseCrew, parseDates, parseTimes } from "../app/lib/engine/parseWork";
import type { Reasoner, ClassifyResult, ReplyResult, ReplyContext } from "../app/lib/engine/reason";
import type {
  ConversationFacts,
  ConversationState,
  DesiredSlotTeam,
  HydratedThread,
  Settings,
  ThreadMessage,
} from "../app/lib/engine/types";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import { createHash } from "node:crypto";
import type { FakeTenant } from "./tenant.mts";

// ---------------------------------------------------------------------------
// THE SCRIPTED MODEL
// ---------------------------------------------------------------------------

/**
 * THE SEGMENT, NOT THE LINE — and this is a fact about the engine, not a convenience.
 *
 * `cleanEmailBody` ends in `stripHtml`, whose last step is `.replace(/\s+/g, " ")`. Every
 * newline in every email is gone by the time anything downstream sees it, so a grammar
 * anchored on `^`/`$` matches once, at the start of the whole message. The first draft of
 * this file was line-anchored and silently read no venue and no company out of a body
 * that plainly stated both.
 *
 * So a scenario body is written as segments joined by " | ", which survives the collapse.
 *
 *   "BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build"
 */
const SEGMENTS = (body: string) => body.split("|").map((s) => s.trim()).filter(Boolean);
const BLOCK_SEG = /^BLOCK:\s*(.+)$/i;

function parseBlockLine(line: string): ConversationFacts["requests"][number] | null {
  const date = parseDates(line, new Date("2026-09-29T00:00:00Z"))[0];
  const crew = parseCrew(line)[0];
  if (!date && !crew) return null;
  const times = parseTimes(line);
  const at = /\bat\s+(.+?)\s*$/i.exec(line);
  const task = line
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\d{1,2}[:.]\d{2}\s*-\s*\d{1,2}[:.]\d{2}/g, "")
    .replace(/\b\d+\s*(crew|staff|chiefs?|carpenters?|drivers?)\b/gi, "")
    .replace(/\bat\s+.+$/i, "")
    .replace(/[,\s]+/g, " ")
    .trim();
  return {
    ...(date ? { date } : {}),
    ...(crew ? { size: crew.size, ...(crew.hint ? { profession_hint: crew.hint } : {}) } : {}),
    ...(times?.start ? { start_time: times.start } : {}),
    ...(times?.end ? { end_time: times.end } : {}),
    ...(task ? { task } : {}),
    ...(at ? { location_text: at[1].trim() } : {}),
  };
}

const CANCEL = /\b(cancel|cancelled|cancelling|call(?:ing)? (?:it|the job) off|stand (?:us |them )?down|no longer need)\b/i;
const ASK = /\b(\d+\s*(?:crew|staff|carpenters?|drivers?)|need (?:a )?crew|book(?:ing)?|can you (?:cover|crew|quote|confirm))\b/i;
const ACK = /\b(thanks|thank you|received|noted|confirmed|great|perfect)\b/i;

/** "Company: X" as its own segment — the fields a parser cannot honestly read from prose. */
const SAID = (body: string, key: string): string | undefined => {
  for (const seg of SEGMENTS(body)) {
    const m = new RegExp(`^${key}\\s*:\\s*(.+)$`, "i").exec(seg);
    if (m) return m[1].trim();
  }
  return undefined;
};

function readFacts(latest: ThreadMessage, history: ThreadMessage[]): ConversationFacts {
  const all = [...history, latest];
  const requests: ConversationFacts["requests"] = [];
  for (const seg of SEGMENTS(latest.body)) {
    const m = BLOCK_SEG.exec(seg);
    if (!m) continue;
    const b = parseBlockLine(m[1]);
    if (b) requests.push(b);
  }
  // Newest statement of each field wins; older messages still answer where the newest
  // is silent, which is what mergeFacts then re-checks against the stored row.
  const pick = (key: string): string | undefined => {
    for (const m of [...all].reverse()) {
      const v = SAID(m.body, key);
      if (v) return v;
    }
    return undefined;
  };
  return {
    ...(pick("Company") ? { company_name: pick("Company") } : {}),
    ...(pick("Contact") ? { contact_name: pick("Contact") } : {}),
    contact_email: latest.from,
    ...(pick("PO") ? { customer_reference: pick("PO") } : {}),
    ...(pick("Venue") ? { location_text: pick("Venue") } : {}),
    requests,
  };
}

function classifyText(latest: ThreadMessage, priorOrderExists: boolean): ClassifyResult {
  const b = latest.body;
  const cancelling = CANCEL.test(b);
  const asks = ASK.test(b) || SEGMENTS(b).some((s) => BLOCK_SEG.test(s));
  const classification: ClassifyResult["classification"] = cancelling
    ? priorOrderExists
      ? "update"
      : "not-a-job"
    : asks
      ? priorOrderExists
        ? "update"
        : "new-job"
      : ACK.test(b)
        ? "confirmation-only"
        : "not-a-job";
  return {
    classification,
    priority: classification === "new-job" ? "high" : classification === "update" ? "medium" : "low",
    job_summary:
      classification === "not-a-job"
        ? "N/A - nothing was requested"
        : `${classification} read from the thread`,
    ...(cancelling ? { cancellation: true } : {}),
    order_title: SAID(b, "Title"),
  };
}

export interface ScriptedReasonerSpy {
  classifyCalls: number;
  extractCalls: number;
  replyCalls: number;
  lastReplyContext: ReplyContext | null;
}

export function scriptedReasoner(opts: { stripCancellation?: boolean; echoIds?: RigOptions["echoIds"] } = {}): {
  reasoner: Reasoner;
  spy: ScriptedReasonerSpy;
} {
  const spy: ScriptedReasonerSpy = { classifyCalls: 0, extractCalls: 0, replyCalls: 0, lastReplyContext: null };
  /** The production adapter's field-picking, reproduced rather than described. */
  const asAdapterWouldReturn = (r: ClassifyResult): ClassifyResult => {
    if (!opts.stripCancellation) return r;
    const { cancellation, ...rest } = r;
    return rest as ClassifyResult;
  };
  const withEchoedIds = (f: ConversationFacts): ConversationFacts =>
    opts.echoIds
      ? { ...f, requests: (f.requests ?? []).map((q) => ({ ...q, ...opts.echoIds })) }
      : f;
  const reasoner: Reasoner = {
    async classifyAndExtract(latest, history, priorOrderExists) {
      spy.classifyCalls++;
      return { ...asAdapterWouldReturn(classifyText(latest, priorOrderExists)), facts: withEchoedIds(readFacts(latest, history)) };
    },
    async classifyAndExtractIncremental(latest, _priorFacts, _priorCls, priorOrderExists, history) {
      spy.classifyCalls++;
      return { ...asAdapterWouldReturn(classifyText(latest, priorOrderExists)), facts: withEchoedIds(readFacts(latest, history ?? [])) };
    },
    async classify(latest, _history, priorOrderExists) {
      spy.classifyCalls++;
      return classifyText(latest, priorOrderExists);
    },
    async extractFacts(latest, history) {
      spy.extractCalls++;
      return withEchoedIds(readFacts(latest, history));
    },
    async composeReply(_latest, _history, classification, context) {
      spy.replyCalls++;
      spy.lastReplyContext = context ?? null;
      return {
        subject: "Re: Crew request",
        html: `<div><p>Noted (${classification}, ${context?.order_state ?? "n/a"}).</p></div>`,
        priority: "high",
      } as ReplyResult;
    },
  };
  return { reasoner, spy };
}

// ---------------------------------------------------------------------------
// THE RECORDER
// ---------------------------------------------------------------------------

export interface Spies {
  metrics: Array<{ type: string; meta?: Record<string, unknown> }>;
  replyDrafts: Array<{ subject: string; in_reply_to: string }>;
  internalDrafts: Array<{ subject: string }>;
  tags: Array<{ label: string; state: string; thread_id: string; reason?: string }>;
  archived: Array<{ order_id: number; thread_id: string }>;
  replacements: Array<{ archive_id: number; order_id: number }>;
  /** The durable thread->order table. `ensureOrderRecord` must never move a thread_id. */
  orderRecords: Map<number, { thread_id: string; order_number: string | null; id_source: string }>;
  senders: Array<{ addr: string; wasJob: boolean }>;
  /** Anything the harness itself judged forbidden — see `forbid`. */
  violations: string[];
}

export interface AuditRig {
  deps: PipelineDeps;
  store: InMemoryStore;
  spies: Spies;
  reasonerSpy: ScriptedReasonerSpy;
  clock: { t: number };
  /** Aliases survive within a run, as the Neon-backed store does in production. */
  aliases: Map<string, number>;
}

export interface RigOptions {
  settings?: Partial<Settings>;
  /** ms; every event advances it. Fixed so nothing in the suite rots on a date. */
  startedAt?: number;
  /** Omit `replaceOrder` from the executor — the SPARTAN_BLOCK_ORDER_REPLACE posture. */
  blockReplace?: boolean;
  /** Drop `amendOrderInPlace`, to measure what the rebuild path does alone. */
  blockAmend?: boolean;
  defaultRateCard?: number | null;
  seededRateCard?: (companyId: number) => Promise<number | null>;
  /**
   * DROP `cancellation` ON THE COMBINED PATH, as the production OpenRouter adapter did
   * until 2026-09-29.
   *
   * `reason.ts`'s `classifyAndExtract` and `classifyAndExtractIncremental` hand-picked
   * the fields they returned and `cancellation` was not among them, so the flag reached
   * `compile()` only through the two-call fallback that production never takes. The
   * evidence is in the tree: 0 of 749 stored conversation states carry
   * `cancellation: true` [peer-measured, thera-main session].
   *
   * This exists because the audit's scripted model returned the flag faithfully and
   * therefore scored a hold that production could not perform — a false PASS of exactly
   * the kind `selftest.mts` exists to catch, and one it could not catch, because the
   * divergence was between the real adapter and the stub rather than inside the harness.
   * Turning it on reproduces the audited version's real behaviour.
   */
  stripCancellation?: boolean;
  /**
   * Let the model echo a `place_id` / `profession_id` per request block, as the live
   * model demonstrably does (80 and 21 occurrences in stored facts [peer-measured]).
   * Nothing validated model output against the schema at the audited version, so an id
   * the model invented survives `compile()` wherever the code has no per-block value of
   * its own.
   */
  echoIds?: { place_id?: number; profession_id?: number };
}

export const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

export function buildRig(tenant: FakeTenant, opts: RigOptions = {}): AuditRig {
  __resetListCache(); // module-global, 5-minute TTL: one scenario would otherwise see the last one's tenant
  const client = new OnsinchClient(tenant.transport);
  const base = productionExecutor(client);
  const store = new InMemoryStore();
  const clock = { t: opts.startedAt ?? Date.parse("2026-10-05T09:00:00Z") };
  const aliases = new Map<string, number>();
  const spies: Spies = {
    metrics: [],
    replyDrafts: [],
    internalDrafts: [],
    tags: [],
    archived: [],
    replacements: [],
    orderRecords: new Map(),
    senders: [],
    violations: [],
  };
  const { reasoner, spy: reasonerSpy } = scriptedReasoner({ stripCancellation: opts.stripCancellation, echoIds: opts.echoIds });

  const tag = (a: ThreadTag | { label: string; thread_id: string; state: string; reason: string }) => {
    spies.tags.push({ label: a.label, state: String(a.state), thread_id: a.thread_id, reason: a.reason });
  };

  const deps: PipelineDeps = {
    reasoner,
    onsinch: client,
    now: () => clock.t,
    repliesEnabled: (opts.settings?.replies_enabled ?? DEFAULT_SETTINGS.replies_enabled) !== false,
    replyScope: opts.settings?.reply_scope ?? DEFAULT_SETTINGS.reply_scope,
    defaultRateCard: opts.defaultRateCard === undefined ? DEFAULT_SETTINGS.default_rate_card : opts.defaultRateCard,
    ...(opts.seededRateCard ? { seededRateCard: opts.seededRateCard } : {}),
    aliases: {
      async lookup(kind, key) {
        return aliases.get(`${kind}:${key}`) ?? null;
      },
      async record(a) {
        // Only `exact` resolves automatically; a fuzzy row is a suggestion (compiler.ts).
        if (a.source === "exact") aliases.set(`${a.kind}:${a.alias_norm}`, a.entity_id);
      },
    },
    store,
    metrics: { emit: async (e: any) => void spies.metrics.push({ type: e.type, meta: e.meta }) },
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    hashOrder,
    executor: {
      ...base,
      async createReplyDraft(a) {
        spies.replyDrafts.push({ subject: a.subject, in_reply_to: a.in_reply_to });
        return `draft-${spies.replyDrafts.length}`;
      },
      async createInternalDraft(d) {
        spies.internalDrafts.push({ subject: d.subject });
        return `internal-${spies.internalDrafts.length}`;
      },
      ...(opts.blockReplace ? { replaceOrder: undefined } : {}),
      ...(opts.blockAmend ? { amendOrderInPlace: undefined } : {}),
    },
    recordSender: async (a) => void spies.senders.push({ addr: a.addr, wasJob: a.wasJob }),
    ensureOrderRecord: async (rec) => {
      // MUST NOT overwrite. The contract is in PipelineDeps; this is where it is checked.
      const held = spies.orderRecords.get(rec.order_id);
      if (held) {
        if (held.thread_id !== rec.thread_id) {
          spies.violations.push(
            `order_records: order #${rec.order_id} was recorded for thread ${held.thread_id} and ${rec.thread_id} tried to claim it`
          );
        }
        return false;
      }
      spies.orderRecords.set(rec.order_id, {
        thread_id: rec.thread_id,
        order_number: rec.order_number,
        id_source: rec.id_source,
      });
      return true;
    },
    flagForManual: async (a) => tag(a as any),
    flagOrderBuilt: async (a) => tag(a),
    flagOrderUpdated: async (a) => tag(a),
    archiveOrder: async (a) => {
      spies.archived.push({ order_id: a.order_id, thread_id: a.thread_id });
      return spies.archived.length;
    },
    recordReplacement: async (archive_id, by) => void spies.replacements.push({ archive_id, order_id: by.order_id }),
  };

  return { deps, store, spies, reasonerSpy, clock, aliases };
}

// ---------------------------------------------------------------------------
// DRIVING A CONVERSATION
// ---------------------------------------------------------------------------

export interface EmailSpec {
  from?: string;
  to?: string[];
  subject?: string;
  body: string;
  /** Minutes after the scenario's start. Lets a sequence be re-ordered on the wire. */
  at?: number;
  id?: string;
  fromSpartan?: boolean;
}

export function email(spec: EmailSpec, startedAt: number, n: number): ThreadMessage {
  return {
    message_id: spec.id ?? `m${n}`,
    from: spec.from ?? "ops@redbeast.co.uk",
    to: spec.to ?? ["bookings@spartancrew.co.uk"],
    date_iso: new Date(startedAt + (spec.at ?? n) * 60_000).toISOString(),
    subject: spec.subject ?? "Crew request",
    body: spec.body,
    is_from_spartan: spec.fromSpartan ?? false,
  };
}

/**
 * Deliver one email into a thread, exactly as an intake route does: the whole thread so
 * far is hydrated and handed to `handleThread`.
 *
 * `deliveryOrder` is what makes out-of-order testing possible. The MAILBOX may deliver a
 * later-dated message first; the thread still carries both, and the engine's own
 * `selectLatest` decides which one it acts on.
 */
export async function deliver(
  rig: AuditRig,
  thread_id: string,
  messages: ThreadMessage[]
): Promise<ConversationState> {
  const thread: HydratedThread = { thread_id, messages };
  const last = messages[messages.length - 1];
  rig.clock.t = Math.max(rig.clock.t, Date.parse(last.date_iso) + 60_000);
  return handleThread(thread, rig.deps);
}

/** One reconciliation sweep over a thread, as /api/reconcile runs it. */
export async function sweep(rig: AuditRig, thread_id: string, todayISO?: string) {
  const state = await rig.store.get(thread_id);
  if (!state) throw new Error(`sweep: no state for ${thread_id}`);
  const outcome = await reconcileThread(state, rig.deps, {
    todayISO: todayISO ?? new Date(rig.clock.t).toISOString(),
  });
  await rig.store.put(state);
  return { outcome, state };
}

export const crewOf = (teams: DesiredSlotTeam[] | undefined) => (teams ?? []).reduce((n, t) => n + (t.size || 0), 0);
