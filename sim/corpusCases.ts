// ============================================================================
// The corpus cases: the factor grid, the emails it generates, and the expectation.
// ----------------------------------------------------------------------------
// SPLIT OUT OF sim/corpus.ts so it can be imported WITHOUT running anything. The runner
// is a top-level IIFE that talks to OnSinch on import; the pricing script needs the same
// 500 emails and must not create a single order to get them.
//
// Pure. No I/O, no clock, no randomness — the same n produces the same cases on any
// machine, which is what makes one run comparable to the next.
// ============================================================================
import type { ConversationFacts } from "../app/lib/engine/types";

export const COMPANY_NAME = "TEST - Eventz";
export const COMPANY_ID = 515;
export const CONTACT = "bookings@test-eventz-sim.co.uk";

// ---------------------------------------------------------------- the factor grid
// Crossed, not sampled. Every rule in this engine lives at a boundary, and a boundary is
// not something a sample finds — it is something a design puts a case on either side of.
const SIZES = [1, 2, 3, 4, 5, 9, 10, 11, 19, 20, 21, 30, 40];
const VENUES = [
  { key: "rich", text: "The O2, Peninsula Square, SE10 0DX" },
  { key: "shell", text: "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL" },
  { key: "alias", text: "RAH" },
  { key: "rich2", text: "Olympia London, Hammersmith Road, London W14 8UX" },
  { key: "new", text: "Thornbury Assembly Rooms, 14 Kestrel Way, Thornbury BS35 2QQ" },
];
const PROFS = ["crew", "carpenters", "riggers", "forklift drivers", "porters", "IPAF 3a/3b operators"];
const SHIFTS = [
  { key: "short", start: "09:00", end: "12:00" },
  { key: "eight", start: "08:00", end: "16:00" },
  { key: "long", start: "06:00", end: "19:00" },
  { key: "overnight", start: "20:00", end: "02:00" },
];
const TASKS = [
  { key: "plain", text: "exhibition stand build" },
  { key: "punct", text: "get-in & de-rig — stage left / stage right" },
  { key: "at80", text: "x".repeat(80) },
  { key: "at81", text: "y".repeat(81) },
];
const BLOCK_COUNTS = [1, 1, 2, 3];
/**
 * "none" leaves both times off. It does NOT hold: the engine defaults to 08:00-18:00 and
 * records the assumption in a note. What actually holds a thread is a missing DATE — see
 * DATE_STATED — and the first pilot's expectation had these two confused.
 */
const TIME_STATED = ["full", "full", "full", "start-only", "none"];
/** Every fifth case says "date still TBC", which has no window and must HOLD. */
const DATE_STATED = [true, true, true, true, false];
const AMENDMENTS = ["grow", "shrink", "move-start", "move-end", "venue", "profession", "rename", "add-block", "drop-block"] as const;
/**
 * `compound` is not in AMENDMENTS because it is not part of the crossed grid — one
 * factor per case is what makes a failure attributable. It belongs to the complex and
 * monster cases below, where the question is the opposite: does a single email carrying
 * six different changes at once still land every one of them.
 */
type Amendment = (typeof AMENDMENTS)[number] | "compound";

export interface Block { size: number; prof: string; start?: string; end?: string; task: string; venue?: string; date: string; dated: boolean }
export interface Case {
  id: string;
  factors: Record<string, string | number | boolean>;
  blocks: Block[];
  amend: Amendment | null;
  amended: Block[] | null;
}

/**
 * The cases, built by walking the factors rather than drawing from them.
 *
 * Index arithmetic, not a random seed: the same n produces the same 500 cases on any
 * machine and in any order, which is what makes a later run comparable to this one.
 */
