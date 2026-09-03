// ============================================================================
// LEG C — REAL CLIENT MAIL, judged by somebody who has never seen the engine.
// ----------------------------------------------------------------------------
//   npx tsx study/real.ts --sample            draw the threads (free, one file pass)
//   npx tsx study/real.ts --adjudicate --n=100  the reference standard. COSTS MONEY.
//   npx tsx study/real.ts --engine --n=100      run the engine on them. COSTS MONEY.
//   npx tsx study/real.ts --settle              adjudicate every disagreement. COSTS MONEY.
//   npx tsx study/real.ts --report
//
// WHY THIS LEG EXISTS. The synthetic corpus can only be as hard as its author
// imagined. Real mail arrives forwarded, quoted, signed by three people, with
// the request buried under an out-of-office and half the detail in a table that
// became whitespace. If the engine scores well on invented mail and badly on
// this, the invented number is worthless — and the gap between them is itself a
// finding.
//
// WHY sweep_labels IS NOT USED. There are 543 labelled threads in the database
// and they cannot serve as ground truth here, because they were produced by the
// ENGINE'S OWN reasoner: scripts/classify-corpus.ts says so in its header —
// "It uses the ENGINE'S OWN brain — reasoner.classify + reasoner.extractFacts —
// not a new prompt written for the study. The point is to measure the thing
// that will run in production." Scoring the engine against them would measure
// whether the engine reproduces itself, which is the trap that once produced a
// 98.7% self-match and 45.9% on real queries in this account.
//
// WHAT THE REFERENCE STANDARD ACTUALLY IS, stated plainly because it bounds
// every number this leg produces: an independent model, given a prompt written
// from the BOOKER'S side of the desk and never shown the engine's schema, its
// notes, or its answer. That is not truth. So every disagreement is put to a
// third pass which sees the mail and BOTH answers and rules on which is right —
// and the report carries three columns, not one: engine wrong, standard wrong,
// genuinely ambiguous. A study that cannot tell those apart is reporting its
// own ruler.
// ============================================================================
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const numOf = (n: string, d: number) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? Number(a.split("=")[1]) : d;
};
const N = numOf("n", 100);
const SEED = numOf("seed", 20260903);
const CEILING = numOf("ceiling", 6);

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, ".tmp-data", "study");
mkdirSync(OUT, { recursive: true });
const SAMPLE = join(OUT, "real-sample.json");
const STANDARD = join(OUT, "real-standard.jsonl");
const ENGINE = join(OUT, "real-engine.jsonl");
const SETTLED = join(OUT, "real-settled.jsonl");

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RealThread {
  thread_id: string;
  subject: string;
  message_count: number;
  first_date: string;
  last_date: string;
  stratum: string;
  messages: Array<{ message_id: string; from: string; to: string[]; date_iso: string; subject: string; body: string; is_from_spartan: boolean }>;
}

// ---------------------------------------------------------------- sampling
/**
 * One streaming pass over the 196MB sweep, reservoir-sampling per stratum.
 *
 * Stratified by thread LENGTH because that is the axis the classifier's own
 * prompt says it struggles on: "roughly half of all messages in this mailbox
 * are Spartan's own", and judging the newest message alone threw away 43 live
 * jobs in a 200-thread sample. A sample drawn without regard to length would be
 * dominated by one-message threads and would never meet that failure.
 *
 * Seeded, so the same 100 threads come back every run. A study you cannot
 * re-run is an anecdote.
 */
