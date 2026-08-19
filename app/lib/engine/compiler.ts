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
import { matchCompany, matchCompanyByDomain, matchContact, matchPlace, matchExistingOrder, normName, normAddr } from "./resolve";
import { resolveProfession, normProf, type ProfessionRec } from "./professions";
import { PROFESSION_LIST } from "./professionList";
import { resolveRateCard } from "./rates";
import type { Reasoner, ReplyContext } from "./reason";
import type { OnsinchClient } from "./onsinch";

/** The third alias kind, added for professions — see aliasesDb.ts. */
type AliasKind = "company" | "place" | "profession";

export interface CompileDeps {
  reasoner: Reasoner;
  onsinch: OnsinchClient;
  now: () => number; // injectable clock for deterministic tests
  // Tool 1 toggle. undefined => enabled (tests); false => no reply is drafted.
  repliesEnabled?: boolean;
  /**
   * Which threads get one. "all" (the default) replies to everything read;
   * "enquiries" replies only where there is a crew request — a new job or a
   * change to one. See Settings.reply_scope.
   */
  replyScope?: "all" | "enquiries";
  /**
   * Rate card for a client with no pricing history. See Settings.default_rate_card.
   * Absent, a company without derivable pricing holds for a human as before.
   */
  defaultRateCard?: number | null;
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
  /**
   * The tenant's profession list. Injected for the same reason as the alias store: the
   * engine must compile with no database. See professionsDb.ts.
   */
  professions?: ProfessionRec[];
  aliases?: {
    lookup: (kind: AliasKind, aliasNorm: string) => Promise<number | null>;
    record: (a: { kind: AliasKind; alias_norm: string; entity_id: number; source: "exact" | "fuzzy"; raw_example?: string }) => Promise<void>;
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
  kind: AliasKind,
  key: string
): Promise<number | null> {
  if (!aliases || !key) return null;
  try { return await aliases.lookup(kind, key); }
  catch (err) { console.error("[aliases] lookup failed", kind, key, err); return null; }
}

async function aliasRecord(
  aliases: CompileDeps["aliases"],
  a: { kind: AliasKind; alias_norm: string; entity_id: number; source: "exact" | "fuzzy"; raw_example?: string }
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

/**
 * The stand-in contact for a client OnSinch has never met.
 *
 * OnSinch cannot create contacts — /users is GET-only and there is no /clients
 * endpoint — so a company we have just created has nobody to attach an order to,
 * and an order without a user_id cannot be posted at all. Ben, 2026-08-09:
 * "might need a user, use my own (Ben Mikus)".
 *
 * 2257 is that account, verified live: ben@samuraisolutions.co.uk, the same user
 * the API key belongs to. It is deliberately a real, identifiable person rather
 * than a fabricated placeholder — whoever opens the order can see at a glance that
 * the contact is a stand-in and who to ask, and the order carries a note saying so.
 */
const PLACEHOLDER_CONTACT_ID = 2257;

/**
 * The venue for a job whose venue nobody has said yet. Ben: "for venue, if it
 * doesnt exist in onsinch, then you should also use a placeholder location
 * ('No Location') which you will create."
 *
 * Created once, on the first enquiry that needs it, and found by name every time
 * after — it is an ordinary place and goes through the ordinary match. Verified
 * absent from the live tenant today, so the first use creates it.
 */
const PLACEHOLDER_PLACE_NAME = "No Location";

/**
 * company: reuse prior; else exact-match all companies; else CREATE it.
 *
 * Ben, 2026-08-09: "if company or venue location are not found in the system,
 * always create new ones if they can be inferred. This is why the checking
 * procedure was so important."
 *
 * That last sentence is the load-bearing one. Creating on a miss is only safe
 * because matchCompany looks hard before giving up — exact on name and invoice
 * name, then a bounded token-subset fallback, then a phrase tie-break — so a
 * "miss" means the client really is absent rather than spelled differently. Six of
 * the eight companies stuck on the live board were the second kind, and creating
 * them would have made six duplicates of clients Spartan already had.
 */
async function resolveCompany(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient,
  aliases?: CompileDeps["aliases"]
): Promise<{ id?: number; provision?: DesiredOrder["provision_company"]; note?: string }> {
  if (prior?.company_id) return { id: prior.company_id };

  /**
   * No company name in the text is not the same as no evidence about the client.
   * The sender's own domain identifies them on 96.5% of the 708 domains OnSinch
   * holds contacts for, and over the live board it answered for 17 threads where
   * the model extracted no name at all. Checked here because in this branch there
   * is nothing else to check.
   */
  if (!facts.company_name) {
    const byDomain = matchCompanyByDomain(facts.contact_email, await onsinch.allCompanies());
    if (byDomain) {
      return { id: byDomain, note: `company identified from the sender's domain (${facts.contact_email})` };
    }
    return { note: "no company name extracted" };
  }

  // A name seen before, already settled. Checked before the whole-list pull because it
  // is the answer to the same question, arrived at once instead of every time — and
  // the pull must stay BELOW this line: starting it eagerly would fetch 763 companies
  // on every thread the alias store could have answered for free.
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
  /**
   * The name did not resolve. Ask the sender's domain BEFORE creating a client:
   * a company name the model read out of prose can be wrong in ways an address
   * at that company's own domain cannot, and creating a duplicate of a client
   * Spartan already has is the exact failure the whole-list exact-match dedup
   * exists to prevent. Ordered after the name match, never before it, so a domain
   * shared by two trading entities can never override a name that was specific.
   */
  const byDomain = matchCompanyByDomain(facts.contact_email, companies);
  if (byDomain) {
    return {
      id: byDomain,
      note: `"${facts.company_name}" matched no client, but the sender's domain (${facts.contact_email}) belongs to company ${byDomain} — using that rather than creating a duplicate`,
    };
  }

  return {
    provision: { name: facts.company_name.slice(0, 120) },
    note: `new company "${facts.company_name}" — will be created in OnSinch on confirm`,
  };
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
  // A company being created has no contacts to look up yet, and the sender cannot be
  // added as one, so the stand-in is the only way the order exists at all.
  if (!company_id) {
    return {
      id: PLACEHOLDER_CONTACT_ID,
      note: `no contact on file for ${facts.contact_email ?? "this sender"} — order raised against Ben Mikus as a stand-in; add the real contact in OnSinch`,
    };
  }
  const clients = await onsinch.companyClients(company_id);
  const exact = matchContact(facts.contact_email, clients);
  if (exact) return { id: exact };
  if (clients[0]?.id)
    return { id: clients[0].id, note: `unknown sender ${facts.contact_email ?? "?"} — used the company's existing contact` };
  return {
    id: PLACEHOLDER_CONTACT_ID,
    note: `new contact ${facts.contact_email ?? "?"} and the company has no contact on file — order raised against Ben Mikus as a stand-in; add the real contact in OnSinch`,
  };
}

/** place: reuse prior; else exact-match all places; else provision a new one on write. */
async function resolvePlace(
  facts: ConversationFacts,
  prior: ConversationState | undefined,
  onsinch: OnsinchClient,
  aliases?: CompileDeps["aliases"]
): Promise<{ id?: number; provision?: DesiredOrder["provision_place"]; note?: string }> {
  if (prior?.place_id) return { id: prior.place_id };

  // No venue named anywhere in the thread. Every slot team still needs a place_id, so
  // the job gets the placeholder venue rather than not existing: "No Location" is
  // matched by name like any other place, and created on the first enquiry that needs
  // it. A job at a named venue is better than no job, and a job at "No Location" is
  // better than an enquiry nobody sees.
  const locationText = facts.location_text || PLACEHOLDER_PLACE_NAME;
  const missingVenue = !facts.location_text;

  const key = normAddr(locationText);
  const remembered = await aliasLookup(aliases, "place", key);
  if (remembered) {
    return {
      id: remembered,
      note: missingVenue
        ? `no venue named — used the "${PLACEHOLDER_PLACE_NAME}" placeholder; set the real venue in OnSinch`
        : `venue from a name resolved before ("${locationText}")`,
    };
  }

  const places = await onsinch.allPlaces();
  const id = matchPlace(locationText, places);
  if (id) {
    // matchPlace resolves on several rules, only one of which is equality; the others
    // are containment, which is a judgement. Only equality is cached as trusted.
    const wasExact = places.some(
      (p) => p.id === id && (normAddr(p.name) === key || normAddr(p.address) === key)
    );
    await aliasRecord(aliases, { kind: "place", alias_norm: key, entity_id: id,
                                 source: wasExact ? "exact" : "fuzzy", raw_example: locationText });
    return {
      id,
      note: missingVenue
        ? `no venue named — used the "${PLACEHOLDER_PLACE_NAME}" placeholder; set the real venue in OnSinch`
        : undefined,
    };
  }
  return {
    // The placeholder is a NAME, not an address: creating it with address "No Location"
    // would put that string on a real job sheet as if it were somewhere to drive to.
    provision: missingVenue
      ? { name: PLACEHOLDER_PLACE_NAME, country: "GB" }
      : { name: locationText.slice(0, 120), country: "GB", address: locationText },
    note: missingVenue
      ? `no venue named — creating and using the "${PLACEHOLDER_PLACE_NAME}" placeholder; set the real venue in OnSinch`
      : `new venue "${locationText}" — will be created in OnSinch on confirm`,
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
  // When the thread has already been read, the facts it produced are sent AS WELL as
  // the conversation — a summary alongside the evidence, with the conversation winning
  // where they disagree. The facts alone were tried and are not enough to classify on:
  // "does ANY client message in this thread ask for crew" cannot be answered from a
  // summary of what was already understood, and every repeat message on a live thread
  // took that path. mergeFacts below is what keeps a narrow answer safe — the model can
  // reply about one message without deleting what four earlier emails established.
  //
  // It costs the re-read the incremental path existed to avoid. Priced before the
  // change: NORMALISED history is 4,674 chars mean / 18,369 max over 307 live threads
  // (~1.2k tokens an event, ~34 events a day). The 6.26x figure that justified dropping
  // it was measured on raw bodies, which carry the quoted copies normalize now strips.
  const priorFacts = prior?.facts;
  const incremental =
    reasoner.classifyAndExtractIncremental &&
    priorFacts &&
    (Object.keys(priorFacts).length > 1 || (priorFacts.requests ?? []).length > 0) &&
    history.length > 0;

  const combined = incremental
    ? await reasoner.classifyAndExtractIncremental!(latest, priorFacts!, prior?.classification, !!prior?.onsinch_order_id, history)
    : reasoner.classifyAndExtract
      ? await reasoner.classifyAndExtract(latest, history, !!prior?.onsinch_order_id)
      : null;
  if (incremental) notes.push("read the whole conversation against the facts already stored for it");
  const cls = combined ?? (await reasoner.classify(latest, history, !!prior?.onsinch_order_id));

  // Keep the classifier's own explanation for a rejection. job_summary is the
  // reason ("N/A - Acknowledgment/confirmation only, no changes requested"); it
  // was used as the order specification for real jobs and discarded for
  // everything else, so the board's Dismissed lane had nothing to show — 18 of
  // the first 25 dismissals recorded no reason at all. The "N/A -" prefix is a
  // machine artefact of the prompt's output format, not something to show a human.
  // THE CLASSIFIER DEFERS TO THE EXTRACTOR.
  // This was written when the ported n8n prompt said "Never classify Thread History
  // messages. Only classify Current Email", so a thread whose newest message was
  // Spartan's own reply, a bounce or an emoji reaction was called junk while the
  // client's request sat one message earlier. Over a 150-thread random sample of the
  // year, 91 threads were labelled not-a-job, 28 of them carried a crew number and a
  // date, and 21 of the 41 with a dated block became real OnSinch orders anyway.
  // Fifteen were read by hand: 13 were genuine jobs.
  //
  // That instruction is GONE — CLASSIFY_SYSTEM now asks "does ANY client message in
  // the thread contain job-request language", and the whole labelled conversation is
  // what gets sent. The overrule stays anyway: it is the cheap backstop for the same
  // failure returning by another route, and it costs nothing on the combined path.
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

  // 2. only a real job triggers the order path
  //
  // THE ORDER WORK HAPPENS BEFORE THE REPLY, and that ordering is the point.
  // Composing first meant the reply was written knowing nothing about whether the
  // booking could actually be made, so it promised one either way: live thread
  // 19fadd4ff8152dea, a needs-info ticket whose company never resolved and which
  // has no order at all, drafted "both dates are now booked in". A drafted promise
  // a human sends unread is a booking Spartan has agreed to and not staffed.
  // Ben, 2026-08-09: "fix the commitment problem, compose the reply after the order."
  const isJob = classification === "new-job" || classification === "update";
  let facts: ConversationFacts = prior?.facts ?? { requests: [] };
  let desired = null as ConversationState["desired_order"];
  /**
   * A human must LOOK at this before it is confirmed. Set by every stand-in the
   * resolvers fall back to.
   */
  let needs_human = false;
  /**
   * The order cannot go out as built, and is not staged at all. Reserved for a
   * failed validateOrder — a body OnSinch would reject, or would accept and get
   * wrong.
   *
   * These two used to be one flag, which is why a thread missing a venue produced
   * nothing: any reason to involve a human was also a reason to withhold the order.
   * Ben, 2026-08-09: "creating a job correctly with all of the info we DO have,
   * consistently, is the goal." So a stand-in now flags the job; only a broken body
   * withholds it.
   */
  let blocked = false;
  let company_id = prior?.company_id;
  let user_id = prior?.user_id;
  let place_id = prior?.place_id;
  let linkedOrderId = prior?.onsinch_order_id;
  // Carried alongside the api id because they are what a human searches on. Both
  // come free with the dedup lookup, which already pulls `with=Job`.
  let linkedOrderNumber = prior?.onsinch_order_number;
  let linkedJobId = prior?.onsinch_job_id;
  let provisionPlace: DesiredOrder["provision_place"];
  let provisionCompany: DesiredOrder["provision_company"];
  /** Things only the client can tell us, without which no order can be built. */
  const askFor = new Set<string>();

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
    provisionCompany = co.provision;
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

    /**
     * A block that names its OWN venue — "4 crew at ExCeL, then 2 at Olympia that
     * afternoon". Location is half of what separates one SlotTeam from another, and
     * until now nothing upstream could express it: every block inherited the order's
     * single place, so a job that moved crew between venues composed as one team.
     *
     * Only resolved against places that already exist. A per-block venue that does
     * not resolve keeps the order's place rather than provisioning a second one:
     * creating a venue from a fragment inside a request block is how the 632 ExCeL
     * shells got there in the first place, and the block-level string is the shortest
     * and least reliable venue text in the whole email.
     */
    /**
     * Learn the profession wordings this client actually uses (Ben, Q11).
     *
     * The resolver works every hint out from first principles on every email, so a
     * phrasing it gets right today it re-derives tomorrow, and one it gets WRONG is
     * wrong forever with nowhere for a human to correct it. The alias store is the
     * correction surface: `exact` rows resolve automatically, `fuzzy` rows are recorded
     * as suggestions and change nothing until someone confirms them — the same
     * human/exact/fuzzy split that already governs companies and places.
     *
     * Recorded here rather than inside resolveProfession so the resolver stays a pure
     * function: it is called from compose, which must not write to a database.
     */
    const learnedProfessions: Record<number, number> = {};
    for (const [i, r] of (facts.requests ?? []).entries()) {
      const hint = r.profession_hint?.trim();
      if (!hint) continue;
      const key = normProf(hint);

      // A wording somebody has already settled beats working it out again. This is the
      // whole point of the store: the same phrasing stops being re-derived, and a wrong
      // answer has somewhere to be corrected.
      const remembered = await aliasLookup(deps.aliases, "profession", key);
      if (remembered) {
        learnedProfessions[i] = remembered;
        continue;
      }

      const m = resolveProfession(hint, PROFESSION_LIST, { hours: undefined });
      if (m.why === "default") continue; // nothing was learned, so nothing is recorded
      await aliasRecord(deps.aliases, {
        kind: "profession",
        alias_norm: normProf(hint),
        entity_id: m.id,
        // Only a match on the tenant's own name for it is a fact. A keyword or a cue is
        // a judgement, and a judgement that resolves itself automatically is how one
        // wrong answer becomes permanent.
        source: m.why === "exact" || m.why === "alias" ? "exact" : "fuzzy",
        raw_example: hint,
      });
    }
    if (Object.keys(learnedProfessions).length) {
      facts = {
        ...facts,
        requests: (facts.requests ?? []).map((r, i) =>
          learnedProfessions[i] ? { ...r, profession_id: learnedProfessions[i] } : r
        ),
      };
    }

    const perBlock = (facts.requests ?? []).filter((r) => r.location_text?.trim());
    if (perBlock.length) {
      const places = await onsinch.allPlaces();
      let moved = 0;
      facts = {
        ...facts,
        requests: (facts.requests ?? []).map((r) => {
          if (!r.location_text?.trim()) return r;
          const id = matchPlace(r.location_text, places);
          if (!id || id === place_id) return r;
          moved++;
          return { ...r, place_id: id };
        }),
      };
      if (moved) notes.push(`${moved} block(s) name a different venue — staffed as separate teams`);
      else notes.push(`a block named its own venue but it did not resolve — kept on the job's venue`);
    }

    // Order dedup vs OnSinch — never create a second job for an existing one, and
    // never attach a change to the wrong one. See matchExistingOrder: the venue is
    // what separates a client's several jobs on the same day, and where it cannot,
    // the thread goes to a human rather than picking.
    if (company_id && !linkedOrderId) {
      const existing = matchExistingOrder(
        firstDate(facts),
        await onsinch.companyOrdersWithJob(company_id),
        facts.location_text
      );
      if (existing && "order_id" in existing) {
        linkedOrderId = existing.order_id;
        linkedOrderNumber = existing.order_number ?? linkedOrderNumber;
        linkedJobId = existing.job_id ?? linkedJobId;
        notes.push(
          `matched existing OnSinch order #${existing.order_id}${existing.job_id ? ` (job J${existing.job_id})` : ""} (${existing.by === "date+venue" ? "same date and venue" : "same date"}) — will update, not create`
        );
      } else if (existing) {
        // Deliberately does NOT fall through to creating a new order: on an update
        // that would duplicate a job that already exists. A human picks.
        needs_human = true;
        blocked = true;
        notes.push(
          `${existing.ambiguous} existing OnSinch orders for this client on ${existing.day} and the thread does not say which — ` +
            `not guessing; pick the right one by hand`
        );
      }
    }

    // Rate card (I1) — resolved before compose; no confident card => needs-human.
    //
    // This is the ONE thing still allowed to stop an order, and deliberately so. A
    // company being created has no order history, so it has no card, and there is no
    // safe stand-in: OnSinch silently assigns a default when the field is omitted,
    // which is precisely the wrong-rate failure Tracy reported. Nor is there a house
    // default to borrow — across the 100 most recent live orders the cards are 342
    // (49%) and 315 (30%), so the "197 is standard" in the API reference is stale and
    // a majority pick would be a coin-flip on what a client is charged.
    //
    // Everything else about the job is composed and staged; a human supplies this one
    // number and confirms. Money is the one field worth blocking on.
    let pricelist_category_id = 0;
    let rateSource: DesiredOrder["rate_card_source"];
    if (company_id) {
      const rate = await resolveRateCard(company_id, {
        onsinch,
        seededRateCard: deps.seededRateCard,
        defaultCard: deps.defaultRateCard,
      });
      if (rate.card) {
        pricelist_category_id = rate.card;
        rateSource = rate.source === "none" ? undefined : rate.source;
        if (rate.source === "default") {
          notes.push(
            `no pricing history for company ${company_id} — using the standard rate card ${rate.card}; ` +
              `CHECK IT BEFORE CONFIRMING (I1)`
          );
        }
      } else notes.push(`no confident rate card for company ${company_id} — needs a human (I1)`);
    } else if (provisionCompany) {
      // A company being created has no history by definition, so the standard card
      // is the only thing that lets its first job exist at all. It is staged, never
      // written hands-free, and the note says the number was assumed.
      const fallback = deps.defaultRateCard;
      if (Number.isInteger(fallback as number) && (fallback as number) > 0) {
        pricelist_category_id = fallback as number;
        rateSource = "default";
        notes.push(
          `"${provisionCompany.name}" is a new client — using the standard rate card ${fallback}; ` +
            `CHECK IT BEFORE CONFIRMING (I1)`
        );
      } else {
        notes.push(`"${provisionCompany.name}" is new, so it has no rate card yet — set one when confirming (I1)`);
      }
    }

    /**
     * What the CLIENT would have to tell us before this job can be booked.
     *
     * Ben, 2026-08-09: "it is fine if there is missing information in general, but
     * if there is missing information that impedes on the systems ability to
     * create an order, then we should ask for it in our reply."
     *
     * So this is deliberately not a list of everything unknown. It is the things
     * that stop an order existing AND that only the client can supply:
     *
     *   crew size, date, times   - nobody else knows what they want
     *   venue                    - only asked when there is no venue anywhere in
     *                              the thread, since an unrecognised one is created
     *
     * Company is EXCLUDED on Ben's instruction ("if not enough info is provided,
     * other than company"). A client should never be asked to confirm who they
     * are: an unknown company is created, and an unknown contact falls back to a
     * stand-in. Those are our problems to solve, not questions to put to them.
     *
     * The rate card is excluded for the same reason from the other direction - it
     * blocks the order, but it is Spartan's number to set, and asking a client
     * what to charge them would be absurd.
     */
    for (const r of facts.requests ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? ""))) { askFor.add("the date(s) you need crew"); }
      if (!(Number(r.size) > 0)) { askFor.add("how many crew you need"); }
      if (!r.start_time || !r.end_time) { askFor.add("the start and finish times"); }
    }
    if (!(facts.requests ?? []).length) {
      askFor.add("the date(s) you need crew");
      askFor.add("how many crew you need");
      askFor.add("the start and finish times");
    }
    if (!facts.location_text) askFor.add("the venue address");

