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
type Amendment = (typeof AMENDMENTS)[number];

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
    case "grow": b[0].size = b[0].size + 3; return b;
    case "shrink": b[0].size = Math.max(1, b[0].size - 1); return b;
    case "move-start": b[0].start = b[0].start ? "07:00" : undefined; return b;
    case "move-end": b[0].end = b[0].end ? "20:00" : undefined; return b;
    case "venue": b[0].venue = VENUES[(i + 1) % VENUES.length].text; return b;
    case "profession": b[0].prof = PROFS[(i + 2) % PROFS.length]; return b;
    case "rename": b[0].task = `${b[0].task} — revised brief`; return b;
    case "add-block":
      b.push({ ...b[0], size: 2, task: "late addition", start: "18:00", end: "22:00" });
      return b;
    case "drop-block":
      // Only a real drop when there is more than one block; otherwise it degrades to a
      // resize, and the results record which it actually was.
      return b.length > 1 ? b.slice(0, -1) : [{ ...b[0], size: Math.max(1, b[0].size - 1) }];
  }
}

/** What SHOULD happen, worked out from the case rather than read off the engine. */
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
    // Only a moved end time is provable: the job window is derived from the blocks and is
    // the only field that cannot lie about them.
    provable: c.amend === "move-end" || c.amend === "move-start" || c.amend === "add-block",
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