async function sample() {
  const r = rng(SEED);
  const STRATA = ["1", "2-3", "4-9", "10+"] as const;
  const want: Record<string, number> = { "1": Math.round(N * 0.3), "2-3": Math.round(N * 0.3), "4-9": Math.round(N * 0.25), "10+": N - Math.round(N * 0.3) - Math.round(N * 0.3) - Math.round(N * 0.25) };
  const seen: Record<string, number> = { "1": 0, "2-3": 0, "4-9": 0, "10+": 0 };
  const res: Record<string, RealThread[]> = { "1": [], "2-3": [], "4-9": [], "10+": [] };

  const rl = createInterface({ input: createReadStream(join(ROOT, "data", "corpus", "sweep-threads.jsonl"), { encoding: "utf8" }), crlfDelay: Infinity });
  let total = 0, skipped = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { skipped++; continue; }
    const raw = Array.isArray(o.payload?.messages) ? o.payload.messages : [];
    const messages = raw
      .map((m: any) => ({
        message_id: String(m.message_id ?? ""),
        from: String(m.from ?? ""),
        to: Array.isArray(m.to) ? m.to.map(String) : [],
        date_iso: String(m.date_iso ?? o.first_date ?? ""),
        subject: String(m.subject ?? o.subject ?? ""),
        // Real mail runs to megabytes of quoted history. The engine sees the
        // whole thing in production and so does this, but a 2MB body would
        // dominate the adjudicator's context and cost, so it is cut at a
        // generous 12k — and the cut is RECORDED, because a truncated thread
        // that scores badly is a fact about the truncation.
        body: String(m.body ?? "").slice(0, 12000),
        is_from_spartan: typeof m.is_from_spartan === "boolean" ? m.is_from_spartan : /@spartancrew\.co\.uk/i.test(String(m.from ?? "")),
      }))
      .filter((m: any) => m.body.trim());
    // A thread with no client message cannot be an enquiry and is not what this
    // engine is for. Excluded, and the count is reported.
    if (!messages.some((m: any) => !m.is_from_spartan)) { skipped++; continue; }
    if (!messages.length) { skipped++; continue; }
    total++;
    const mc = messages.length;
    const stratum = mc <= 1 ? "1" : mc <= 3 ? "2-3" : mc <= 9 ? "4-9" : "10+";
    seen[stratum]++;
    const t: RealThread = {
      thread_id: String(o.thread_id), subject: String(o.subject ?? ""),
      message_count: mc, first_date: String(o.first_date ?? ""), last_date: String(o.last_date ?? ""),
      stratum, messages,
    };
    // Reservoir sampling: every thread in a stratum has the same chance of
    // being in the sample, in one pass, without holding 5,846 threads in memory.
    const k = want[stratum];
    if (res[stratum].length < k) res[stratum].push(t);
    else {
      const j = Math.floor(r() * seen[stratum]);
      if (j < k) res[stratum][j] = t;
    }
  }
  const picked = STRATA.flatMap((s) => res[s]);
  writeFileSync(SAMPLE, JSON.stringify(picked, null, 1));
  console.log(`swept ${total} usable threads (${skipped} skipped: no client message, or unparseable)`);
  for (const s of STRATA) console.log(`  stratum ${s.padEnd(5)} population ${String(seen[s]).padStart(5)}  sampled ${res[s].length}`);
  console.log(`-> ${SAMPLE}  (${picked.length} threads)`);
}

// ---------------------------------------------------------------- the standard
/**
 * The prompt is written from the BOOKER'S side of the desk, on purpose.
 *
 * It never mentions slot teams, professions, place ids, crew chiefs, rate
 * cards, or any of the engine's vocabulary, and it is not a paraphrase of
 * EXTRACT_SYSTEM. It asks the question a person at Spartan asks when the mail
 * lands: is there a job here, and if so what is it. Anything closer to the
 * engine's own prompt would score the engine against a copy of itself.
 */
const STANDARD_SYSTEM = `You are an experienced bookings coordinator at a crew-hire company. Crews are supplied to exhibitions, events and venues.

You are shown one email conversation from the bookings inbox, oldest message first. Each message says whether it came from the CLIENT or from US.

Answer one question: **if this landed on your desk this morning, what would you do with it?**

Return:

verdict — exactly one of:
  "new-booking"    a client is asking us to supply crew, and it is not already covered earlier in this thread
  "change"         a client is changing, adding to, or cancelling something asked for earlier in this thread
  "acknowledgement" the client is only confirming, thanking, or chatting about work already asked for
  "not-a-job"      nothing in this thread from the client asks for crew — an invoice query, a rate question,
                   a document request, marketing, an automated message, or a conversation about something else

Judge the WHOLE conversation, not the last message. Our own replies, out-of-office notices, delivery
failures and one-word answers sit on top of live requests all the time; they do not change what the
thread is about. A request for a quote that names crew, dates or a venue IS a request for crew.

cancelling — true if the client is calling off work they previously asked for, in whole or in part.

bookable — true only if you could put this in the diary today without going back to the client.
  You need, for every call: how many people, what day, and where. If any of those is missing or
  still "TBC", it is not bookable yet.

venue — the place the crew must physically go, copied as the client wrote it. Not our office, not
  their billing address. Empty if the thread never says.

client — the client company's name as best you can tell. Empty if you genuinely cannot.

calls — one entry per distinct working party. A different day, a different start or finish, a
  different site, or a different trade is a different call. Two lines asking for the same number of
  the same people, at the same place, over the same hours, on the same day are ONE call — add them up.
  For each:
    people    how many bodies the client asked for. The number they wrote, not what we would send.
    date      YYYY-MM-DD. If the client wrote no year, use the next occurrence after the email's own
              date — crew are booked ahead, not behind. Empty if genuinely unstated.
    start     HH:MM, 24h. Empty if the client did not say.
    finish    HH:MM, 24h. A finish earlier than the start is an overnight; write it as given.
              Empty if the client did not say. A stated duration counts: "from 8 for 4 hours" is 08:00-12:00.
    trade     the skill the client asked for, in THEIR words ("carpenters", "forklift drivers",
              "riggers", "general crew"). Empty for ordinary crew.

Count only what the CLIENT asked for. Never add a supervisor, a chief, or anyone the client did not
ask for — we decide that afterwards and it is not part of this answer.
If the thread contains several separate jobs, describe the one the LATEST client message is about.
Never invent a number, a date or a place. If it is not in the text, leave it empty.`;