export function buildCases(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const size = SIZES[i % SIZES.length];
    const venue = VENUES[(i * 3) % VENUES.length];
    const prof = PROFS[(i * 5) % PROFS.length];
    const shift = SHIFTS[(i * 7) % SHIFTS.length];
    const task = TASKS[(i * 11) % TASKS.length];
    const nBlocks = BLOCK_COUNTS[(i * 13) % BLOCK_COUNTS.length];
    const times = TIME_STATED[(i * 17) % TIME_STATED.length];
    const dated = DATE_STATED[(i * 19) % DATE_STATED.length];
    /**
     * ONE DISTINCT DAY PER CASE, and this is load-bearing.
     *
     * The first 500-case run gave day = 1 + i%27 and month = 3 + i%9 — periods that share a
     * factor, so the whole study ran on 27 dates. Every case after the first on a date was
     * matched by the (company, date) dedup to the order the earlier case had raised, and
     * patched it. 500 cases created 27 orders and the run measured deduplication.
     *
     * Every case is on the ONE test company, so the date is the only thing separating one
     * booking from another. i days from a fixed epoch guarantees that.
     */
    const epoch = Date.UTC(2027, 2, 1);
    const d = new Date(epoch + i * 86400000);
    const date = d.toISOString().slice(0, 10);

    const blocks: Block[] = [];
    for (let b = 0; b < nBlocks; b++) {
      blocks.push({
        size: b === 0 ? size : Math.max(1, Math.round(size / 2)),
        prof: b === 0 ? prof : PROFS[(i + b) % PROFS.length],
        start: times === "none" ? undefined : b === 0 ? shift.start : "18:00",
        end: times === "none" || times === "start-only" ? undefined : b === 0 ? shift.end : "22:00",
        task: b === 0 ? task.text : `${task.text} (part ${b + 1})`,
        dated,
        // Per-block venues on every third multi-block case: crew moving between sites.
        venue: nBlocks > 1 && i % 3 === 0 ? VENUES[(i + b) % VENUES.length].text : undefined,
        date,
      });
    }

    // The amended half, spread evenly across the nine shapes.
    const isAmended = i % 2 === 1;
    const amend: Amendment | null = isAmended ? AMENDMENTS[Math.floor(i / 2) % AMENDMENTS.length] : null;
    out.push({
      id: `C${String(i).padStart(3, "0")}-${amend ?? "plain"}`,
      factors: {
        size, venue: venue.key, prof, shift: shift.key, task: task.key,
        blocks: nBlocks, times, dated, amended: isAmended, amendment: amend ?? "",
      },
      blocks,
      amend,
      amended: amend ? applyAmendment(blocks, amend, i) : null,
    });
    // The venue lives on the order when it is not per-block.
    (out[out.length - 1].factors as Record<string, unknown>).venueText = venue.text;
  }
  return out;
}

/** The second email's blocks. Pure — the expectation is derived from the same function. */
function applyAmendment(blocks: Block[], shape: Amendment, i: number): Block[] {
  const b = blocks.map((x) => ({ ...x }));
  switch (shape) {
    /**
     * EVERY SHAPE BELOW MUST PRODUCE A REAL CHANGE, AND FOUR OF THEM DID NOT.
     *
     * Measured on the 106-case run of 2026-08-25: 9 of 43 amendments were scored as the
     * engine "falling back to a human" when the truth was that the amended blocks
     * composed to a BYTE-IDENTICAL slot-team set — planAmendment planned 0 patches and 0
     * appends. The engine was right and the ruler was wrong, which is the failure mode
     * this account has been burned by before (a matcher study scored 98.7% self-match and
     * 45.9% on real queries).
     *
     * The three ways a no-op was being generated:
     *   - move-start / move-end on a case whose times are NOT STATED: `b[0].start ?
     *     "07:00" : undefined` left undefined as undefined.
     *   - shrink on a block of 1: `Math.max(1, 1 - 1)` is 1.
     *   - profession rotating between two roles the tenant does not have. "riggers" and
     *     "porters" both resolve to Crew (id 1), so the composed team never moved.
     *
     * A case that cannot express its own shape is not evidence about the engine either
     * way, so each one now forces the change instead of silently declining to make it.
     */
    case "grow": b[0].size = b[0].size + 3; return b;
    case "shrink": {
      // Shrink whichever block has the room. A block of 1 cannot shrink, and picking it
      // anyway is what produced a no-op scored as a failure.
      const target = b.reduce((best, x, idx) => (x.size > b[best].size ? idx : best), 0);
      if (b[target].size > 1) b[target].size = b[target].size - 1;
      else b[target].size = b[target].size + 1; // nothing to shrink; still a real change
      return b;
    }
    case "move-start": b[0].start = b[0].start === "07:00" ? "06:00" : "07:00"; return b;
    case "move-end": b[0].end = b[0].end === "20:00" ? "21:00" : "20:00"; return b;
    case "venue": b[0].venue = VENUES[(i + 1) % VENUES.length].text; return b;
    case "profession": {
      /**
       * Only roles the tenant actually holds as DISTINCT professions. The grid's PROFS
       * deliberately includes unrecognised trades ("riggers", "porters") because falling
       * back to Crew is a behaviour worth testing — but rotating BETWEEN two of them
       * changes nothing, so an amendment must not draw from that list.
       */
      const DISTINCT = ["crew", "carpenters", "forklift drivers", "IPAF 3a/3b operators"];
      const current = b[0].prof;
      b[0].prof = DISTINCT.filter((p) => p !== current)[i % (DISTINCT.length - 1)];
      return b;
    }
    case "rename": b[0].task = `${b[0].task} — revised brief`; return b;
    case "add-block":
      b.push({ ...b[0], size: 2, task: "late addition", start: "18:00", end: "22:00" });
      return b;
    case "drop-block":
      // Only a real drop when there is more than one block; otherwise it degrades to a
      // resize, and the results record which it actually was.
      return b.length > 1 ? b.slice(0, -1) : [{ ...b[0], size: Math.max(1, b[0].size - 1) }];
    /**
     * SIX CHANGES IN ONE EMAIL, which is what a real client sends when a job moves.
     *
     * Deliberately excludes a DROP: every other change here amends in place, and a drop
     * would force the whole thing down the delete-and-repost path, so the case would stop
     * testing the amendment ladder and start testing the rebuild. The drop-on-a-monster
     * question is asked separately, by the monster whose amend IS "drop-block".
     */
    case "compound": {
      b[0].size = b[0].size + 4;                                  // grow
      if (b[1]) b[1].size = Math.max(1, b[1].size - 2);           // shrink another
      if (b[2]) b[2].start = "05:30";                             // move a start
      if (b[3]) b[3].end = "23:30";                               // move an end
      if (b[4]) b[4].task = `${b[4].task} — revised brief`;       // rename
      if (b[5]) b[5].venue = VENUES[(i + 1) % VENUES.length].text; // move one block's venue
      if (b[6]) b[6].prof = PROFS[(i + 3) % PROFS.length];        // change a role
      b.push({ ...b[0], size: 3, task: "late addition A", start: "18:00", end: "22:00" });
      b.push({ ...b[0], size: 2, task: "late addition B", start: "23:00", end: "03:00" }); // overnight
      return b;
    }
  }
}

