// ============================================================================
// THE DESIRED SHAPE IS A STANDING DECLARATION, NOT A ONE-TIME INSTRUCTION.
// ----------------------------------------------------------------------------
// This engine cannot verify its own writes. Measured on TEST company 515, 2026-09-13: a
// run that appended a block, moved windows, resized up and down and changed venue,
// profession and name produced THREE audit rows, all `order_created_via_api` — zero
// change rows, zero delete rows — while the Job window demonstrably moved. The 203,379
// `common_change` rows in the audit log are a UI-edit signal this engine will never
// produce. So "did my PATCH land?" has no answer, and every design that asks it is
// building on a reading that does not exist.
//
// What DOES exist is the state itself. So the question changes from "did it land" to
// "does OnSinch hold what we want", asked fresh every pass. A PATCH that silently did
// nothing shows up as a difference next sweep and is simply sent again. Safe by
// measurement — the live amend matrix proves re-applying an identical patch is a no-op
// and creates no duplicate — so this converges rather than accumulating.
//
// WHAT IS READABLE, probed live 2026-09-14 (scripts/probe-live-shape.mjs):
//
//   always            Job.min_beginning / max_end via `?with=Job`, the ONLY working
//                     expansion on /orders. It is the AGGREGATE span across every block,
//                     not a per-block window — comparing a single block's times against
//                     it produced a spurious "38 blocks have moved" reading once already.
//   always            the order's own specification and intern_name.
//   staffed only      `/attendance?with=Slot,SlotTeam&Order__id=<id>` returns, per seat,
//                     Slot.{slotteam_id, size, profession_id, slotlocation_id, beginning,
//                     end} and SlotTeam.{id, name}. Per-block and exact.
//   never             an unstaffed block. Order #16005 with attendance count 0 returns
//                     ZERO rows, so an order nobody has been assigned to is invisible
//                     here and the Job window is its only witness.
//
// AN UNREADABLE ORDER IS NOT AN EMPTY ONE. This API answers an unsupported filter with an
// empty list rather than an error, and the same shape — no rows — is returned by "nobody
// is signed on". Treating a failed read as drift would re-post the whole shape against an
// order that was already correct, on every sweep, forever. So a read that throws sets
// `unreadable` and every caller treats that as "change nothing".
// ============================================================================
import type { OnsinchClient } from "./onsinch";
import type { DesiredOrder, DesiredSlotTeam } from "./types";
import { capSlotTeamName } from "./format";

/** One crew block as OnSinch currently holds it. Only ever built from a staffed slot. */
export interface LiveTeam {
  /** SlotTeam id — the same id `last_ordered_team_ids` carries and PATCH /slotTeams aims at. */
  id: number;
  name?: string;
  size?: number;
  profession_id?: number;
  /**
   * Slot.slotlocation_id, AND IT IS NOT A PLACE ID. Kept because it identifies the row and
   * is worth printing; never compared against the engine's `place_id`.
   *
   * Measured 2026-09-14 with a positive control: thread place 621 is "Westfield Stratford
   * City" and 236 is "Syon Park", while the slotlocation ids standing against those same
   * blocks are 16610 and 16578, and `GET /places?id[eq]=` returns NOTHING for either.
   * There is no `/slotLocations` endpoint in any spelling (404), so a SlotLocation cannot
   * be resolved to the Place it stands for through this API at all.
   *
   * Comparing the two would have reported a venue difference on EVERY staffed block, for
   * ever — the third time in two days that two identifiers which look alike turned out not
   * to be the same thing, after the timezone offsets and the rich-text specification.
   */
  slotlocation_id?: number;
  beginning?: string;
  end?: string;
}

export interface LiveShape {
  order_id: number;
  /**
   * The job's span across EVERY block. An unstaffed order has nothing else, so this is
   * the witness that a time change reached OnSinch at all. It cannot say which block
   * moved and must never be compared against one.
   */
  window: { beginning?: string; end?: string } | null;
  specification?: string;
  intern_name?: string;
  /** Keyed by SlotTeam id. Blocks nobody is signed on to DO NOT APPEAR — see the header. */
  teams: Map<number, LiveTeam>;
  /** How many blocks could be read at all. Zero is normal and is not evidence of anything. */
  staffedBlocks: number;
  /** Set when the order could not be read. Never confused with "read, and it was empty". */
  unreadable?: string;
}

/** One difference between what OnSinch holds and what the thread says it should hold. */
export interface Drift {
  /** Which block, or "order" for an order-level field, or "window" for the job span. */
  where: string;
  field: string;
  live: unknown;
  want: unknown;
}

/**
 * A timestamp as an INSTANT, not as text.
 *
 * Comparing the strings was wrong and the live dry run of 2026-09-14 proved it on 12 of
 * 13 drifted threads: the engine sends `2026-09-17T23:00:00+01:00` and OnSinch echoes
 * `2026-09-17T22:00:00+00:00`, which is the same moment written in the other zone. Sliced
 * to the minute those differ, so British Summer Time alone made every order in the tenant
 * look like it had drifted by an hour — and the loop would have re-asserted that
 * non-change on every sweep, for ever, which is precisely the runaway the rest of this
 * file is built to avoid.
 *
 * NaN for anything unparseable, and every caller treats NaN as "no comparison", never as
 * a difference.
 */