const STANDARD_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["new-booking", "change", "acknowledgement", "not-a-job"] },
    cancelling: { type: "boolean" },
    bookable: { type: "boolean" },
    venue: { type: "string" },
    client: { type: "string" },
    why: { type: "string", description: "one sentence: what the thread is, and what is missing if it is not bookable" },
    calls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          people: { type: "integer" },
          date: { type: "string" },
          start: { type: "string" },
          finish: { type: "string" },
          trade: { type: "string" },
        },
        required: ["people", "date", "start", "finish", "trade"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "cancelling", "bookable", "venue", "client", "why", "calls"],
  additionalProperties: false,
} as const;

function renderThread(t: RealThread): string {
  return t.messages
    .map((m, i) => {
      const who = m.is_from_spartan ? "US" : "CLIENT";
      const last = i === t.messages.length - 1 ? "  [NEWEST]" : "";
      return `--- message ${i + 1} of ${t.messages.length} — from ${who} — ${m.date_iso}${last}\nSubject: ${m.subject}\n\n${m.body}`;
    })
    .join("\n\n");
}

async function callModel(system: string, user: string, schema: unknown, apiKey: string, model: string): Promise<any> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model, temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      tools: [{ type: "function", function: { name: "emit", parameters: schema } }],
      tool_choice: { type: "function", function: { name: "emit" } },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  const call = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!call) throw new Error(`no tool_call: ${JSON.stringify(j).slice(0, 300)}`);
  return { out: JSON.parse(call), usage: j?.usage ?? null };
}

async function adjudicate() {
  const { loadEnv, requireEnv } = await import("../scripts/_env.mjs");
  loadEnv();
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = process.env.SPARTAN_STANDARD_MODEL || "anthropic/claude-opus-4.6";
  const threads: RealThread[] = JSON.parse(readFileSync(SAMPLE, "utf8")).slice(0, N);
  const done = existsSync(STANDARD)
    ? new Set(readFileSync(STANDARD, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).thread_id))
    : new Set<string>();
  console.log(`reference standard: ${model} — ${threads.length} threads, ${done.size} already done`);
  let n = 0, usd = 0;
  const todo = threads.filter((t) => !done.has(t.thread_id));
  for (let i = 0; i < todo.length; i += 4) {
    if (usd > CEILING) { console.log(`\nABORTED at ~$${usd.toFixed(2)} — over the $${CEILING} ceiling`); break; }
    await Promise.all(todo.slice(i, i + 4).map(async (t) => {
      try {
        const { out, usage } = await callModel(STANDARD_SYSTEM, renderThread(t), STANDARD_SCHEMA, apiKey, model);
        // Opus 4.6 list price, in and out. Approximate on purpose: it is a
        // running guard, not an invoice.
        usd += ((usage?.prompt_tokens ?? 0) / 1e6) * 5 + ((usage?.completion_tokens ?? 0) / 1e6) * 25;
        appendFileSync(STANDARD, JSON.stringify({ thread_id: t.thread_id, stratum: t.stratum, model, standard: out }) + "\n");
      } catch (e) {
        appendFileSync(STANDARD, JSON.stringify({ thread_id: t.thread_id, stratum: t.stratum, model, error: String((e as Error).message).slice(0, 300) }) + "\n");
      }
      n++;
    }));
    process.stdout.write(`\r  ${n}/${todo.length}  ~$${usd.toFixed(2)}   `);
  }
  console.log(`\n-> ${STANDARD}`);
}


// ---------------------------------------------------------------- the engine
/**
 * The engine, on the same threads, through the SAME entry point production
 * uses — coerceThread then handleThread.
 *
 * The transport is a fixture, but it answers venues and companies from the REAL
 * tenant: 5,567 places and 771 companies. Nothing is written to OnSinch, and
 * nothing needs to be — every gate this leg scores is decided before the wire.
 *
 * The rate card is PINNED. A real client with no pricing history would
 * otherwise send the thread down the assumed-card path, which flags a human
 * and has nothing to do with whether the booking is right. Pinning it measures
 * the booking; the rate card is Spartan's own number and has its own study.
 */
