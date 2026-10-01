// ============================================================================
// resolver — which job a message belongs to, decided without a model (design §9).
// ----------------------------------------------------------------------------
// v0, SHADOW ONLY (Ben, 2026-09-29: steps 3-5 shadow only). Nothing reads its answer
// to decide anything; scripts/resolver-shadow.mts replays history through it and counts.
//
// The model extracts and code decides: every input here is a plain fact about the
// message or a job, and the procedure is §9.2 as written — party, hard reference,
// thread continuity, cross-thread — with a veto beating any positive and two strong
// items that disagree giving UNCERTAIN. It never continues on company alone, subject
// alone, or temporal proximity alone.
//
// v0 limits, stated rather than hidden: change language and new-engagement language are
// word patterns, standing in for the step-6 extraction that will carry quotes.
// ============================================================================
import { rNumbersIn } from "./resolve";

export interface JobView {
  job_key: string;
  company_id?: number;
  /** Requested work days, YYYY-MM-DD. */
  days: string[];
  place_ids: number[];
  /** R numbers of every order the job has ever been linked to. */
  order_numbers: string[];
  /** Requested hours per day, where known. */
  slots?: Slot[];
}

export interface Slot { day: string; start?: string; end?: string }

export interface MessageView {
  thread_id: string;
  company_id?: number;
  /** The sender's own words: quoted tail and signature removed (normalize.cleanEmailBody). */
  own_text: string;
  days: string[];
  place_id?: number;
  asks_for_crew: boolean;
  /** Source time, ISO. Every lookup is as of this instant. */
  at: string;
  slots?: Slot[];
}

export type Evidence = { kind: "hard" | "strong" | "weak" | "veto" | "contradiction"; what: string };

export type Outcome =
  | { kind: "CONTINUE"; job: string; evidence: Evidence[] }
  | { kind: "NEW"; client: "existing" | "new"; evidence: Evidence[] }
  | { kind: "UNCERTAIN"; candidates: string[]; probable?: string; reason: string; evidence: Evidence[] }
  | { kind: "NOT_A_JOB"; evidence: Evidence[] };

/** A job stays open this long after its last work day: 178 of 182 threads end inside it. */
export const TAIL_DAYS = 14;
const DAY_MS = 86_400_000;

const CHANGE = /\b(instead|change|move|moving|moved|make it|swap|push(?:ed)? back|bring forward|reduce|increase|extra|additional|one more|amend)/i;
const NEW_ENGAGEMENT = /\b(another (?:event|job|show|booking)|new (?:event|job|booking|enquiry)|next year|separate (?:job|event|booking))/i;

const toMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const lastDay = (j: JobView) => j.days.reduce<number>((m, d) => Math.max(m, toMs(d)), -Infinity);
const shares = (a: string[], b: string[]) => a.some((d) => b.includes(d));

/**
 * The venues the engine reaches for when a thread names none — 2069 "London", 6922 "No
 * Location", 87 "Location", 6581 "warehouse" (measured in resolve.ts). Not a venue, so
 * two threads on one are not "the same venue": Ben ruled two Solotech threads, both on
 * 6922, separate jobs (shadow review r2, 2026-10-01).
 */
export const PLACEHOLDER_PLACE_IDS = new Set([2069, 6922, 87, 6581]);

/**
 * "Same day" for the cross-thread match: the shared days cover at least half of the
 * shorter thread's days. Two six-day Drumsheds runs touching on the boundary day were
 * merged on that one day; Ben ruled them separate (r7). A one-day request inside a
 * five-day job still counts (r4, ruled the same job).
 */
const overlapsEnough = (a: string[], b: string[]) => {
  const shared = new Set(a.filter((d) => b.includes(d))).size;
  return shared > 0 && shared * 2 >= Math.min(new Set(a).size, new Set(b).size);
};
const within = (a: string[], b: string[], days: number) => a.some((x) => b.some((y) => Math.abs(toMs(x) - toMs(y)) <= days * DAY_MS));
const isOpen = (j: JobView, at: string) => !j.days.length || lastDay(j) + TAIL_DAYS * DAY_MS >= Date.parse(at);

/**
 * Same day, both sides give their hours, and no pair of windows overlaps. One agency ran
 * KNWLS 18:30-20:30 and Chopova Lowena 09:30-13:30 + 21:00-00:00 at one venue on
 * 19 Sep 2026: two jobs that company + day + venue alone would have merged.
 */
const minutes = (t?: string) => (t && /^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : undefined);
function hoursApart(a: Slot[] = [], b: Slot[] = [], days: string[]): boolean {
  let compared = false;
  for (const d of days) {
    const wa = a.filter((s) => s.day === d && minutes(s.start) !== undefined && minutes(s.end) !== undefined);
    const wb = b.filter((s) => s.day === d && minutes(s.start) !== undefined && minutes(s.end) !== undefined);
    if (!wa.length || !wb.length) return false; // hours unknown on a shared day: no evidence either way
    compared = true;
    const span = (s: Slot) => { const x = minutes(s.start)!, y = minutes(s.end)!; return [x, y <= x ? y + 1440 : y] as const; };
    if (wa.some((x) => wb.some((y) => { const [a0, a1] = span(x), [b0, b1] = span(y); return a0 < b1 && b0 < a1; }))) return false;
  }
  return compared;
}

