// ============================================================================
// compiler — the foundational piece. compile(thread, prior) -> {state, actions}
//
// The compiler READS (normalize, classify, extract, resolve ids via GET) and
// composes desired state. It NEVER writes to OnSinch/Gmail — it returns the
// Actions for the executor to perform. This keeps compile idempotent and
// safe to re-run on any thread at any time (the "never miss a lead" property:
// a nightly full-thread sweep can re-compile everything harmlessly).
// ============================================================================
import { createHash } from "node:crypto";
import type {
  Actions,
  ConversationFacts,
  ConversationState,
  DesiredOrder,
  HydratedThread,
} from "./types";
import { normalizeThread } from "./normalize";
import { mergeFacts, describeMerge } from "./mergeFacts";
import { reconcileRequests } from "./parseWork";
import { triage, decisionBinds, triageModeFromEnv, type TriageMode } from "./triage";
import { composeOrder } from "./compose";
import { validateOrder } from "./format";
import { matchCompany, matchContact, matchPlace, matchExistingOrder, normName, normAddr } from "./resolve";
import { resolveRateCard } from "./rates";
import type { Reasoner } from "./reason";
import type { OnsinchClient } from "./onsinch";

export interface CompileDeps {
  reasoner: Reasoner;
  onsinch: OnsinchClient;
  now: () => number; // injectable clock for deterministic tests
  // Tool 1 toggle. undefined => enabled (tests); false => no reply is drafted.
  repliesEnabled?: boolean;
  // Seeded rate-card lookup (Phase B rate_cards). Injected so the engine stays
  // DB-agnostic; when absent, rates.ts falls back to a live history scan.
  seededRateCard?: (companyId: number) => Promise<number | null>;
  /**
   * What the sender ledger makes of an address, for triage. Injected for the same reason
   * as the others: the engine must compile with no database, and every test here runs
   * without one. Absent, triage simply skips its ledger tier.
   */
  senderVerdict?: (from: string) => Promise<"trusted" | "parked" | "unknown">;
  /**
   * Whether triage may actually stop the model, or is only being scored. Defaults to
   * shadow (see triage.ts) so an unproven filter cannot quietly decide which client
   * emails go unread.
   */
  triageMode?: TriageMode;
  /**
   * Names this system has already resolved once, so it stops solving the same ones from
   * scratch. Injected rather than imported for the same reason as seededRateCard: the
   * engine must compile offline, and every test here runs without a database.
   *
   * `lookup` answers only for aliases safe to trust automatically (human-confirmed, or a
   * cached exact match). `record` is fire-and-forget — a resolution that already worked
   * must not fail because remembering it did.
   */
  aliases?: {
    lookup: (kind: "company" | "place", aliasNorm: string) => Promise<number | null>;
    record: (a: { kind: "company" | "place"; alias_norm: string; entity_id: number; source: "exact" | "fuzzy"; raw_example?: string }) => Promise<void>;
  };
}

/**
 * The alias store is a convenience, never a dependency. If it is unreachable the answer
 * is still derivable from the whole-list pull, so a broken memory must degrade to the
 * slow path rather than fail an enquiry — losing a booking to a cache outage would be
 * an absurd trade.
 */
async function aliasLookup(
  aliases: CompileDeps["aliases"],
  kind: "company" | "place",
  key: string
): Promise<number | null> {
  if (!aliases || !key) return null;
  try { return await aliases.lookup(kind, key); }
  catch (err) { console.error("[aliases] lookup failed", kind, key, err); return null; }
}