async function engineRun() {
  const { loadEnv, requireEnv, onsinchBase } = await import("../scripts/_env.mjs");
  loadEnv();
  const { OnsinchClient, __resetListCache } = await import("../app/lib/engine/onsinch");
  const { InMemoryStore } = await import("../app/lib/engine/store");
  const { InMemoryMetrics } = await import("../app/lib/engine/metrics");
  const { createOrderWithPlace } = await import("../app/lib/deps");
  const { handleThread } = await import("../app/lib/engine/pipeline");
  const { coerceThread } = await import("../app/lib/engine/intake");
  const { DEFAULT_SETTINGS } = await import("../app/lib/engine/types");
  const { createOpenRouterReasoner, createVenueJudge } = await import("../app/lib/engine/reason");
  const { guardReasoner } = await import("../app/lib/engine/spend");
  const { loadPlaces, loadProfessions } = await import("./rig");
  const { createHash } = await import("node:crypto");

  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6";
  const places = loadPlaces();
  const professions = loadProfessions();
  const companies = JSON.parse(readFileSync(join(ROOT, ".tmp-data", "companies.json"), "utf8"));
  console.log(`engine: ${model} — ${places.length} places, ${companies.length} companies`);

  const threads: RealThread[] = JSON.parse(readFileSync(SAMPLE, "utf8")).slice(0, N);
  const done = existsSync(ENGINE)
    ? new Set(readFileSync(ENGINE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).thread_id))
    : new Set<string>();
  const todo = threads.filter((t) => !done.has(t.thread_id));
  console.log(`  ${threads.length} threads, ${done.size} already done`);

  const page = (rows: unknown[]) => ({ status: 200, data: { data: rows, pagination: { count: rows.length, pageCount: 1, nextPage: false } } });
  let n = 0, usd = 0;

  for (let i = 0; i < todo.length; i += 3) {
    if (usd > CEILING) { console.log(`\nABORTED at ~$${usd.toFixed(2)} — over the $${CEILING} ceiling`); break; }
    await Promise.all(todo.slice(i, i + 3).map(async (t) => {
      const wire: string[] = [];
      const provisioned: Array<{ id: number; name: string }> = [];
      let nextPlace = 990000;
      __resetListCache();
      const transport: any = async (method: string, path: string, body: unknown) => {
        if (method !== "GET") wire.push(`${method} ${path.split("?")[0]}`);
        if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 900001, number: "29999" }] } };
        if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: 300001 }] } };
        if (method === "POST" && path === "/places") {
          const id = nextPlace++;
          provisioned.push({ id, name: String((body as Array<{ name?: string }>)?.[0]?.name ?? "") });
          return { status: 201, data: { data: [{ id }] } };
        }
        if (method === "POST" && path === "/companies") return { status: 201, data: { data: [{ id: 980001 }] } };
        if (method === "PATCH") return { status: 204, data: null };
        if (path.startsWith("/attendance")) return page([]);
        if (path.startsWith("/places")) return page(places);
        if (path.startsWith("/companies")) return page(companies);
        if (path.startsWith("/orders")) return page([]);
        return page([]);
      };
      const onsinch = new OnsinchClient(transport);
      // The clock stands at the thread's own newest message, so a bare date
      // resolves the way it would have on the day the mail arrived rather than
      // the way it does today. Replaying 2025 mail against a 2026 clock would
      // roll every unyeared date forward a year and score the engine wrong for
      // an artefact of when the study happened to run.
      let clock = Date.parse(t.messages[t.messages.length - 1]?.date_iso || t.last_date || "2026-09-01T09:00:00Z") || Date.now();
      const guarded = guardReasoner(createOpenRouterReasoner({ apiKey, model }), {
        model, label: `real ${t.thread_id}`, limit: 10,
        onCall: (r: any) => { usd = Math.max(usd, usd); },
      });
      const deps: any = {
        reasoner: guarded, onsinch, now: () => ++clock, store: new InMemoryStore(),
        metrics: new InMemoryMetrics(), settings: { ...DEFAULT_SETTINGS },
        hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
        professions, seededRateCard: async () => 315,
        archiveOrder: async () => 1, recordReplacement: async () => {},
        venueJudge: createVenueJudge({ apiKey, model }),
        executor: {
          createReplyDraft: async () => "no-draft",
          createInternalDraft: async () => "no-draft",
          createOrder: async (order: any) => createOrderWithPlace(onsinch, order),
          patchOrder: async () => [],
          amendOrderInPlace: async () => ({ declined: true }),
          replaceOrder: async () => ({ created: null }),
          identifiersForOrder: async () => ({}),
        },
      };
      try {
        const thread = coerceThread({
          thread_id: t.thread_id,
          messages: t.messages.map((m) => ({ ...m })),
        });
        if (!thread) throw new Error("coerceThread refused the payload");
        const state: any = await handleThread(thread, deps);
        const teams = (state.desired_order?.slot_teams ?? []).map((x: any) => ({
          size: x.size, profession_id: x.profession_id, place_id: x.place_id, beginning: x.beginning, end: x.end,
        }));
        appendFileSync(ENGINE, JSON.stringify({
          thread_id: t.thread_id, stratum: t.stratum,
          classification: state.classification, cancellation: state.cancellation ?? false,
          status: state.status, needs_human: state.needs_human,
          place_id: state.place_id ?? null, company_id: state.company_id ?? null,
          teams, notes: state.notes ?? [], facts: state.facts ?? null,
          provisioned, wire,
        }) + "\n");
      } catch (e) {
        appendFileSync(ENGINE, JSON.stringify({ thread_id: t.thread_id, stratum: t.stratum, error: String((e as Error).message).slice(0, 400) }) + "\n");
      }
      n++;
    }));
    process.stdout.write(`\r  ${n}/${todo.length}   `);
  }
  console.log(`\n-> ${ENGINE}`);
}