export function resolveMessage(m: MessageView, jobs: JobView[], threadJob?: string): Outcome {
  const ev: Evidence[] = [];
  const changes = CHANGE.test(m.own_text);
  const fresh = NEW_ENGAGEMENT.test(m.own_text);

  // 0. Party.
  if (!m.company_id) {
    return m.asks_for_crew
      ? { kind: "NEW", client: "new", evidence: [{ kind: "weak", what: "no company resolved; a crew request from a new client" }] }
      : { kind: "NOT_A_JOB", evidence: [{ kind: "weak", what: "no company and no crew request" }] };
  }
  const ours = jobs.filter((j) => j.company_id === m.company_id);

  // 1. Hard reference: an R number in the sender's own words.
  const tokens = rNumbersIn(m.own_text);
  if (tokens.length) {
    const hit = jobs.filter((j) => j.order_numbers.some((r) => tokens.includes(r)));
    const same = hit.filter((j) => j.company_id === m.company_id);
    if (hit.length && !same.length) {
      return { kind: "UNCERTAIN", candidates: hit.map((j) => j.job_key), reason: "R number belongs to another client", evidence: [{ kind: "veto", what: `R${tokens.join(",R")} is another company's` }] };
    }
    if (same.length > 1) {
      return { kind: "UNCERTAIN", candidates: same.map((j) => j.job_key), reason: "R numbers name several jobs", evidence: [{ kind: "hard", what: `R${tokens.join(",R")}` }] };
    }
    if (same.length === 1) {
      const j = same[0];
      if (fresh && m.days.length && !shares(m.days, j.days)) {
        return { kind: "NEW", client: "existing", evidence: [{ kind: "hard", what: `cites R${tokens.join(",R")}` }, { kind: "contradiction", what: "new engagement on other days: an old job cited for reference" }] };
      }
      return { kind: "CONTINUE", job: j.job_key, evidence: [{ kind: "hard", what: `R${tokens.join(",R")} in the sender's own text` }] };
    }
  }

  // 2. Thread continuity.
  const tj = threadJob ? jobs.find((j) => j.job_key === threadJob) : undefined;
  if (tj) {
    if (tj.company_id && tj.company_id !== m.company_id) {
      return { kind: "UNCERTAIN", candidates: [tj.job_key], reason: "company differs from the thread's job", evidence: [{ kind: "veto", what: "company mismatch" }] };
    }
    if (fresh) return { kind: "NEW", client: "existing", evidence: [{ kind: "contradiction", what: "new-engagement language" }] };
    if (!isOpen(tj, m.at) && m.asks_for_crew) {
      return { kind: "NEW", client: "existing", evidence: [{ kind: "contradiction", what: `thread's job closed ${TAIL_DAYS}d after its last day` }] };
    }
    if (m.days.length && tj.days.length && !shares(m.days, tj.days) && !changes) {
      return within(m.days, tj.days, 7)
        ? { kind: "UNCERTAIN", candidates: [tj.job_key], reason: "other days within 7 of the thread's job, no change language", evidence: [{ kind: "contradiction", what: "disjoint days" }] }
        : { kind: "NEW", client: "existing", evidence: [{ kind: "contradiction", what: "disjoint days outside the job's window" }] };
    }
    return { kind: "CONTINUE", job: tj.job_key, evidence: [{ kind: "strong", what: "same thread, no contradiction" }] };
  }

  // 3. Cross-thread, among this client's open jobs.
  const open = ours.filter((j) => isOpen(j, m.at));
  const venue = m.place_id && !PLACEHOLDER_PLACE_IDS.has(m.place_id) ? m.place_id : undefined;
  if (m.days.length) {
    const sameDay = open.filter((j) => overlapsEnough(m.days, j.days));
    const atVenue = venue ? sameDay.filter((j) => j.place_ids.includes(venue)) : [];
    const sameVenue = atVenue.filter((j) => !hoursApart(m.slots, j.slots, m.days.filter((d) => j.days.includes(d))));
    if (atVenue.length && !sameVenue.length) {
      return { kind: "UNCERTAIN", candidates: atVenue.map((j) => j.job_key), reason: "same day and venue, but none of the hours overlap", evidence: [{ kind: "contradiction", what: "disjoint hours on every shared day" }] };
    }
    if (sameVenue.length === 1) {
      return { kind: "CONTINUE", job: sameVenue[0].job_key, evidence: [{ kind: "strong", what: "same company, day and venue" }] };
    }
    if (sameVenue.length > 1) {
      return { kind: "UNCERTAIN", candidates: sameVenue.map((j) => j.job_key), reason: "several jobs share the day and venue", evidence: [{ kind: "strong", what: "same company, day and venue" }] };
    }
    if (sameDay.length) {
      return venue
        ? { kind: "NEW", client: "existing", evidence: [{ kind: "contradiction", what: "same day, a different known venue: a parallel job" }] }
        : { kind: "UNCERTAIN", candidates: sameDay.map((j) => j.job_key), reason: "same day, venue unknown", evidence: [{ kind: "weak", what: "same company and day" }] };
    }
    return { kind: "NEW", client: "existing", evidence: [{ kind: "weak", what: "no open job of this client shares a day" }] };
  }
  if (m.asks_for_crew) {
    return open.length
      ? { kind: "UNCERTAIN", candidates: open.map((j) => j.job_key), reason: "undated crew request while the client has open jobs", evidence: [] }
      : { kind: "NEW", client: "existing", evidence: [{ kind: "weak", what: "undated crew request, no open job" }] };
  }
  if (open.length === 1) {
    return { kind: "UNCERTAIN", candidates: [open[0].job_key], probable: open[0].job_key, reason: "undated, one open job", evidence: [{ kind: "weak", what: "company only" }] };
  }
  return { kind: "NOT_A_JOB", evidence: [] };
}
