// ============================================================================
// Sort the swept corpus: real jobs, updates, cancellations, junk — with dates.
// ----------------------------------------------------------------------------
// This is the first half of the validation pass. Before anything can be compared to
// the OnSinch jobs these enquiries became, the corpus has to be sorted, and each real
// enquiry has to yield the work blocks it asked for with a START and a FINISH.
//
// It uses the ENGINE'S OWN brain — reasoner.classify + reasoner.extractFacts — not a
// new prompt written for the study. The point is to measure the thing that will run
// in production; a bespoke classifier would score itself, not the engine.
//
// START AND FINISH. The engine returns a date plus optional times. The live
// "Spartan Crew Bookings v1.2" workflow defines what to do when a time is missing,
// and this follows it exactly rather than inventing a convention:
//   beginning = date + start_time, or 08:00 when no start time is given
//   end       = date + end_time,   or 18:00 when no end time is given
// Those times are UK LOCAL, stamped with the offset in force on the day — see ukOffset.
// A request with no date at all is kept and marked date_confirmed:false — the
// workflow's rule is to keep a TBC block rather than drop the request.
//
// CANCELLATIONS. The engine's Classification has no cancellation class — it is
// new-job | update | confirmation-only | not-a-job. Ben asked for cancellations as a
// category, so this asks the same model one narrow extra question per thread and
// records the answer in its own column. That is a finding about the engine, not a
// change to it: the gap is recorded here, not patched behind anyone's back.
//
// COST. Two model calls per thread, plus a third for the cancellation question.
// A full pass over thousands of threads is real money, so the default is a small
// batch and already-labelled threads are skipped, making an interrupted pass resume.
//
//   npx tsx scripts/classify-corpus.ts --limit 10 --dry     # print, write nothing
//   npx tsx scripts/classify-corpus.ts --limit 100          # label and store
//   npx tsx scripts/classify-corpus.ts --tally              # what is labelled so far
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import type { ThreadMessage } from "../app/lib/engine/types";
import { unlabelledThreads, storeLabel, labelTally, type WorkBlock } from "../app/lib/sweepLabelsDb";

loadEnv();
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const num = (name: string, dflt: number) => {
  const i = argv.indexOf(name);
  if (i < 0) return dflt;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : dflt;
};

const DRY = flag("--dry");
const TALLY = flag("--tally");
const LIMIT = num("--limit", 10);
const MODEL = process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.8";

async function main() {
if (TALLY) {
  const t = await labelTally();
  console.log(`\nlabelled: ${t.total} thread(s)   cancellations: ${t.cancellations}   with work blocks: ${t.withBlocks}   errors: ${t.errors}`);
  for (const r of t.byClass) console.log(`  ${String(r.classification ?? "(none)").padEnd(20)} ${r.n}`);
  console.log();
  return;
}

const reasoner = createOpenRouterReasoner({ apiKey: requireEnv("OPENROUTER_API_KEY"), model: MODEL });

/** The corpus stores messages in the engine's own inbound shape already. */
function messagesOf(payload: { messages?: unknown[] }): ThreadMessage[] {
  const raw = Array.isArray(payload?.messages) ? payload.messages : [];
  return raw
    .map((m) => m as Record<string, unknown>)
    .map((m) => ({
      message_id: String(m.message_id ?? ""),
      from: String(m.from ?? ""),
      to: Array.isArray(m.to) ? (m.to as string[]) : [],
      date_iso: String(m.date_iso ?? ""),
      subject: String(m.subject ?? ""),
      body: String(m.body ?? ""),
      // The sweep records this per message; fall back to the address so a thread
      // captured before that field existed still reads Spartan's own replies right.
      is_from_spartan: typeof m.is_from_spartan === "boolean"
        ? m.is_from_spartan
        : /@spartancrew\.co\.uk/i.test(String(m.from ?? "")),
    }))
    .filter((m) => m.body || m.subject);
}

/**
 * Is this instant inside British Summer Time? Same rule the live workflow's
 * Conversational Renderer uses: last Sunday of March 01:00 UTC to last Sunday of
 * October 01:00 UTC. A client writing "8am" means 8am in London, so a block stamped
 * +00:00 all year is an hour wrong for roughly half the corpus — which would put every
 * summer shift's start and finish an hour early against the OnSinch job it became.
 */
function ukOffset(dateStr: string): "+01:00" | "+00:00" {
  const lastSunday = (year: number, monthIdx: number) => {
    const endOfMonth = new Date(Date.UTC(year, monthIdx + 1, 0));
    return endOfMonth.getUTCDate() - endOfMonth.getUTCDay();
  };
  const t = Date.parse(`${dateStr}T12:00:00Z`);
  const y = new Date(t).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1, 0);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1, 0);
  return t >= start && t < end ? "+01:00" : "+00:00";
}

/**
 * A request from the engine's facts -> a work block with a real start and finish,
 * using the live workflow's defaults for a missing time. Kept here rather than in the
 * engine because it describes how the STUDY reads the engine's output.
 */