// ---------------------------------------------------------------- comparison
const VERDICT_TO_CLASS: Record<string, string> = {
  "new-booking": "new-job", "change": "update",
  "acknowledgement": "confirmation-only", "not-a-job": "not-a-job",
};
const CHIEF = 36;
const ms = (xs: string[]) => xs.filter(Boolean).slice().sort().join("~");

/**
 * Where the engine and the standard disagree, mechanically, before anybody
 * rules on who is right.
 *
 * Chief teams are excluded from the block count and INCLUDED in the headcount,
 * because that is what the carve-out means: a team of four becomes three plus a
 * chief, so the client still gets four people and the order still describes one
 * working party. Counting the chief team as a second block would report every
 * team of four or more as a block-count disagreement.
 */
/**
 * OnSinch's OWN notifier, which the reference standard cannot recognise and
 * which would otherwise produce the largest false finding in this study.
 *
 * `no-reply@sinch.cz` is the tenant's own system telling Spartan that a client
 * used the OnSinch client portal to raise an order. The mail reads exactly like
 * a crew request — "Client created new order", a job name, a date, a staff
 * count — and the independent reading called all eight of them new bookings.
 * They are not. The order ALREADY EXISTS: every one carries
 * `spartancrew.onsinch.com/admin/orders/view/<id>`. Booking from it would raise
 * a duplicate of an order the client can already see.
 *
 * So the engine ignoring them is correct, and the standard is wrong. Rather
 * than let the settle pass adjudicate an email whose meaning depends on a fact
 * that is not in the email, the class is identified deterministically and the
 * standard's verdict is overruled here, in the open.
 *
 * 197 threads in the 5,830-thread sweep carry the "Client created new order"
 * subject and 17 carry "Client cancelled job" — 3.7% of the mailbox — so this
 * is not a curiosity of the sample.
 */
function isPortalNotification(t: RealThread | undefined): boolean {
  if (!t) return false;
  return t.messages.some((m) =>
    /no-reply@sinch\.cz/i.test(m.from) || /onsinch\.com\/admin\/(orders|jobs)\/view/i.test(m.body));
}

function compare(std: any, eng: any, portal = false) {
  const d: Record<string, { engine: unknown; standard: unknown }> = {};
  if (!std || !eng || eng.error || std.error) return { d, comparable: false };

  const wantClass = portal ? "not-a-job" : VERDICT_TO_CLASS[std.verdict];
  if (portal) {
    // Nothing to book means nothing downstream is comparable either.
    if (wantClass !== eng.classification) d.classification = { engine: eng.classification, standard: wantClass };
    return { d, comparable: true };
  }
  if (wantClass !== eng.classification) d.classification = { engine: eng.classification, standard: wantClass };

  const wrote = eng.status === "ordered" || eng.status === "proposed";
  if (Boolean(std.bookable) !== wrote) d.bookable = { engine: eng.status + (wrote ? " (would book)" : " (would not)"), standard: std.bookable };

  // Only compare the shape of the order where BOTH sides think there is one.
  if (std.bookable && wrote) {
    const calls = (std.calls ?? []) as Array<any>;
    const merged = new Set(calls.map((c) => c.date + "|" + c.start + "|" + c.finish + "|" + c.trade)).size;
    const teams = (eng.teams ?? []) as Array<any>;
    const nonChief = teams.filter((t) => t.profession_id !== CHIEF);

    const wantHead = calls.reduce((n, c) => n + (Number(c.people) || 0), 0);
    const gotHead = teams.reduce((n, t) => n + (Number(t.size) || 0), 0);
    if (wantHead !== gotHead) d.headcount = { engine: gotHead, standard: wantHead };
    if (merged !== nonChief.length) d.blocks = { engine: nonChief.length, standard: merged };

    const wantDates = ms(calls.map((c) => String(c.date || "")));
    const gotDates = ms(nonChief.map((t) => String(t.beginning || "").slice(0, 10)));
    if (wantDates !== gotDates) d.dates = { engine: gotDates, standard: wantDates };

    /**
     * Windows are compared ONLY where the client actually stated them.
     *
     * The engine fills an unstated finish with 18:00 by design, and the
     * standard is asked to leave it empty. Comparing those two would score the
     * documented default as a miss on every untimed enquiry — which is most of
     * them — and say nothing about whether the engine read the mail right.
     */
    const stated = calls.filter((c) => c.start && c.finish);
    if (stated.length) {
      const wantW = ms(stated.map((c) => c.start + "-" + c.finish));
      const gotW = ms(nonChief.map((t) => String(t.beginning).slice(11, 16) + "-" + String(t.end).slice(11, 16)));
      if (!wantW.split("~").every((w) => gotW.includes(w))) d.windows = { engine: gotW, standard: wantW };
    }
  }
  return { d, comparable: true };
}

