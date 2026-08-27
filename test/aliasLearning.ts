// ============================================================================
// The alias memory must speed resolution up without learning a mistake.
// ----------------------------------------------------------------------------
// A store that remembers what a name resolved to is only safe if a GUESS can never
// become the remembered answer. The failure mode is specific and permanent: one wrong
// fuzzy match is written down, every later email hits it, and the system confirms its
// own error forever while looking more confident each time.
//
// So these check both halves: that a remembered name short-circuits the whole-list
// pull, and that only deterministic or human-confirmed answers are ever trusted.
//
// The alias store is injected through CompileDeps, so this runs against an in-memory
// fake — no database, no API, no spend.
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { normName } from "../app/lib/engine/resolve";
import type { HydratedThread } from "../app/lib/engine/types";
import type { Reasoner } from "../app/lib/engine/reason";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

/** The same promote-never-demote rule the SQL implements, to test it in isolation. */
const RANK = { fuzzy: 1, exact: 2, human: 3 } as const;
type Src = keyof typeof RANK;
function makeStore() {
  const rows = new Map<string, { id: number; source: Src; seen: number }>();
  return {
    rows,
    recorded: [] as Array<{ alias_norm: string; source: string; entity_id: number }>,
    async lookup(kind: "company" | "place", key: string) {
      const r = rows.get(`${kind}|${key}`);
      // Only the trustworthy sources answer.
      return r && (r.source === "human" || r.source === "exact") ? r.id : null;
    },
    async record(a: { kind: "company" | "place"; alias_norm: string; entity_id: number; source: "exact" | "fuzzy"; raw_example?: string }) {
      this.recorded.push({ alias_norm: a.alias_norm, source: a.source, entity_id: a.entity_id });
      this.put(a.kind, a.alias_norm, a.entity_id, a.source);
    },
    put(kind: "company" | "place", key: string, id: number, source: Src) {
      const k = `${kind}|${key}`;
      const prev = rows.get(k);
      if (!prev) { rows.set(k, { id, source, seen: 1 }); return; }
      const promote = RANK[source] >= RANK[prev.source];
      rows.set(k, {
        id: promote ? id : prev.id,
        source: RANK[source] > RANK[prev.source] ? source : prev.source,
        seen: prev.seen + 1,
      });
    },
  };
}

const COMPANIES = [
  { id: 501, name: "Event Concept" },
  { id: 502, name: "Eclipse" },
  { id: 503, name: "Blackout Ltd" },
];

function reasonerSaying(company: string): Reasoner {
  const facts = {
    company_name: company,
    contact_email: "izzabelle@eventconcept.com",
    location_text: "Tobacco Dock, London",
    requests: [{ date: "2026-09-12", start_time: "09:00", end_time: "16:00", size: 6 }],
  };
  return {
    async classifyAndExtract() { return { classification: "new-job", priority: "medium", job_summary: "s", facts }; },
    async classify() { return { classification: "new-job", priority: "medium", job_summary: "s" }; },
    async extractFacts() { return facts; },
    async composeReply() { return { subject: "s", html: "h", priority: "medium" }; },
  } as Reasoner;
}

function threadSaying(body: string): HydratedThread {
  return {
    thread_id: "t-alias",
    messages: [{
      message_id: "m1", from: "izzabelle@eventconcept.com", to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-08-04T09:00:00Z", subject: "Crew", body, is_from_spartan: false,
    }],
  };
}

/** Counts the whole-list pulls, which is what an alias hit is meant to avoid. */
function countingOnsinch(pulls: { companies: number }) {
  return new OnsinchClient(async (_method, path) => {
    // Only the WHOLE-LIST pull counts. listAll builds "/companies?limit=100&page=1";
    // companyClients builds "/companies?id=501&with=Client", which is a single-record
    // read against the same path. Counting both made an alias hit look like a miss.
    if (/^\/companies\?/.test(path) && /limit=/.test(path) && !/\bid=/.test(path)) pulls.companies++;
    const data = path.startsWith("/companies") ? COMPANIES : [];
    return { status: 200, data: { data, pagination: { pageCount: 1, count: data.length } } };
  });
}

console.log("alias learning");