    const havePlace = !!place_id || !!provisionPlace;
    const haveCompany = !!company_id || !!provisionCompany;
    if (haveCompany && user_id && havePlace && pricelist_category_id) {
      const composed = composeOrder({
        facts,
        /**
         * The live profession list when the deployment has one — the Neon cache, kept
         * fresh by scripts/pull-professions.mjs. Absent, compose falls back to the
         * committed PROFESSION_LIST, which is why a database outage costs accuracy on
         * professions added since the last commit and nothing more.
         */
        professions: deps.professions,
        // 0 => created on write from provisionCompany, exactly as place_id already works.
        company_id: company_id ?? 0,
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
      if (desired && provisionCompany) desired.provision_company = provisionCompany;
      // Carried on the order itself so the write path can refuse to auto-send an
      // assumed price, whatever the dashboard's order_mode says.
      if (desired && rateSource) desired.rate_card_source = rateSource;
      if (desired) {
        const errs = validateOrder(desired);
        if (errs.length) {
          needs_human = true;
          blocked = true;
          notes.push(...errs);
        }
      }
      // A staged order built on a stand-in still goes to a human, but it goes there as
      // an ORDER rather than as an enquiry with nothing attached. needs_human means
      // "check this before confirming", not "nothing was produced".
      // Every stand-in the resolvers fell back to calls a human — including an
      // assumed rate card. The pipeline already refuses to auto-write that order,
      // but a price nobody chose must also SHOW on the board, or the click it is
      // waiting for never comes.
      if (provisionCompany || provisionPlace || user_id === PLACEHOLDER_CONTACT_ID || rateSource === "default") {
        needs_human = true;
      }

      /**
       * composeOrder can decline: every request block lacked a crew size, or a date,
       * so there is no shift to build. Every id resolved, so nothing above fired —
       * and the thread was landing on the board as "drafted" with no order attached
       * and nobody called. A job that produced nothing is the single case most worth
       * surfacing, and it was the quietest.
       */
      if (!desired) {
        needs_human = true;
        blocked = true;
        notes.push("nothing bookable could be built from this thread — see the missing details above");
      }
    } else {
      // No rate card, or nothing dated to build a shift from. Nothing composed, so
      // nothing to stage — the thread stands on the board with the notes above saying
      // exactly which piece is missing.
      needs_human = true;
      blocked = true;
    }
  }

  /**
   * 3. NOW compose the reply, knowing what actually happened to the order.
   *
   * The reply is told two things it never had: whether a booking exists, and what
   * the client would have to send for one to exist. It can then say "we're getting
   * this booked in" instead of "booked in", and ask for the missing crew count in
   * the same breath rather than leaving a human to notice.
   *
   * `order_state` is deliberately coarse. The model is not shown ids, statuses or
   * anything it could leak into prose — only which of four situations it is in.
   */
  /**
   * "enquiries" scope keys off isJob, which is the SAME test the order path uses,
   * so the rule is exactly "reply where there is a booking to talk about". It
   * deliberately includes updates: a client moving a shift is asking for
   * something and expects an answer, and it is the classification the whole
   * engine already treats as a live request.
   *
   * Note this reads the classification AFTER the extractor may have overruled it,
   * so a thread the classifier called junk but which carries a dated crew request
   * still gets its reply. Gating on the raw classifier verdict would reintroduce
   * the miss that overrule exists to fix.
   */
  const inScope = (deps.replyScope ?? "all") === "all" || isJob;
  const repliesEnabled = deps.repliesEnabled !== false && inScope;
  const orderState: ReplyContext["order_state"] = !isJob
    ? "not-a-job"
    : desired && !blocked
      ? linkedOrderId
        ? "updating-existing"
        : "staged"
      : "blocked";
  const reply = repliesEnabled
    ? await reasoner.composeReply(latest, history, classification, {
        order_state: orderState,
        // Only worth asking about when it is the reason nothing exists. A staged
        // order that happens to lack a finish time already defaulted sensibly, and
        // a client does not need an email about it.
        ask_for: orderState === "blocked" ? [...askFor] : [],
      })
    : null;
  const replyHash = reply ? hash(reply.html) : undefined;

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
  // `blocked`, not `needs_human`: an order built on a stand-in venue or a company being
  // created is still an order, and staging it is the whole point — a human confirms it
  // in one click instead of typing it out from an email.
  if (desired && !blocked) {
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
    cancellation: cls.cancellation === true,
    facts,
    company_id,
    user_id,
    place_id,
    onsinch_order_id: linkedOrderId,
    onsinch_order_number: linkedOrderNumber,
    onsinch_job_id: linkedJobId,
    desired_order: desired,
    last_ordered_hash: prior?.last_ordered_hash,
    /**
     * Both of these are written by the PIPELINE, after this function has returned, and
     * both have to survive into the next email's compile or the code that reads them
     * never runs.
     *
     * last_ordered_teams_hash is what tells a crew change apart from a PO follow-up.
     * tryReplace reads it off the state compile produces, so while it was dropped here
     * `teamsChanged` was false on every second email and delete-and-repost — the only
     * route a crew or time change has to an existing order — could not fire at all. The
     * change went to a note asking a human to apply it by hand, which is the behaviour
     * the replace path was built to end. Every test covering it builds the state by
     * hand and calls the pipeline directly, so all of them passed.
     *
     * order_replace is the crash-safety marker for a part-finished replace. Dropped, a
     * resumed run cannot see that the old order is already deleted, and the recovery
     * that re-posts from the snapshot never happens.
     */
    last_ordered_teams_hash: prior?.last_ordered_teams_hash,
    order_replace: prior?.order_replace,
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