const SETTLE_SYSTEM = `You are settling a disagreement about one email conversation from a crew-hire company's bookings inbox.

Two readers have read the same thread and answered differently. You are shown answer A and answer B. You are NOT told which reader produced which, and you must not guess — decide only which answer the EMAIL supports.

For each field in dispute, return a ruling:
  "A"          answer A is right and B is wrong
  "B"          answer B is right and A is wrong
  "ambiguous"  the email genuinely does not settle it — a competent person could read it either way

Rules:
- Decide from the EMAIL TEXT alone. Quote the words that settle it in your reason.
- "ambiguous" is a real answer and you should use it. A thread that says "same as last time", or
  gives a headcount in a table that did not survive as plain text, or names a date with no year in
  a way that could go either way, is genuinely ambiguous, and pretending otherwise manufactures a
  finding that is not there.
- The client's own words decide. What the company would sensibly do about it does not.
- If the disputed field is headcount, count only the people the CLIENT asked for. A supervisor or
  crew chief the company adds on top is not part of the client's number, so an answer higher by
  exactly the number of supervisors is NOT wrong on headcount.
- Keep each reason under 30 words.`;

const SETTLE_SCHEMA = {
  type: "object",
  properties: {
    rulings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          ruling: { type: "string", enum: ["A", "B", "ambiguous"] },
          reason: { type: "string" },
        },
        required: ["field", "ruling", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["rulings"],
  additionalProperties: false,
} as const;

async function settle() {
  const { loadEnv, requireEnv } = await import("../scripts/_env.mjs");
  loadEnv();
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = process.env.SPARTAN_SETTLE_MODEL || "anthropic/claude-opus-4.6";
  const threads: RealThread[] = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const byId = new Map(threads.map((t) => [t.thread_id, t]));
  const std = new Map<string, any>(readFileSync(STANDARD, "utf8").trim().split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.thread_id, o] as [string, any]; }));
  const eng = new Map<string, any>(readFileSync(ENGINE, "utf8").trim().split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.thread_id, o] as [string, any]; }));
  const done = existsSync(SETTLED)
    ? new Set(readFileSync(SETTLED, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).thread_id))
    : new Set<string>();

  const disputes: Array<{ id: string; d: any; std: any; eng: any }> = [];
  for (const [id, e] of eng) {
    const s = std.get(id);
    const { d, comparable } = compare(s?.standard, e, isPortalNotification(byId.get(id)));
    if (comparable && Object.keys(d).length && !done.has(id)) disputes.push({ id, d, std: s.standard, eng: e });
  }
  console.log(disputes.length + " thread(s) with a disagreement to settle (" + done.size + " already done)");

  let n = 0, usd = 0;
  for (let i = 0; i < disputes.length; i += 3) {
    if (usd > CEILING) { console.log("\nABORTED at ~$" + usd.toFixed(2)); break; }
    await Promise.all(disputes.slice(i, i + 3).map(async (x) => {
      const t = byId.get(x.id)!;
      /**
       * A AND B ARE ASSIGNED BY THE THREAD ID, NOT BY WHICH IS THE ENGINE.
       *
       * A judge shown the engine's answer always in the same slot can learn the
       * slot rather than read the mail, and any position bias then lands
       * entirely on one side of the result. The mapping is recorded so the
       * ruling can be decoded, and it is deterministic so the run repeats.
       */
      const engineIsA = (x.id.charCodeAt(x.id.length - 1) % 2) === 0;
      const fields = Object.entries(x.d).map(([k, v]: any) =>
        k + ":  A = " + JSON.stringify(engineIsA ? v.engine : v.standard) + "   B = " + JSON.stringify(engineIsA ? v.standard : v.engine)
      ).join("\n");
      const user = "THE CONVERSATION\n" + renderThread(t) + "\n\n---\nDISPUTED FIELDS\n" + fields + "\n\nRule on each field.";
      try {
        const { out, usage } = await callModel(SETTLE_SYSTEM, user, SETTLE_SCHEMA, apiKey, model);
        usd += ((usage?.prompt_tokens ?? 0) / 1e6) * 5 + ((usage?.completion_tokens ?? 0) / 1e6) * 25;
        const decoded = (out.rulings ?? []).map((r: any) => ({
          field: r.field,
          winner: r.ruling === "ambiguous" ? "ambiguous" : (r.ruling === "A") === engineIsA ? "engine" : "standard",
          reason: r.reason,
        }));
        appendFileSync(SETTLED, JSON.stringify({ thread_id: x.id, stratum: t.stratum, disputed: x.d, engineIsA, rulings: decoded }) + "\n");
      } catch (e) {
        appendFileSync(SETTLED, JSON.stringify({ thread_id: x.id, stratum: t.stratum, disputed: x.d, error: String((e as Error).message).slice(0, 300) }) + "\n");
      }
      n++;
    }));
    process.stdout.write("\r  " + n + "/" + disputes.length + "  ~$" + usd.toFixed(2) + "   ");
  }
  console.log("\n-> " + SETTLED);
}