async function main() {

// ---------------------------------------------- an exact match is cached as trusted
{
  const store = makeStore();
  const pulls = { companies: 0 };
  const { __resetListCache } = await import("../app/lib/engine/onsinch");
  __resetListCache();
  await compile(threadSaying("6 crew 12 September 09:00-16:00"), undefined, {
    reasoner: reasonerSaying("Event Concept"), onsinch: countingOnsinch(pulls),
    now: () => 1, repliesEnabled: false, aliases: store,
  } as never);
  const rec = store.recorded.find((r) => r.alias_norm === normName("Event Concept"));
  ok(!!rec, "an exact company match is recorded", JSON.stringify(store.recorded));
  ok(rec?.source === "exact", "and recorded as 'exact', so it may be reused", rec?.source);
  ok(rec?.entity_id === 501, "against the right id", String(rec?.entity_id));
  ok((await store.lookup("company", normName("Event Concept"))) === 501, "so a later email resolves from memory");
}

// ------------------------------------ the fallback's guess is NOT recorded at all
{
  const store = makeStore();
  const pulls = { companies: 0 };
  const { __resetListCache } = await import("../app/lib/engine/onsinch");
  __resetListCache();
  // "Eclipse Presentations" reaches "Eclipse" only through the bounded token fallback.
  await compile(threadSaying("4 crew 1 October"), undefined, {
    reasoner: reasonerSaying("Eclipse Presentations"), onsinch: countingOnsinch(pulls),
    now: () => 1, repliesEnabled: false, aliases: store,
  } as never);
  /**
   * THIS ASSERTION IS THE INVERSE OF WHAT IT WAS, AND THE INVERSION IS THE FIX.
   *
   * It used to require that a bounded-token-fallback match be WRITTEN to the alias store
   * as `source: "fuzzy"`, on the theory that a fuzzy row is inert until a human blesses
   * it. The theory did not survive contact: `aliasLookup` is consulted BEFORE the
   * whole-list match and returns the row whatever its source, so a guess became the
   * permanent answer for that wording and could never be revisited.
   *
   * Live on 2026-08-27: "Event Solutions UK" matched company 502 "Vision Events Solutions
   * LTD" — a different firm — the alias was written the same second, and the ticket
   * carried no note at all. The rate card is derived from the matched company's history,
   * so the next booking for that client would have been priced off somebody else's rates.
   *
   * A guess that is used once is a guess. A guess written to the store is a guess
   * promoted to a fact. So the match is still USED — refusing to book at all would be
   * worse — but it announces itself on the ticket and is never remembered.
   */
  const rec = store.recorded.find((r) => r.alias_norm === normName("Eclipse Presentations"));
  ok(!rec, "a fallback match is NOT written down — a guess must not become the answer", JSON.stringify(rec));
  ok((await store.lookup("company", normName("Eclipse Presentations"))) === null,
     "so the next email asks the question again rather than inheriting the guess");
}

// --------------------------------- a remembered name skips the whole-list pull
{
  const store = makeStore();
  store.put("company", normName("EC"), 501, "human");
  const pulls = { companies: 0 };
  const { __resetListCache } = await import("../app/lib/engine/onsinch");
  __resetListCache();
  const { state } = await compile(threadSaying("6 crew 12 September"), undefined, {
    reasoner: reasonerSaying("EC"), onsinch: countingOnsinch(pulls),
    now: () => 1, repliesEnabled: false, aliases: store,
  } as never);
  ok(state.company_id === 501, "a human-confirmed alias resolves a name no matcher could", String(state.company_id));
  ok(pulls.companies === 0, "and the 756-company pull is skipped entirely", `pulls=${pulls.companies}`);
  ok(state.notes.some((n) => /resolved before/.test(n)), "the state says the id came from memory", state.notes.join(" | "));
}

// --------------------------------------- promotion up, never down
{
  const store = makeStore();
  store.put("company", "acme", 900, "fuzzy");
  store.put("company", "acme", 901, "exact");
  ok(store.rows.get("company|acme")?.id === 901, "an exact sighting overrides a fuzzy one");
  ok(store.rows.get("company|acme")?.source === "exact", "and promotes the source");

  store.put("company", "acme", 902, "human");
  ok(store.rows.get("company|acme")?.id === 902, "a human overrides an exact one");

  // The one that matters.
  store.put("company", "acme", 999, "fuzzy");
  ok(store.rows.get("company|acme")?.id === 902, "a later FUZZY guess cannot overwrite the human's id", String(store.rows.get("company|acme")?.id));
  ok(store.rows.get("company|acme")?.source === "human", "nor demote the source");
  ok(store.rows.get("company|acme")?.seen === 4, "but the sighting is still counted");
}

// ------------------------- a failing alias store must not break a working resolution
{
  const pulls = { companies: 0 };
  const { __resetListCache } = await import("../app/lib/engine/onsinch");
  __resetListCache();
  const broken = {
    async lookup() { throw new Error("alias store down"); },
    async record() { throw new Error("alias store down"); },
  };
  let state: { company_id?: number } | null = null;
  let threw = false;
  try {
    ({ state } = await compile(threadSaying("6 crew 12 September"), undefined, {
      reasoner: reasonerSaying("Event Concept"), onsinch: countingOnsinch(pulls),
      now: () => 1, repliesEnabled: false, aliases: broken,
    } as never));
  } catch { threw = true; }
  ok(!threw, "a broken alias store does not fail the enquiry");
  ok(state?.company_id === 501, "it falls back to the whole-list pull and still resolves", String(state?.company_id));
  ok(pulls.companies === 1, "which means the slow path really did run", `pulls=${pulls.companies}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