// ---------------------------------------------------------------- complex + monsters
/**
 * WHY THESE ARE SEPARATE FROM THE GRID.
 *
 * The crossed grid moves one factor at a time on purpose, so a failure names its own
 * cause. These do the opposite deliberately: many blocks, mixed professions, mixed
 * venues, an overnight in the middle, an over-length task, and an amendment that changes
 * six things at once. They exist to answer "does it hold together at scale", which a
 * one-factor design cannot ask.
 *
 * Ben, 2026-08-25: "Create more complex jobs and ammendments too, and also two
 * rediculously complex ones ... (12+ slot teams)".
 *
 * Sizes are chosen to straddle the chief bands (4/10/20) WITHIN one order, so a single
 * order carries blocks needing 0, 1, 2 and 3 chiefs. That is the interaction the grid
 * cannot reach, because there every block in a case shares one size class.
 */
const COMPLEX_SHAPES = [
  { key: "complex-4", blocks: 4, amend: "compound" as Amendment },
  { key: "complex-6", blocks: 6, amend: "compound" as Amendment },
  { key: "complex-8", blocks: 8, amend: "drop-block" as Amendment },
  { key: "complex-8b", blocks: 8, amend: "add-block" as Amendment },
  { key: "MONSTER-12", blocks: 12, amend: "compound" as Amendment },
  { key: "MONSTER-16", blocks: 16, amend: "drop-block" as Amendment },
];

/** Sizes that put blocks either side of every chief band inside ONE order. */
const MONSTER_SIZES = [1, 3, 4, 5, 9, 10, 11, 19, 20, 21, 30, 2, 6, 12, 25, 40];

export function buildComplexCases(): Case[] {
  // Dates continue past the grid's epoch window so a complex case can never collide with
  // a grid case on (company, date) and be swallowed by the dedup.
  const epoch = Date.UTC(2028, 5, 1);
  return COMPLEX_SHAPES.map((shape, ci) => {
    const date = new Date(epoch + ci * 7 * 86400000).toISOString().slice(0, 10);
    const blocks: Block[] = [];
    for (let b = 0; b < shape.blocks; b++) {
      const shift = SHIFTS[b % SHIFTS.length]; // includes the overnight 20:00-02:00
      blocks.push({
        size: MONSTER_SIZES[b % MONSTER_SIZES.length],
        prof: PROFS[b % PROFS.length],
        start: shift.start,
        end: shift.end,
        // Every fourth block carries an over-length task, so the 80-char cap is exercised
        // repeatedly within one order rather than once across the study.
        task: b % 4 === 3 ? "z".repeat(81) : `${TASKS[b % TASKS.length].text} (call ${b + 1})`,
        dated: true,
        // Per-block venues throughout: crew moving between sites is the whole point of a
        // multi-block order, and it is the field no read can verify (§ PROVEN vs ACCEPTED).
        venue: VENUES[b % VENUES.length].text,
        date,
      });
    }
    return {
      id: `X${String(ci).padStart(2, "0")}-${shape.key}`,
      factors: {
        size: blocks.reduce((n, x) => n + x.size, 0),
        venue: "per-block", prof: "mixed", shift: "mixed", task: "mixed",
        blocks: shape.blocks, times: "full", dated: true,
        amended: true, amendment: shape.amend, complex: true,
        venueText: VENUES[0].text,
      },
      blocks,
      amend: shape.amend,
      amended: applyAmendment(blocks, shape.amend, ci),
    };
  });
}