// ---------------------------------------------------------------- the report
function report() {
  const threads: RealThread[] = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const byId = new Map(threads.map((t) => [t.thread_id, t]));
  const std = new Map<string, any>(readFileSync(STANDARD, "utf8").trim().split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.thread_id, o] as [string, any]; }));
  const eng = new Map<string, any>(readFileSync(ENGINE, "utf8").trim().split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.thread_id, o] as [string, any]; }));
  const settled = existsSync(SETTLED)
    ? new Map<string, any>(readFileSync(SETTLED, "utf8").trim().split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.thread_id, o] as [string, any]; }))
    : new Map<string, any>();

  const pct = (a: number, b: number) => (b === 0 ? "  n/a" : ((a / b) * 100).toFixed(1).padStart(5) + "%");
  const line = (n = 78) => "-".repeat(n);

  console.log("\n" + "=".repeat(78));
  console.log("  LEG C — REAL CLIENT MAIL, ENGINE vs AN INDEPENDENT READING");
  console.log("=".repeat(78) + "\n");

  const ids = [...eng.keys()].filter((id) => std.has(id));
  const engErr = ids.filter((id) => eng.get(id).error);
  const usable = ids.filter((id) => !eng.get(id).error && !std.get(id).error);
  console.log(`  threads sampled            ${threads.length}`);
  console.log(`  both sides answered        ${usable.length}`);
  console.log(`  engine threw               ${engErr.length}`);
  const portalCount = usable.filter((id) => isPortalNotification(byId.get(id))).length;
  console.log(`  OnSinch portal notices     ${portalCount}   (standard overruled to not-a-job — see isPortalNotification)`);
  for (const id of engErr.slice(0, 6)) console.log(`      ${id}: ${String(eng.get(id).error).slice(0, 110)}`);

  // ------------------------------------------------ classification matrix
  console.log("\n" + line() + "\n  WHAT IT IS — independent reading (rows) vs engine (columns)\n" + line());
  const CLASSES = ["new-job", "update", "confirmation-only", "not-a-job"];
  const mat: Record<string, Record<string, number>> = {};
  for (const id of usable) {
    const want = isPortalNotification(byId.get(id)) ? "not-a-job" : VERDICT_TO_CLASS[std.get(id).standard.verdict];
    const got = eng.get(id).classification ?? "(none)";
    mat[want] ??= {};
    mat[want][got] = (mat[want][got] ?? 0) + 1;
  }
  console.log("  " + "".padEnd(20) + CLASSES.map((c) => c.slice(0, 9).padStart(10)).join(""));
  let classAgree = 0;
  for (const w of CLASSES) {
    const row = mat[w] ?? {};
    classAgree += row[w] ?? 0;
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    console.log("  " + (w + ` (${total})`).padEnd(20) + CLASSES.map((c) => String(row[c] ?? 0).padStart(10)).join(""));
  }
  console.log(`\n  agreement on what the thread IS: ${pct(classAgree, usable.length)}  (${classAgree}/${usable.length})`);

  // The two that cost money, named rather than buried in a matrix.
  const falseJob = usable.filter((id) => {
    const w = isPortalNotification(byId.get(id)) ? "not-a-job" : VERDICT_TO_CLASS[std.get(id).standard.verdict];
    const g = eng.get(id).classification;
    return (w === "not-a-job" || w === "confirmation-only") && (g === "new-job" || g === "update");
  });
  const missedJob = usable.filter((id) => {
    const w = isPortalNotification(byId.get(id)) ? "not-a-job" : VERDICT_TO_CLASS[std.get(id).standard.verdict];
    const g = eng.get(id).classification;
    return (w === "new-job" || w === "update") && (g === "not-a-job" || g === "confirmation-only");
  });
  console.log(`  a booking raised on a thread that is not one: ${falseJob.length}`);
  console.log(`  a real request read as not-a-job / an ack:    ${missedJob.length}`);
  for (const id of missedJob.slice(0, 8)) {
    const t = byId.get(id)!;
    console.log(`      ${id} [${t.stratum}] "${t.subject.slice(0, 52)}" — ${String(std.get(id).standard.why).slice(0, 80)}`);
  }

  // ------------------------------------------------ raw disagreement
  console.log("\n" + line() + "\n  DISAGREEMENT BY FIELD — before anybody ruled on who is right\n" + line());
  const fields = ["classification", "bookable", "headcount", "blocks", "dates", "windows"];
  const applies: Record<string, number> = {};
  const differs: Record<string, number> = {};
  const perThread: Record<string, string[]> = {};
  for (const id of usable) {
    const { d } = compare(std.get(id).standard, eng.get(id), isPortalNotification(byId.get(id)));
    perThread[id] = Object.keys(d);
    const s = std.get(id).standard, e = eng.get(id);
    const wrote = e.status === "ordered" || e.status === "proposed";
    for (const f of fields) {
      // A field only "applies" where both sides had something to say about it.
      const applicable = f === "classification" || f === "bookable" ? true : (s.bookable && wrote);
      if (!applicable) continue;
      applies[f] = (applies[f] ?? 0) + 1;
      if (d[f]) differs[f] = (differs[f] ?? 0) + 1;
    }
  }
  for (const f of fields) {
    const a = applies[f] ?? 0, x = differs[f] ?? 0;
    console.log(`  ${f.padEnd(16)} agree ${pct(a - x, a)}  (${a - x}/${a})   disagreed on ${x}`);
  }

  // ------------------------------------------------ settled
  console.log("\n" + line() + "\n  WHO WAS RIGHT — every disagreement put to a third reading of the mail\n" + line());
  if (!settled.size) {
    console.log("  not settled yet — run: npx tsx study/real.ts --settle");
  } else {
    const tally: Record<string, { engine: number; standard: number; ambiguous: number }> = {};
    const engineWrongThreads = new Set<string>();
    for (const [id, row] of settled) {
      if (row.error) continue;
      // A ruling made before the portal class was understood is a ruling about
      // an email whose meaning is not in the email. Discarded, not re-scored.
      if (isPortalNotification(byId.get(id))) continue;
      for (const r of row.rulings ?? []) {
        tally[r.field] ??= { engine: 0, standard: 0, ambiguous: 0 };
        if (r.winner === "engine") tally[r.field].engine++;
        else if (r.winner === "standard") { tally[r.field].standard++; engineWrongThreads.add(id); }
        else tally[r.field].ambiguous++;
      }
    }
    console.log(`  ${"field".padEnd(16)} ${"engine right".padStart(13)} ${"engine wrong".padStart(13)} ${"ambiguous".padStart(11)}`);
    for (const [f, t] of Object.entries(tally).sort((a, b) => (b[1].standard) - (a[1].standard))) {
      console.log(`  ${f.padEnd(16)} ${String(t.engine).padStart(13)} ${String(t.standard).padStart(13)} ${String(t.ambiguous).padStart(11)}`);
    }

    /**
     * THE GROUNDED NUMBER for this leg.
     *
     * A thread counts as handled correctly when nothing about it was ruled
     * against the engine — either the two readings agreed, or the third reading
     * said the engine was right, or it said the mail genuinely does not settle
     * it. An ambiguous field is deliberately NOT counted against the engine: a
     * thread a competent person could read either way is not a defect, and
     * scoring it as one would inflate the fault list with work nobody can do.
     */
    const clean = usable.filter((id) => !engineWrongThreads.has(id));
    console.log(`\n  REAL-MAIL ACCURACY        ${pct(clean.length, usable.length)}   ${clean.length}/${usable.length} threads with nothing ruled against the engine`);
    const strict = usable.filter((id) => (perThread[id] ?? []).length === 0);
    console.log(`  (strict, no adjudication) ${pct(strict.length, usable.length)}   ${strict.length}/${usable.length} threads where the two readings agreed outright`);

    console.log("\n" + line() + "\n  WHERE THE ENGINE WAS RULED WRONG\n" + line());
    let shown = 0;
    for (const [id, row] of settled) {
      const bad = (row.rulings ?? []).filter((r: any) => r.winner === "standard");
      if (!bad.length || shown >= 20) continue;
      shown++;
      const t = byId.get(id)!;
      console.log(`\n  ${id} [${t.stratum}, ${t.message_count} msg] "${t.subject.slice(0, 58)}"`);
      for (const r of bad) {
        const d = row.disputed?.[r.field];
        console.log(`     ${r.field}: engine ${JSON.stringify(d?.engine)} / reading ${JSON.stringify(d?.standard)}`);
        console.log(`       -> ${r.reason}`);
      }
    }
  }
  console.log("");
}

// Wrapped rather than top-level await: the other study files are ESM and this
// one is transformed to CJS by tsx, which rejects a top-level await outright.
(async () => {
  if (has("--sample")) await sample();
  else if (has("--adjudicate")) await adjudicate();
  else if (has("--engine")) await engineRun();
  else if (has("--settle")) await settle();
  else if (has("--report")) report();
  else console.log("pass --sample | --adjudicate | --engine | --settle | --report");
})();