async function aliasRecord(
  aliases: CompileDeps["aliases"],
  a: { kind: "company" | "place"; alias_norm: string; entity_id: number; source: "exact" | "fuzzy"; raw_example?: string }
): Promise<void> {
  if (!aliases || !a.alias_norm) return;
  try { await aliases.record(a); }
  catch (err) { console.error("[aliases] record failed", a.kind, a.alias_norm, err); }
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** OnSinch caps the Job name; keep it under this. */
const JOB_NAME_MAX = 100;

/**
 * "<size> at <venue> on <date>", capped at JOB_NAME_MAX.
 *
 * The cap is applied to the VENUE, not to the finished string. Truncating the
 * whole thing lopped the date off the end whenever the address was long: live
 * order 13632's name read "...London E16 2HB on 2026", cut four characters into
 * the year, because that address is 87 chars and the full name is 106.
 *
 * The date is the load-bearing token here - it is what a human scans a crew job
 * name for, and what the order->thread linkage matches on. The venue tail is the
 * only part that can afford to be lost.
 */
export function jobNameFrom(facts: ConversationFacts): string {
  const r = facts.requests[0];
  const size = r?.size ?? "?";
  const date = r?.date ?? "TBC";
  const loc = facts.location_text ?? "TBC";

  const head = `${size} at `;
  const tail = ` on ${date}`;
  const room = JOB_NAME_MAX - head.length - tail.length;
  // Nothing sane left for a venue: keep the ends, which still identify the job.
  if (room <= 0) return `${head}${tail}`.slice(0, JOB_NAME_MAX);
  const venue = loc.length > room ? loc.slice(0, room).trimEnd() : loc;
  return `${head}${venue}${tail}`;
}

/** Earliest requested date (YYYY-MM-DD) — the order-dedup key. */
function firstDate(facts: ConversationFacts): string | undefined {
  return facts.requests
    .map((r) => r.date)
    .filter((d): d is string => !!d)
    .sort()[0];
}

// Tool 2 resolution — OnSinch search is limited/non-fuzzy, so we pull the WHOLE
// list and match EXACTLY client-side (dedup: never create a duplicate).

/** company: reuse prior; else exact-match all companies; else it's new (needs adding). */
async function resolveCompany(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient,
  aliases?: CompileDeps["aliases"]
): Promise<{ id?: number; note?: string }> {
  if (prior?.company_id) return { id: prior.company_id };
  if (!facts.company_name) return { note: "no company name extracted" };

  // A name seen before, already settled. Checked before the whole-list pull because it
  // is the answer to the same question, arrived at once instead of every time.
  const key = normName(facts.company_name);
  const remembered = await aliasLookup(aliases, "company", key);
  if (remembered) return { id: remembered, note: `company from a name resolved before ("${facts.company_name}")` };

  const companies = await onsinch.allCompanies();
  const id = matchCompany(facts.company_name, companies);
  if (id) {
    // How it was matched decides whether it may be trusted next time. An exact hit is a
    // deterministic answer worth caching; anything the bounded token fallback found is a
    // judgement, and is only ever recorded for a human to confirm.
    const wasExact = companies.some(
      (c) => c.id === id && (normName(c.name) === key || normName(c.invoice_name) === key)
    );
    await aliasRecord(aliases, { kind: "company", alias_norm: key, entity_id: id,
                                 source: wasExact ? "exact" : "fuzzy", raw_example: facts.company_name });
    return { id };
  }
  return { note: `new company "${facts.company_name}" — add it in OnSinch (a contact is needed too)` };
}

/** contact: reuse prior; else exact-match the sender against the company's
 * Client list; else fall back to an existing company contact; else needs-human.
 * (The API cannot create contacts — a genuinely-new person must be added in OnSinch.) */
async function resolveContact(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  company_id: number | undefined,
  onsinch: OnsinchClient
): Promise<{ id?: number; note?: string }> {
  if (prior?.user_id) return { id: prior.user_id };
  if (!company_id) return { note: "no company resolved — contact pending" };
  const clients = await onsinch.companyClients(company_id);
  const exact = matchContact(facts.contact_email, clients);
  if (exact) return { id: exact };
  if (clients[0]?.id)
    return { id: clients[0].id, note: `unknown sender ${facts.contact_email ?? "?"} — used the company's existing contact` };
  return { note: `new contact ${facts.contact_email ?? "?"} and the company has no contact on file — add one in OnSinch` };
}

/** place: reuse prior; else exact-match all places; else provision a new one on write. */
async function resolvePlace(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient,
  aliases?: CompileDeps["aliases"]
): Promise<{ id?: number; provision?: DesiredOrder["provision_place"]; note?: string }> {
  if (prior?.place_id) return { id: prior.place_id };
  if (!facts.location_text) return { note: "no location extracted" };

  const key = normAddr(facts.location_text);
  const remembered = await aliasLookup(aliases, "place", key);
  if (remembered) return { id: remembered, note: `venue from a name resolved before ("${facts.location_text}")` };

  const places = await onsinch.allPlaces();
  const id = matchPlace(facts.location_text, places);
  if (id) {
    // matchPlace resolves on several rules, only one of which is equality; the others
    // are containment, which is a judgement. Only equality is cached as trusted.
    const wasExact = places.some(
      (p) => p.id === id && (normAddr(p.name) === key || normAddr(p.address) === key)
    );
    await aliasRecord(aliases, { kind: "place", alias_norm: key, entity_id: id,
                                 source: wasExact ? "exact" : "fuzzy", raw_example: facts.location_text });
    return { id };
  }
  return {
    provision: { name: facts.location_text.slice(0, 120), country: "GB", address: facts.location_text },
    note: `new venue "${facts.location_text}" — will be created in OnSinch on confirm`,
  };
}

export async function compile(
  thread: HydratedThread,
  prior: ConversationState | undefined,
  deps: CompileDeps
): Promise<{ state: ConversationState; actions: Actions }> {
  const { reasoner, onsinch, now } = deps;
  const { latest, history, machine } = normalizeThread(thread);
  const notes: string[] = [];

  // 0a. Triage, before any model call. The mailbox now delivers everything rather than
  // what a Gmail label selected, so the filtering that used to happen upstream happens
  // here — and every message this rejects is one nobody paid $0.019 to read. The tiers
  // and the reasoning behind their order are in triage.ts; what matters here is that a
  // skip is RECORDED with its reason rather than silently dropped, so a wrong rule is
  // visible on the board instead of being an email that never existed.
  //
  // A thread already carrying an order is exempt: once we are on the hook for a booking,
  // every later message in it must be read, whatever a cheap rule thinks of the sender.
  if (!prior?.onsinch_order_id) {
    const t = await triage(
      { from: latest.from, subject: latest.subject, body: latest.body, is_from_spartan: latest.is_from_spartan, headers: latest.headers },
      { senderVerdict: deps.senderVerdict }
    );
    const mode = deps.triageMode ?? triageModeFromEnv();
    // In shadow mode a judgement skip is written down and then ignored, so the filter is
    // scored against what the model actually concluded instead of being trusted on
    // arithmetic about itself. The structural tiers still bind — see decisionBinds.
    if (t.verdict === "skip" && !decisionBinds(t, mode)) {
      notes.push(`triage WOULD have skipped this [${t.tier}]: ${t.reason} — shadow mode, read anyway`);
    }
    if (decisionBinds(t, mode)) {
      return {
        state: {
          ...(prior ?? {}),
          thread_id: thread.thread_id,
          subject: latest.subject,
          participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
          last_message_id: latest.message_id,
          last_processed_epoch: now(),
          classification: "not-a-job",
          facts: prior?.facts ?? { requests: [] },
          desired_order: null,
          pending_order: prior?.pending_order,
          priority: "low",
          needs_human: false,
          status: "ignored",
          notes: [`filtered before the model [${t.tier}]: ${t.reason}` + (t.reviewable ? " — reviewable" : "")],
          order_action_log: prior?.order_action_log ?? [],
        },
        actions: { none: true },
      };
    }
  }

  // 0. machine mail — nothing here was written by a client, so there is nothing
  // to reply to and nothing to book. Decided before the model runs: OnSinch's
  // own order notifications read as perfect enquiries, and acting on one means
  // patching a real order with invented hours and a guessed rate card. Prior
  // linkage (company/order ids) is carried through untouched.
  if (machine) {
    return {
      state: {
        ...(prior ?? {}),
        thread_id: thread.thread_id,
        subject: latest.subject,
        participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
        last_message_id: latest.message_id,
        last_processed_epoch: now(),
        classification: "not-a-job",
        facts: prior?.facts ?? { requests: [] },
        desired_order: null,
        pending_order: prior?.pending_order,
        priority: "low",
        needs_human: false,
        status: "ignored",
        notes: [`machine mail from ${latest.from} — not a client enquiry`],
        order_action_log: prior?.order_action_log ?? [],
      },
      actions: { none: true },
    };
  }

  // 1. classify, and take the facts from the same call when the reasoner can do both.
  // The two questions were asked of identical thread text, so asking them separately
  // sent the whole thread twice — 402M characters to label the corpus once. A reasoner
  // without the combined method (a mock, a different provider) still works.
  //
  // And when the thread has already been read, the earlier messages are not sent at
  // all — the facts they produced are sent instead. A thread is re-processed on every
  // new client message, so re-sending the history each time read the corpus 6.26 times
  // over. mergeFacts below is what makes this safe: the model can answer narrowly
  // without deleting what four earlier emails established.
  const priorFacts = prior?.facts;
  const incremental =
    reasoner.classifyAndExtractIncremental &&
    priorFacts &&
    (Object.keys(priorFacts).length > 1 || (priorFacts.requests ?? []).length > 0) &&
    history.length > 0;

  const combined = incremental
    ? await reasoner.classifyAndExtractIncremental!(latest, priorFacts!, prior?.classification, !!prior?.onsinch_order_id)
    : reasoner.classifyAndExtract
      ? await reasoner.classifyAndExtract(latest, history, !!prior?.onsinch_order_id)
      : null;
  if (incremental) notes.push("read this message against stored facts — earlier messages not re-read");
  const cls = combined ?? (await reasoner.classify(latest, history, !!prior?.onsinch_order_id));

  // Keep the classifier's own explanation for a rejection. job_summary is the
  // reason ("N/A - Acknowledgment/confirmation only, no changes requested"); it
  // was used as the order specification for real jobs and discarded for
  // everything else, so the board's Dismissed lane had nothing to show — 18 of
  // the first 25 dismissals recorded no reason at all. The "N/A -" prefix is a
  // machine artefact of the prompt's output format, not something to show a human.
  // THE CLASSIFIER DEFERS TO THE EXTRACTOR.
  // The classifier judges only the latest email — the live prompt says so outright
  // ("Never classify Thread History messages. Only classify Current Email") — so a
  // thread whose newest message is Spartan's own reply, a bounce or an emoji reaction
  // is called junk while the client's actual request sits one message earlier. Over a
  // 150-thread random sample of the year, 91 threads were labelled not-a-job, 28 of
  // them carried a crew number and a date, and 21 of the 41 with a dated block became
  // real OnSinch orders anyway. Fifteen were read by hand: 13 were genuine jobs.
  //
  // So where the extractor finds a dated request WITH a crew size, it wins. A missed
  // job costs a booking; a spurious one costs someone ten seconds deleting a draft.
  // Costs one extra extraction call on threads the classifier rejected.
  let classification = cls.classification;
  let overruled = false;
  // The combined call already returned facts, so overruling a rejection now costs
  // nothing; only the two-call fallback has to pay for a second request.
  // Merged against what the thread already knew, ALWAYS — not only on the incremental
  // path. A model shown the whole thread can still answer thinly, and an overwrite would
  // drop a venue established in March because August's message did not repeat it.
  let mergeNote = "";
  let probed: ConversationFacts | null = null;
  if (combined) {
    const m = mergeFacts(prior?.facts, combined.facts);
    probed = m.facts;
    mergeNote = describeMerge(m.report);
    if (m.report.kept.length) {
      notes.push(`kept from earlier messages: ${m.report.kept.join(", ")}`);
    }
    if (mergeNote) notes.push(mergeNote);
  }
  if (classification === "not-a-job") {
    probed = probed ?? (await reasoner.extractFacts(latest, history));
    const usable = (probed.requests ?? []).some(
      (r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? "")) && Number(r.size) > 0
    );
    if (usable) {
      classification = prior?.onsinch_order_id ? "update" : "new-job";
      overruled = true;
      notes.push("classified as not-a-job, but the thread carries a dated request with a crew size — deferring to the extractor");
    } else {
      const why = (cls.job_summary ?? "").replace(/^\s*N\/A\s*[-–—:]\s*/i, "").trim();
      if (why) notes.push(why);
    }
  }

  // 2. compose the reply — Tool 1, gated by the replies_enabled setting.
  // Off by default: classification + order work still run, but no reply is drafted.
  const repliesEnabled = deps.repliesEnabled !== false;
  const reply = repliesEnabled
    ? await reasoner.composeReply(latest, history, classification)
    : null;
  const replyHash = reply ? hash(reply.html) : undefined;

  // 3. only a real job triggers the order path
  const isJob = classification === "new-job" || classification === "update";
  let facts: ConversationFacts = prior?.facts ?? { requests: [] };
  let desired = null as ConversationState["desired_order"];
  let needs_human = false;
  let company_id = prior?.company_id;
  let user_id = prior?.user_id;
  let place_id = prior?.place_id;
  let linkedOrderId = prior?.onsinch_order_id;
  let provisionPlace: DesiredOrder["provision_place"];

  if (isJob) {
    // The probe above already extracted this thread's facts when the classifier was
    // overruled; extracting again would be a second identical model call.
    facts = probed ?? mergeFacts(prior?.facts, await reasoner.extractFacts(latest, history)).facts;

    // Check the model's reading against the words on the page. The 18:00 finish that
    // reached 4 of 10 real orders was a prompt instruction the model quietly stopped
    // following, and nothing noticed because a defaulted order looks exactly like a
    // real one. The parser fills what the model left blank and REPORTS what it reads
    // differently — it never overrules, because it cannot see prose and the model can.
    //
    // The reference date is the message's own timestamp, not today: "12 Sept" in a
    // thread from last October means October's year.
    const rec = reconcileRequests(
      `${latest.subject}\n${latest.body}`,
      facts.requests ?? [],
      new Date(Date.parse(latest.date_iso) || Date.now())
    );
    facts = { ...facts, requests: rec.requests };
    if (rec.report.filled.length) notes.push(`read from the email text: ${rec.report.filled.join(", ")}`);
    for (const c of rec.report.conflicts) notes.push(`DISAGREEMENT — ${c}`);

    // company first (contact resolution needs it)
    const co = await resolveCompany(facts, prior, onsinch, deps.aliases);
    company_id = co.id ?? company_id;
    if (co.note) notes.push(co.note);

    const [pl, us] = await Promise.all([
      resolvePlace(facts, prior, onsinch, deps.aliases),
      resolveContact(facts, prior, company_id, onsinch),
    ]);
    place_id = pl.id ?? place_id;
    provisionPlace = pl.provision;
    user_id = us.id ?? user_id;
    if (pl.note) notes.push(pl.note);
    if (us.note) notes.push(us.note);

    // Order dedup vs OnSinch — never create a second job for an existing one.
    if (company_id && !linkedOrderId) {
      const existing = matchExistingOrder(firstDate(facts), await onsinch.companyOrdersWithJob(company_id));
      if (existing) {
        linkedOrderId = existing.order_id;
        notes.push(`matched existing OnSinch order #${existing.order_id} (same date) — will update, not create`);
      }
    }

    // Rate card (I1) — resolved before compose; no confident card => needs-human.
    let pricelist_category_id = 0;
    if (company_id) {
      const rate = await resolveRateCard(company_id, { onsinch, seededRateCard: deps.seededRateCard });
      if (rate.card) pricelist_category_id = rate.card;
      else notes.push(`no confident rate card for company ${company_id} — needs a human (I1)`);
    }

    const havePlace = !!place_id || !!provisionPlace;
    if (company_id && user_id && havePlace && pricelist_category_id) {
      const composed = composeOrder({
        facts,
        company_id,
        user_id,
        place_id: place_id ?? 0, // 0 => created on write from provisionPlace
        pricelist_category_id,
        orderName: (latest.subject || facts.requests[0]?.task || "Spartan Crew job").slice(0, 80),
        jobName: jobNameFrom(facts),
        // The classifier's job_summary is its REASON, and on an overruled thread that
        // reason is a rejection ("N/A - acknowledgement only, no crew request"). Writing
        // that into the order specification would put a denial on the face of the job it
        // just created, so an overruled thread describes itself by its work instead.
        specification: overruled
          ? facts.requests.map((r) => r.task).filter(Boolean).join("; ").slice(0, 200) || "Crew request read from the thread"
          : cls.job_summary,
        intern_name: facts.customer_reference,
      });
      composed.warnings.forEach((w) => notes.push(w));
      desired = composed.order;
      if (desired && provisionPlace) desired.provision_place = provisionPlace;
      if (desired) {
        const errs = validateOrder(desired);
        if (errs.length) {
          needs_human = true;
          notes.push(...errs);
        }
      }
    } else {
      needs_human = true; // unknown company / no contact -> a human resolves it
    }
  }

  // 4. decide actions (reads already happened; writes are returned only)
  const actions: Actions = {};
  if (reply && (!prior || prior.last_reply_hash !== replyHash)) {
    actions.createReplyDraft = {
      subject: reply.subject,
      html: reply.html,
      in_reply_to: latest.message_id,
    };
  }
  const desiredHash = desired ? hash(JSON.stringify(desired)) : undefined;
  if (desired && !needs_human) {
    if (linkedOrderId) {
      // an existing order (ours or matched in OnSinch) — patch only if it changed
      if (desiredHash !== prior?.last_ordered_hash) {
        actions.patchOrder = { order_id: linkedOrderId, desired };
      }
    } else {
      actions.createOrder = desired;
    }
  }
  if (!actions.createReplyDraft && !actions.createOrder && !actions.patchOrder) {
    actions.none = true;
  }

  // needs-info, NOT error: nothing failed here, we simply cannot finish without
  // a human. "error" is reserved for an actual failure (see pipeline.ts).
  const status: ConversationState["status"] = needs_human
    ? "needs-info"
    : desired
    ? "ordered"
    : classification === "not-a-job"
    ? "ignored"
    : "drafted";

  const state: ConversationState = {
    thread_id: thread.thread_id,
    subject: latest.subject,
    participants: [...new Set([latest.from, ...history.map((m) => m.from)])],
    last_message_id: latest.message_id,
    last_processed_epoch: now(),
    classification,
    facts,
    company_id,
    user_id,
    place_id,
    onsinch_order_id: linkedOrderId,
    onsinch_order_number: prior?.onsinch_order_number,
    desired_order: desired,
    last_ordered_hash: prior?.last_ordered_hash,
    priority: cls.priority,
    reply_body_html: reply?.html ?? prior?.reply_body_html,
    reply_subject: reply?.subject ?? prior?.reply_subject,
    reply_draft_id: prior?.reply_draft_id,
    last_reply_hash: replyHash ?? prior?.last_reply_hash,
    needs_human,
    status,
    notes,
    order_action_log: prior?.order_action_log ?? [],
  };

  return { state, actions };
}