/** What SHOULD happen, worked out from the case rather than read off the engine. */
/**
 * The job window a block set produces, as "earliest..latest", or null when no block
 * states a time. Mirrors compose.ts: a finish at or before the start is an overnight
 * shift and belongs to the next day, so a 20:00-02:00 block extends the window past
 * midnight rather than running backwards.
 */
function windowOf(blocks: Block[]): string | null {
  const mins = (t?: string) => {
    const m = t ? /^(\d{1,2}):(\d{2})$/.exec(t) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const stamps: number[] = [];
  for (const b of blocks) {
    if (!b.dated) continue;
    const day = Date.parse(`${b.date}T00:00:00Z`);
    if (!Number.isFinite(day)) continue;
    // The engine's defaults, so the predicted window matches the one it books.
    const s = mins(b.start) ?? 8 * 60;
    const eRaw = mins(b.end) ?? 18 * 60;
    const e = eRaw <= s ? eRaw + 24 * 60 : eRaw;
    stamps.push(day + s * 60000, day + e * 60000);
  }
  if (!stamps.length) return null;
  return `${Math.min(...stamps)}..${Math.max(...stamps)}`;
}

export function expected(c: Case) {
  // A block with no DATE has no window to book, so the thread must hold. Missing times
  // are different: the engine defaults them and says so.
  const tbc = c.blocks.some((b) => !b.dated);
  return {
    holds: tbc,
    requested: c.blocks.reduce((n, b) => n + b.size, 0),
    // A dropped block cannot be expressed against OnSinch — DELETE /slotTeams is 405 —
    // so it must fall back to delete-and-repost and the R number must change.
    expectsReplace: c.amend === "drop-block" && c.blocks.length > 1,
    /**
     * PROVABLE MEANS THE WINDOW MUST MOVE — not that the shape usually moves it.
     *
     * The job window (`min_beginning` / `max_end`) is the only oracle OnSinch offers that
     * cannot lie, because it is derived from the blocks. But it can only speak when the
     * amendment actually changes one of its two ends.
     *
     * This used to be `move-end || move-start || add-block`, which over-claims. A block
     * appended INSIDE the existing window moves neither end, so the window stays put and
     * the case was scored as the engine claiming something it had not done. On the
     * 2026-08-25 run that produced 4 false accusations out of 15 — and a hypothesis that
     * can never read READY is a hypothesis nobody will notice failing for a real reason.
     *
     * Computed from the blocks instead of assumed from the shape.
     */
    provable: windowOf(c.blocks) !== null && c.amended !== null && windowOf(c.amended) !== windowOf(c.blocks),
    amendedRequested: c.amended ? c.amended.reduce((n, b) => n + b.size, 0) : null,
  };
}

// ---------------------------------------------------------------- one case, end to end
export const bodyFor = (c: Case, blocks: Block[], kind: "new" | "amend") => {
  const lead = kind === "new" ? "Hi, we'd like to book crew." : "Following up — please update the booking.";
  const lines = blocks.map((b) => {
    const when = b.start && b.end ? ` from ${b.start} to ${b.end}` : b.start ? ` starting ${b.start}` : " (times TBC)";
    const day = b.dated ? ` on ${b.date}` : " (date still TBC)";
    return `- ${b.size} x ${b.prof}${day}${when}${b.venue ? ` at ${b.venue}` : ""} — ${b.task}`;
  });
  return `${lead}\n${lines.join("\n")}\n\nThanks`;
};

export const factsFor = (c: Case, blocks: Block[]): ConversationFacts => ({
  company_name: COMPANY_NAME,
  contact_name: "Corpus Contact",
  contact_email: CONTACT,
  location_text: String(c.factors.venueText),
  requests: blocks.map((b) => ({
    ...(b.dated ? { date: b.date } : {}),
    ...(b.start ? { start_time: b.start } : {}),
    ...(b.end ? { end_time: b.end } : {}),
    size: b.size,
    task: b.task,
    profession_hint: b.prof,
    ...(b.venue ? { location_text: b.venue } : {}),
  })),
});