function toBlock(r: { date?: string; start_time?: string; end_time?: string; size?: number; task?: string }): WorkBlock | null {
  const time = (t: string | undefined, dflt: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
    if (!m) return dflt;
    return `${m[1].padStart(2, "0")}:${m[2]}:00`;
  };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? "")) ? String(r.date) : null;
  const start = time(r.start_time, "08:00:00");
  const end = time(r.end_time, "18:00:00");
  if (!date) {
    // No date is still a request — the workflow's rule is to keep a TBC block. There
    // is nothing to anchor it to, so it carries no instants and says so.
    return { name: r.task, beginning: "", end: "", size: r.size, task: r.task, date_confirmed: false };
  }
  const off = ukOffset(date);
  let beginning = `${date}T${start}${off}`;
  let finish = `${date}T${end}${off}`;
  // An overnight block ("22:00 to 06:00") ends the following day. Without this the
  // finish lands before the start and the shift reads as negative length.
  if (Date.parse(finish) <= Date.parse(beginning)) {
    const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    finish = `${next}T${end}${ukOffset(next)}`;
  }
  return { name: r.task, beginning, end: finish, size: r.size, task: r.task, date_confirmed: true };
}

/** The one question the engine's taxonomy cannot answer. */
const CANCELLATION_SYSTEM = [
  "You decide one thing only: does this email thread CANCEL work that was previously requested or booked?",
  "True only for an actual cancellation or a call-off of the whole job — 'we no longer need the crew',",
  "'the job is off', 'please cancel Saturday'. A postponement to a new date is NOT a cancellation.",
  "Reducing crew numbers or moving a time is NOT a cancellation — that is an amendment.",
  "Answer with the tool.",
].join(" ");

async function isCancellation(latest: ThreadMessage, history: ThreadMessage[]): Promise<boolean> {
  // Same OpenRouter contract the reasoner uses, one narrow schema.
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(Number(process.env.REASONER_TIMEOUT_MS || 25_000)),
    headers: {
      Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://spartan-crew-jobber.vercel.app",
      "X-Title": "Spartan Crew Jobber (corpus study)",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: CANCELLATION_SYSTEM },
        { role: "user", content: `LATEST (${latest.date_iso}) from ${latest.from}\nSubject: ${latest.subject}\n${latest.body}\n\nHISTORY:\n${history.map((m) => `[${m.date_iso}] ${m.from}: ${m.body}`).join("\n").slice(0, 12_000)}` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "emit",
          parameters: {
            type: "object",
            properties: { cancels: { type: "boolean" }, why: { type: "string" } },
            required: ["cancels"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "emit" } },
    }),
  });
  if (!res.ok) throw new Error(`cancellation check ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  const parsed = typeof args === "string" ? JSON.parse(args) : args;
  return !!parsed?.cancels;
}

const threads = await unlabelledThreads(MODEL, LIMIT);
console.log(`\nmodel: ${MODEL}`);
console.log(`${threads.length} unlabelled thread(s) to sort${DRY ? "  (DRY RUN — nothing stored)" : ""}\n`);
if (!threads.length) {
  console.log("nothing left to label for this model. --tally shows what is done.\n");
  return;
}

let done = 0, failed = 0;
const tally: Record<string, number> = {};
for (const t of threads) {
  const messages = messagesOf(t.payload || {});
  if (!messages.length) {
    if (!DRY) await storeLabel({ thread_id: t.thread_id, model: MODEL, error: "no readable messages in payload" });
    failed++;
    console.log(`  ${t.thread_id}  SKIP  no readable messages`);
    continue;
  }
  const latest = messages[messages.length - 1];
  const history = messages.slice(0, -1);

  try {
    // priorOrderExists is unknowable from the corpus alone — the thread is being read
    // cold, months later, with no ticket. false is the honest input, and it is also
    // what the engine sees for a thread it has never met.
    const cls = await reasoner.classify(latest, history, false);
    const facts = await reasoner.extractFacts(latest, history);
    const cancels = await isCancellation(latest, history);

    const blocks = (facts.requests || []).map(toBlock).filter((b): b is WorkBlock => !!b);
    // Peak crew is the answer to "how many people", crew-days to "how much work".
    // Summing sizes conflates them and inflates any multi-day job.
    const sizes = blocks.map((b) => Number(b.size) || 0);
    const crew = sizes.length ? Math.max(...sizes) : 0;
    const crewDays = sizes.reduce((n, s) => n + s, 0);
    tally[cls.classification] = (tally[cls.classification] || 0) + 1;

    if (!DRY) {
      await storeLabel({
        thread_id: t.thread_id,
        model: MODEL,
        classification: cls.classification,
        is_cancellation: cancels,
        priority: cls.priority,
        job_summary: cls.job_summary,
        company_name: facts.company_name,
        location_text: facts.location_text,
        blocks,
        crew_peak: crew || undefined,
        crew_days: crewDays || undefined,
      });
    }

    const dated = blocks.filter((b) => b.date_confirmed);
    const span = dated.length
      ? `${dated[0].beginning.slice(0, 16)} -> ${dated[dated.length - 1].end.slice(0, 16)}`
      : blocks.length ? "date TBC" : "no blocks";
    console.log(
      `  ${t.thread_id}  ${cls.classification.padEnd(18)}${cancels ? "CANCELS  " : "         "}` +
      `crew=${String(crew || "-").padEnd(4)} ${span}   ${String(t.subject ?? "").slice(0, 40)}`
    );
    done++;
  } catch (e) {
    failed++;
    const msg = (e as Error).message.slice(0, 160);
    if (!DRY) await storeLabel({ thread_id: t.thread_id, model: MODEL, error: msg });
    console.log(`  ${t.thread_id}  ERROR  ${msg}`);
  }
}

console.log(`\nsorted ${done}, failed ${failed}`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
if (!DRY) {
  const all = await labelTally(MODEL);
  console.log(`\ncorpus labelled so far: ${all.total} thread(s), ${all.cancellations} cancellation(s), ${all.withBlocks} with work blocks, ${all.errors} error(s)\n`);
}

}

main().catch((e) => { console.error(e); process.exitCode = 1; });