const at = (s: unknown) => Date.parse(String(s ?? ""));

/**
 * Two timestamps naming the same moment, however each is written.
 *
 * Exported because this comparison has now been got wrong twice in two files — the sweep
 * reported every order in the tenant as an hour adrift, and the staff-raised amendment
 * re-sent times that had not moved. Anywhere a stored time meets a time OnSinch echoed
 * back, this is the comparison; `===` on the strings is not.
 *
 * Unparseable on either side is FALSE, not true: "I cannot tell" must never be reported as
 * "they agree", because that is the direction that silently drops a real change.
 */
export function sameMoment(a: unknown, b: unknown): boolean {
  const x = at(a), y = at(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}
const first = <T>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Free text as OnSinch gives it back, reduced to what it MEANS.
 *
 * The same lesson as `at`, found in the same dry run: OnSinch stores `specification`
 * through a rich-text field, so the summary the engine sent as
 *
 *   "2026-09-15 10:30-12:30 - 2 crew at 16 Endeavour Way -> UPDATED: PO provided"
 *
 * reads back as `<p>2026-09-15 10:30-12:30 - 2 crew at 16 Endeavour Way -&gt; UPDATED: PO
 * provided</p>\n`. Compared as raw strings, every order carrying a summary looked drifted
 * — 8 of the 9 on the first clean run — and the loop would have re-sent an identical
 * value on every sweep for ever.
 *
 * Entities first, then tags, then whitespace: decoding after stripping would turn a
 * `&lt;p&gt;` the client actually typed into a tag and delete their text.
 */
function sameText(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    String(v ?? "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return norm(a) === norm(b);
}

/**
 * What OnSinch holds for this order, right now.
 *
 * Two reads, and the second is allowed to come back empty: an order with no crew signed
 * on has no attendance rows, which is the common case for a To Confirm order and is not
 * a failure. A read that THROWS is a failure, and the whole shape is marked unreadable
 * rather than reported as an order that holds nothing.
 */
export async function readLiveShape(client: OnsinchClient, order_id: number): Promise<LiveShape> {
  const shape: LiveShape = { order_id, window: null, teams: new Map(), staffedBlocks: 0 };
  try {
    const order = await client.orderById(order_id);
    if (!order) return { ...shape, unreadable: `order #${order_id} could not be read back` };
    const job = first(order.Job as any);
    shape.window = job ? { beginning: job.min_beginning, end: job.max_end } : null;
    shape.specification = typeof order.specification === "string" ? order.specification : undefined;
    shape.intern_name = typeof order.intern_name === "string" ? order.intern_name : undefined;
  } catch (err: any) {
    return { ...shape, unreadable: `order read failed: ${String(err?.message ?? err)}` };
  }

  try {
    for (const row of await client.liveTeamsForOrder(order_id)) {
      const slot = first(row?.Slot as any);
      const team = first(row?.SlotTeam as any);
      const id = Number(team?.id ?? slot?.slotteam_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      // Several people on one block give several rows carrying the same Slot. Last write
      // wins and they agree, so this is a de-duplication rather than a choice.
      shape.teams.set(id, {
        id,
        name: typeof team?.name === "string" ? team.name : undefined,
        size: Number.isFinite(Number(slot?.size)) ? Number(slot.size) : undefined,
        profession_id: Number.isFinite(Number(slot?.profession_id)) ? Number(slot.profession_id) : undefined,
        slotlocation_id: Number.isFinite(Number(slot?.slotlocation_id)) ? Number(slot.slotlocation_id) : undefined,
        beginning: typeof slot?.beginning === "string" ? slot.beginning : undefined,
        end: typeof slot?.end === "string" ? slot.end : undefined,
      });
    }
    shape.staffedBlocks = shape.teams.size;
  } catch (err: any) {
    // The order read succeeded, so the window is real; only the per-block half is lost.
    return { ...shape, unreadable: `attendance read failed: ${String(err?.message ?? err)}` };
  }

  return shape;
}

/**
 * Every way OnSinch disagrees with the shape this thread says the job should have.
 *
 * Pure. `team_ids` is `last_ordered_team_ids` — one id per desired block, in the order
 * they were written — so `desired.slot_teams[i]` is the block standing at `team_ids[i]`.
 * That correspondence is the same one `planAmendment` relies on, and it is why a block
 * appended by hand in the OnSinch UI is invisible here: we never wrote it, we hold no id
 * for it, and reconciliation must not touch what it did not create.
 *
 * NOTHING IS REPORTED THAT CANNOT BE READ. An unstaffed block contributes no drift at
 * all, because `live.teams` has no entry for it — not "it differs", not "it agrees".
 * Reporting a difference we cannot see would re-post the shape on every sweep forever.
 */
export function driftAgainst(
  live: LiveShape,
  desired: DesiredOrder,
  team_ids: number[] | undefined
): Drift[] {
  if (live.unreadable) return [];
  const out: Drift[] = [];
  const blocks = desired.slot_teams ?? [];
  if (!blocks.length) return out;

  /**
   * The job window — the ONLY witness an unstaffed order has, and a one-sided one.
   *
   * `min_beginning` is the minimum across EVERY block on the order, ours and anybody
   * else's. So it can only ever prove absence in one direction:
   *
   *   live.min > our earliest start   no block on this order starts that early, so ours
   *                                   is NOT there. Real evidence.
   *   live.min < our earliest start   some other block starts earlier. Says nothing at
   *                                   all about ours.
   *
   * Testing it the symmetric way reported drift on every order staff had extended, which
   * is a normal state and not our business — the live dry run showed spans of three days
   * against a thread that asked for one. That reading would have re-asserted a
   * non-difference on every sweep for the life of those orders.
   */
  const starts = blocks.map((b) => at(b.beginning)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const ends = blocks.map((b) => at(b.end)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const liveFrom = at(live.window?.beginning);
  const liveTo = at(live.window?.end);
  if (starts.length && Number.isFinite(liveFrom) && liveFrom > starts[0]) {
    out.push({ where: "window", field: "beginning", live: live.window?.beginning, want: new Date(starts[0]).toISOString() });
  }
  if (ends.length && Number.isFinite(liveTo) && liveTo < ends[ends.length - 1]) {
    out.push({ where: "window", field: "end", live: live.window?.end, want: new Date(ends[ends.length - 1]).toISOString() });
  }

  // Per block, and only where somebody is signed on to it.
  const ids = team_ids ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const id = ids[i];
    const seen = Number.isInteger(id) ? live.teams.get(Number(id)) : undefined;
    if (!seen) continue;
    // Capped on the desired side, because the capped name is what was sent — comparing
    // the raw one reports a difference on every block whose name runs long.
    const want = capSlotTeamName(blocks[i] as DesiredSlotTeam) as unknown as Record<string, unknown>;
    const where = `block ${i + 1}`;
    const cmp = (field: string, liveVal: unknown, wantVal: unknown) => {
      if (wantVal === undefined || wantVal === "" || wantVal === null) return;
      if (liveVal === undefined) return; // not readable is not a difference
      if (String(liveVal) === String(wantVal)) return;
      out.push({ where, field, live: liveVal, want: wantVal });
    };
    cmp("size", seen.size, want.size);
    cmp("profession_id", seen.profession_id, want.profession_id);
    // NOT the venue. See slotlocation_id above: the live side is a different id space and
    // comparing it would report a difference on every staffed block, for ever.
    // Through sameText for the same reason as specification: a block name is free text
    // the client's own words compose, and it comes back however OnSinch chose to store it.
    if (want.name && seen.name !== undefined && !sameText(seen.name, want.name)) {
      out.push({ where, field: "name", live: seen.name, want: want.name });
    }
    // Exact here, unlike the window: we hold this block's id, so this IS our block and
    // the two times are directly comparable — as instants, never as text.
    for (const f of ["beginning", "end"] as const) {
      const a = at(seen[f]);
      const b = at(want[f]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
      out.push({ where, field: f, live: seen[f], want: want[f] });
    }
  }

  // Order-level fields. Both are set from the client's own words, so an empty desired
  // value means "this email said less", never "blank what is there".
  if (desired.specification && !sameText(live.specification, desired.specification)) {
    out.push({ where: "order", field: "specification", live: live.specification, want: desired.specification });
  }
  if (desired.intern_name && !sameText(live.intern_name, desired.intern_name)) {
    out.push({ where: "order", field: "intern_name", live: live.intern_name, want: desired.intern_name });
  }

  return out;
}

/**
 * A stable fingerprint of a drift set, so the same unresolved difference can be
 * recognised across sweeps.
 *
 * Reconciliation re-asserts every pass, which is right until the write is one OnSinch
 * will never accept — then it re-asserts forever, silently, and the thread looks healthy
 * while the client's change never lands. Counting repeats of the SAME fingerprint is what
 * turns that into the terminal "Order Needs Updated" label. The live values are
 * deliberately excluded: a difference that is still the same difference is the signal,
 * and including what OnSinch currently holds would reset the count whenever it wobbled.
 */
export function driftKey(drift: Drift[]): string {
  return drift
    .map((d) => `${d.where}.${d.field}=${String(d.want)}`)
    .sort()
    .join("|");
}

/** One line per difference, for the note a person reads on the board. */
export function describeDrift(drift: Drift[]): string {
  return drift
    .map((d) => `${d.where} ${d.field}: OnSinch holds ${JSON.stringify(d.live ?? null)}, the thread asks for ${JSON.stringify(d.want)}`)
    .join("; ");
}
