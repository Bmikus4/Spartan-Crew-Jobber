// ============================================================================
// Changing the crew or the times on a draft order WITHOUT destroying it.
// ----------------------------------------------------------------------------
// Until 2026-08-23 the only route was delete-and-repost (replaceOrder.ts), for one
// reason: `PATCH /slotTeams` works and takes every field the engine sets, but the teams
// created nested inside `POST /orders` never hand back their ids and there is no
// `GET /slotTeams`, so there was nothing to aim a PATCH at.
//
// Two things closed that, and only the second one covers the engine's own orders.
// `client.slotTeamsForOrder` reads ids out of the audit log — which works for an order
// raised in the OnSinch UI and returns NOTHING for one created through the API, since an
// API create logs a single childless row. So the engine stopped nesting its blocks and
// posts each one separately, keeping the id `POST /slotTeams` hands back.
//
// What is left is the harder half: deciding WHICH live team each desired team overwrites,
// given that nothing in the API returns a live team's current size, window or place. The
// engine cannot diff. It can only overwrite.
//
// THE ANSWER IS NOT NAMES. A team's name is composed from the client's own words for
// the work, so an amendment that rewords the task changes it. Matching on the name would
// find nothing, POST a new team, and leave the old one standing: an order carrying both
// blocks, double the crew, and a 201 that says everything went fine. Names are not
// unique either — order 13784 carries two teams called "General".
//
// THE ANSWER IS THE ID THE ENGINE RECORDED WHEN IT CREATED THE BLOCK. The create posts
// each block separately and `POST /slotTeams` returns its id, so the state row carries
// `last_ordered_team_ids` beside `last_ordered_teams` — one id per block, in the order
// written. Those ids are used directly and the audit read is skipped, which is what makes
// an engine-raised order amendable at all: for those orders the read returns nothing.
//
// POSITION IS THE FALLBACK, NOT THE DESIGN. An order raised in the OnSinch UI, or created
// before custody existed, has no stored ids; there the audit read applies and live[i] is
// taken to be previous[i] by creation order. That pairing is exactly what ids exist to
// avoid: the moment a human adds a block in the UI it shifts every later index and the
// overwrite lands on the wrong block, on a 201 that reports success. Holding our own ids
// narrows the amendment to blocks the engine created, so the human's block is invisible
// to it.
//
// Overwrite plus append is TOTAL AND EXACT either way: patch the M blocks we already
// have, create next[M..], and the resulting team set equals `next` field for field,
// whatever order the blocks arrived in.
//
// It DECLINES rather than guessing whenever that correspondence is not established —
// ops added a team by hand, the thread inherited an order the engine never raised, a
// previous amendment half-landed — and the caller falls back to the old path. Declining
// is the load-bearing behaviour: positional pairing against a set we did not write is
// how one block's times get written onto another block.
//
// NOTHING HERE DESTROYS ANYTHING, which is why `carryForward`, the attachment refusal
// and the archive-before-delete have no counterpart: there is no snapshot to keep, an
// attachment survives, ops' hand-typed fields survive, and the R number never moves
// (OnSinch reissues max(live)+1 after a delete, so a replacement inherits the number of
// the order it destroyed — handoff finding 10).
// ============================================================================
import type { OnsinchClient } from "./onsinch";
import type { DesiredOrder, DesiredSlotTeam } from "./types";
import { buildSlotTeamBody, capSlotTeamName } from "./format";
import { preflightOrder } from "./orderPreflight";
import { readLiveShape, sameMoment, type LiveShape } from "./reconcile";
import { provisionPlaceIfNeeded } from "./provisionPlace";

/** The fields of a slot team the engine sets, and can therefore correct. */
const TEAM_FIELDS = ["name", "profession_id", "beginning", "end", "size", "place_id", "description"] as const;
type TeamField = (typeof TEAM_FIELDS)[number];

export interface AmendmentPlan {
  /** One PATCH body per team that actually moved. Empty when nothing changed. */
  patches: Array<{ id: number } & Partial<Record<TeamField, unknown>>>;
  /** Teams to append, in order, with the desired team each came from. */
  creates: DesiredSlotTeam[];
  /** Set when the change cannot be expressed in place. The caller falls back. */
  declined?: string;
}

/**
 * What it would take to turn the live teams into `next`. Pure, total, and the only place
 * the correspondence rule lives.
 *
 * `previous` is the team array this engine last wrote to the order; `live` is the ids
 * standing against it — the ones recorded at create time where we have them, otherwise
 * what the audit read returned, in creation order.
 */
export function planAmendment(
  previous: DesiredSlotTeam[],
  next: DesiredSlotTeam[],
  live: Array<{ id: number; name: string }>
): AmendmentPlan {
  const none = { patches: [], creates: [] };
  if (!next.length) {
    // An amendment to nothing is not an amendment. The compiler catches this earlier
    // (an order with no bookable teams composes to null), so this is the guard for the
    // day that stops being true rather than a case that reaches it.
    return { ...none, declined: "the amendment carries no slot teams" };
  }
  if (live.length !== previous.length) {
    return {
      ...none,
      declined:
        `OnSinch holds ${live.length} crew block(s) and this engine last wrote ${previous.length} — ` +
        `the team set has been changed by somebody else, so matching them up by position would move the wrong block`,
    };
  }
  if (!live.length) {
    // No ids to aim at. Either the order predates the audit log or it was raised in a
    // way that left no trace; positional pairing has nothing to stand on.
    return { ...none, declined: `no slot team ids could be read back for the order` };
  }
  if (next.length < previous.length) {
    return {
      ...none,
      declined:
        `the amendment drops a crew block (${previous.length} -> ${next.length}) and OnSinch cannot remove a slot team ` +
        `(DELETE is 405, size 0 is refused, the floor is 1)`,
    };
  }

  const patches: AmendmentPlan["patches"] = [];
  for (let i = 0; i < previous.length; i++) {
    // Capped on both sides: what was sent to OnSinch was the capped name, so comparing
    // the raw one reports a change on every single amendment.
    const was = capSlotTeamName(previous[i]) as unknown as Record<string, unknown>;
    const now = capSlotTeamName(next[i]) as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const f of TEAM_FIELDS) {
      const a = was[f], b = now[f];
      if (a === b) continue;
      // An absent description on the new team does not blank a description on the live
      // one: the engine only ever sets this field from the client's own words, and
      // clearing it because this email said less is a loss, not a correction.
      if (b === undefined || b === "") continue;
      patch[f] = b;
    }
    if (Object.keys(patch).length) patches.push({ id: live[i].id, ...patch });
  }
  return { patches, creates: next.slice(previous.length) };
}

/**
 * WHICH LIVE BLOCK EACH DESIRED BLOCK IS, ON AN ORDER THIS ENGINE DID NOT WRITE.
 *
 * `planAmendment` pairs by position, and that is only legitimate against a set we wrote
 * ourselves — the array and the ids came out of the same create, in the same order. On a
 * staff-raised order there is no such array, and position means nothing: ops add blocks in
 * whatever order the job needed them, so live[1] is not "the second thing the client asked
 * for", it is whatever they typed second. Pairing on that writes one block's times onto
 * another and reports a 201.
 *
 * Measured 2026-09-14: 28 of 37 live bound orders are staff-raised. This is the common
 * case, not the edge one, and until now every one of them fell through to the rebuild —
 * which, since 4.3, refuses. So without this the label is all a staff-raised order ever
 * gets.
 *
 * THE KEY IS DAY AND VENUE, which is Ben's identity ruling applied one level down. Within
 * an order, a block is identified by the day it runs and where it runs; the crew size and
 * the times are what an amendment CHANGES, so neither can be part of what identifies the
 * thing being changed. The day rather than the start time for exactly that reason — "make
 * that 4x at 1400-2000" moves the time and must still find its block.
 *
 * It DECLINES rather than guessing whenever the correspondence is not proven:
 *
 *   two blocks on the same day at the same venue   the key does not separate them, and
 *                                                  nothing else can. Order 13784 carries
 *                                                  two blocks called "General", so names
 *                                                  do not rescue it.
 *   a block whose venue moved                      its key changed, so it matches nothing
 *                                                  — and a venue change is precisely when
 *                                                  a wrong pairing sends crew to the
 *                                                  wrong building.
 *   live shapes unreadable and more than one block a block nobody is signed on to returns
 *                                                  no attendance row, so its day and venue
 *                                                  cannot be read at all.
 *
 * ONE BLOCK ON EACH SIDE NEEDS NO KEY. The pairing is the only one there is, whatever the
 * shapes say, and this is the case that carries an unstaffed staff-raised order.
 */
export interface LiveBlock {
  id: number;
  name: string;
  /** Present only where the block could be read back — see reconcile.ts. */
  beginning?: string;
  profession_id?: number;
}

export interface Pairing {
  /** desired index -> live slot team id. Blocks not listed are appends. */
  pairs: Array<{ id: number; index: number }>;
  declined?: string;
}

/**
 * THE DAY AND THE PROFESSION. Undefined when either is missing, which means "cannot be
 * keyed" and never "matches everything".
 *
 * THE VENUE IS DELIBERATELY ABSENT, and it took a positive control to find out why. A
 * Slot carries `slotlocation_id`, which reads exactly like the `place_id` the engine sets
 * and is not one: thread place 621 is "Westfield Stratford City" and 236 is "Syon Park",
 * while the slotlocation ids on those same blocks are 16610 and 16578, and
 * `GET /places?id[eq]=` finds neither. There is no `/slotLocations` endpoint in any
 * spelling. So a block's venue simply cannot be read through this API, and a key that
 * included it matched NOTHING — measured 2026-09-14, it declined every multi-block
 * staff-raised order in the tenant.
 *
 * The profession carries the discrimination the venue was expected to. Within one order a
 * block is the work it is for — the crew-chief rule carves a block of 4 into 3 crew plus 1
 * chief, and those two run the same hours on the same day and are told apart by nothing
 * else. It is also the right kind of key: a chief block stays a chief block, where the
 * size and the times are precisely what an amendment CHANGES.
 *
 * What this gives up: a block that moves to a different building, on the same day, in the
 * same role, is paired rather than refused. The patch then sets the new place on it, which
 * is what the thread asked for — so the cost is that a venue move is applied without being
 * separately verified, not that crew go to the wrong address.
 */
function blockKey(b: { beginning?: string; profession_id?: number }): string | undefined {
  const day = String(b.beginning ?? "").slice(0, 10);
  if (!day || !b.profession_id) return undefined;
  return `${day}|${b.profession_id}`;
}

export function pairBlocks(desired: DesiredSlotTeam[], live: LiveBlock[]): Pairing {
  if (!live.length) return { pairs: [], declined: "no slot team ids could be read back for the order" };

  // The unambiguous case, and the one that covers an unstaffed order whose blocks cannot
  // be read at all.
  if (live.length === 1 && desired.length === 1) return { pairs: [{ id: live[0].id, index: 0 }] };

  const liveKeys = new Map<string, number>();
  for (const b of live) {
    const k = blockKey(b);
    if (!k) {
      return {
        pairs: [],
        declined:
          `order has ${live.length} crew blocks and block ${b.id} cannot be read back — ` +
          `nobody is signed on to it, so there is no way to say which block is which`,
      };
    }
    if (liveKeys.has(k)) {
      return {
        pairs: [],
        declined: `two crew blocks run the same role on the same day (${k}) — nothing separates them`,
      };
    }
    liveKeys.set(k, b.id);
  }

  const pairs: Pairing["pairs"] = [];
  const used = new Set<number>();
  for (let i = 0; i < desired.length; i++) {
    const k = blockKey(desired[i]);
    if (!k) continue; // not keyable: treated as an append, never as a match
    const id = liveKeys.get(k);
    if (id === undefined || used.has(id)) continue;
    used.add(id);
    pairs.push({ id, index: i });
  }

  /**
   * A live block nothing claimed is one ops added and this thread knows nothing about.
   * Leaving it alone is right — the engine only ever touches what it can account for —
   * but an amendment that also wants to APPEND would then leave the order carrying both
   * that block and a new one, which is double crew on a 201. So appends are only allowed
   * when every live block was accounted for.
   */
  const appends = desired.length - pairs.length;
  if (appends > 0 && used.size < live.length) {
    return {
      pairs: [],
      declined:
        `${live.length - used.size} crew block(s) on the order belong to nobody in this thread, ` +
        `and it also wants to add ${appends} — appending beside blocks we cannot account for would double the crew`,
    };
  }

  return { pairs };
}

export interface AmendResult {
  /** Set when the change landed. */
  amended?: { order_id: number; patched: number; added: number[]; job_id?: number };
  /** Set when this path does not apply and the caller should fall back. */
  declined?: string;
  /** Set when the order must not be touched at all, by any path. */
  refused?: string;
}

export interface AmendHooks {
  /**
   * A team was appended and its id must be on disk BEFORE the next one is sent.
   * `POST /slotTeams` is the only call here that is not idempotent: a retry that
   * re-posts an appended team leaves the order carrying two of it.
   */
  onCreated(team_id: number): Promise<void>;
}

/**
 * Apply a crew or time change to a draft order in place.
 *
 * `alreadyCreated` is the resume record — team ids a previous attempt appended, in
 * order — so a retry patches again (harmless) and appends only what is missing.
 */
export async function amendOrderInPlace(
  client: OnsinchClient,
  args: {
    order_id: number;
    previous: DesiredSlotTeam[];
    desired: DesiredOrder;
    alreadyCreated?: number[];
    /**
     * What the engine recorded when it CREATED this order — the job id and one slot-team
     * id per block, in the order they were written.
     *
     * Present for every order created after id custody shipped. When it is present the
     * audit read is skipped entirely, because for those orders the read returns nothing:
     * an API create logs one childless row (reference §12). Absent for UI-raised orders
     * and for everything created before, which still fall through to the audit read.
     */
    known?: { job_id?: number; team_ids?: number[] };
  },
  hooks: AmendHooks
): Promise<AmendResult> {
  const { order_id, previous } = args;
  /**
   * A venue the tenant does not hold is created BEFORE any block is written against it.
   *
   * A composed order whose venue is new carries `place_id: 0` and a `provision_place`,
   * and only `createOrderWithPlace` ever acted on that. This path posts blocks through
   * `client.createSlotTeam` directly, so the zero reached the wire:
   * `400 {"place_id":["Fill in correct location"]}` — measured 2026-08-26, case R001,
   * where the amendment was simply refused and the client's change never landed.
   *
   * Reachable on any amendment whose venue re-resolves to something new, which became
   * more common the same day a client who moves the venue stopped being ignored.
   */
  const provisioned = await provisionPlaceIfNeeded(client, args.desired);
  args = { ...args, desired: provisioned.desired };
  const next = args.desired.slot_teams ?? [];
  const done = args.alreadyCreated ?? [];

  if (next.some((t) => !t.beginning || !t.end)) {
    // Same rule as the rebuild path: OnSinch would refuse it, and a TBC block is not a
    // booking. Declined rather than refused — the fallback says it better.
    return { declined: `a slot team has no start or finish (the date is still TBC)` };
  }

  // `next` is the shape we are about to write, so its first block is the day this
  // amendment is about — the key the successor lookup needs if the order has vanished.
  const pre = await preflightOrder(client, {
    order_id,
    company_id: args.desired.company_id,
    happening_day: next[0]?.beginning ?? args.desired.slot_teams?.[0]?.beginning,
  });
  if (pre.refused) return { refused: pre.refused };

  /**
   * OUR OWN RECORD OUTRANKS THE AUDIT LOG, because for an engine-created order the audit
   * log holds nothing to outrank. Where ids were stored at create time they are used
   * directly; the name comes from `previous`, which is by definition what we wrote.
   *
   * This also narrows what an amendment can touch, which is the point. The engine patches
   * only ids it created, so a block a human added in the OnSinch UI is invisible to it and
   * cannot be overwritten. Under position-pairing that block shifted every later index and
   * the overwrite landed on the wrong one, reported as a 201.
   */
  const stored = args.known?.team_ids;
  let live: Array<{ id: number; name: string }>;
  let job_id: number | undefined;

  if (stored && stored.length) {
    if (stored.length !== previous.length) {
      // Our own two records disagree. Which id belongs to which block is then a guess,
      // and a wrong guess silently doubles or misplaces crew, so the rebuild takes it.
      return {
        declined:
          `order #${order_id}: ${stored.length} stored slot-team id(s) for ${previous.length} recorded block(s) — ` +
          `cannot say which id is which`,
      };
    }
    live = stored.map((id, i) => ({ id, name: capSlotTeamName(previous[i]).name }));
    job_id = args.known?.job_id;
    /**
     * `done` is NOT excluded here, and must not be. It holds ids a previous attempt
     * APPENDED, which by definition are not in the array recorded at create time — the
     * pipeline only extends that array once an amendment succeeds. So there is nothing
     * of `done` in `live` to filter out, and filtering would be a no-op that reads as a
     * safeguard. The audit-read branch below does need it, because the live read returns
     * appended blocks too.
     */
  } else {
    const read = await client.slotTeamsForOrder(order_id);
    /**
     * A resumed run has already appended some of the teams, so the live set is longer
     * than the one we last wrote by exactly that many. Those are ours and are excluded
     * before the correspondence is checked — otherwise the retry declines on its own
     * progress and hands a human an order that is halfway correct.
     */
    live = done.length ? read.teams.filter((t) => !done.includes(t.id)) : read.teams;
    job_id = read.job_id;
  }

  /**
   * AN ORDER WE DID NOT WRITE, AMENDED IN PLACE. Measured 2026-09-14: 28 of 37 live bound
   * orders are staff-raised, so this is the common case and not the edge one.
   *
   * `previous` is the block array this engine last wrote, and for an order ops raised
   * there is none — so `planAmendment` has nothing to pair against and declines, which
   * used to fall through to the rebuild. Since 4.3 the rebuild refuses to destroy an order
   * ops raised, so without this path a staff-raised order can only ever get a label.
   *
   * What replaces `previous` is the live order itself, read back: `pairBlocks` says which
   * live block each desired block IS, on day and venue, and the shapes come from
   * attendance where anybody is signed on. That is a stronger footing than `previous`
   * ever was — it is what OnSinch holds now rather than what we remember sending — and it
   * declines wherever the correspondence is not proven.
   */
  if (!previous.length) {
    const shapes = await readLiveShape(client, order_id).catch(() => null);
    if (shapes?.unreadable === undefined && shapes) {
      live = live.map((t) => {
        const seen = shapes.teams.get(t.id);
        return seen ? { ...t, beginning: seen.beginning, profession_id: seen.profession_id } : t;
      });
    }
    const paired = pairBlocks(next, live as LiveBlock[]);
    if (paired.declined) return { declined: `order #${order_id}: ${paired.declined}` };

    /**
     * The patch set, built from the pairing rather than from a diff. There is nothing to
     * diff against for a block nobody is signed on to — its current size and times are not
     * readable — so every field the engine sets is sent. Re-sending a field the value it
     * already holds is a no-op, proved by the live amend matrix, so the cost of not being
     * able to diff is a slightly larger PATCH and never a wrong one.
     */
    const byIndex = new Map(paired.pairs.map((p) => [p.index, p.id]));
    const patches: AmendmentPlan["patches"] = [];
    const creates: DesiredSlotTeam[] = [];
    for (let i = 0; i < next.length; i++) {
      const id = byIndex.get(i);
      if (id === undefined) {
        creates.push(next[i]);
        continue;
      }
      const want = capSlotTeamName(next[i]) as unknown as Record<string, unknown>;
      const seen = shapes?.teams.get(id);
      const patch: Record<string, unknown> = {};
      for (const f of TEAM_FIELDS) {
        const b = want[f];
        if (b === undefined || b === "") continue;
        /**
         * The venue is asserted, never compared, and never on its own.
         *
         * A block's live venue cannot be read at all — `slotlocation_id` is a different id
         * space with no endpoint to resolve it — so "did the venue move?" has no answer and
         * sending it always would report a correction on every block of every pass. It
         * rides along with a patch that is going anyway, which keeps the order's venue right
         * without inventing a change that was never observed.
         */
        if (f === "place_id") continue;
        // Where the live value IS readable, only what actually moved is sent — so the
        // shrink guard below sees a size only when the size really changed.
        //
        // Times through sameMoment, never through ===. OnSinch echoes `+00:00` where the
        // engine sent `+01:00`, so the strings differ on every block through British
        // Summer Time and every amendment would re-send two times that had not moved.
        if (seen) {
          const liveVal = (seen as unknown as Record<string, unknown>)[f];
          const isTime = f === "beginning" || f === "end";
          if (isTime ? sameMoment(liveVal, b) : f in seen && String(liveVal) === String(b)) continue;
        }
        patch[f] = b;
      }
      if (Object.keys(patch).length) {
        const place = (want as Record<string, unknown>).place_id;
        patches.push({ id, ...patch, ...(place ? { place_id: place } : {}) });
      }
    }
    return applyAmendment(client, { order_id, job_id, plan: { patches, creates }, live, previous: [], shapes }, hooks, done);
  }

  const plan = planAmendment(previous, next, live);
  if (plan.declined) return { declined: plan.declined };

  return applyAmendment(client, { order_id, job_id, plan, live, previous, shapes: null }, hooks, done);
}

/**
 * Send a planned amendment, whatever planned it.
 *
 * Both routes into this — the positional pairing against a set we wrote, and the day-and-
 * venue pairing against an order ops raised — end in the same three writes, and the guard
 * that matters most sits here rather than in either planner: a block is never shrunk while
 * somebody is signed on to it.
 *
 * `shapes` is the live read, present only on the staff-raised route. It is what supplies
 * the block's CURRENT size there; on the route that has `previous`, the array we wrote
 * supplies it. One of the two is always available whenever a size is being changed at all,
 * which is what lets the shrink guard be unconditional.
 */
async function applyAmendment(
  client: OnsinchClient,
  args: {
    order_id: number;
    job_id?: number;
    plan: AmendmentPlan;
    live: LiveBlock[];
    previous: DesiredSlotTeam[];
    shapes: LiveShape | null;
  },
  hooks: AmendHooks,
  done: number[]
): Promise<AmendResult> {
  const { order_id, job_id, plan, live, previous, shapes } = args;

  const stillToCreate = plan.creates.slice(done.length);
  if (!plan.patches.length && !stillToCreate.length) {
    // Nothing moved. Reached when a resumed run finds its work already done, and when
    // the only change was an order-level field, which the caller patches separately.
    return { amended: { order_id, patched: 0, added: [...done], job_id } };
  }

  /**
   * THE ONE WRITE IN THIS API NOBODY HAS TESTED. Shrinking a team that already has crew
   * on it may unbook those people as quietly as a delete does, and finding out costs a
   * real signup on a real order, which may SMS a worker. So it is refused, per team,
   * against the count actually signed on to that team.
   *
   * Everything else on a staffed order goes: size up, a moved window, a new place, a
   * reworded name. That is the common amendment, it is what the client asked for, and
   * refusing it is why 45% of drafts could not be amended at all (handoff finding 4).
   *
   * The whole amendment stops, not just the offending patch. Half an amendment is worse
   * than none: the order would end up agreeing with the client about the times and
   * disagreeing about the crew, with nothing to say which half is real.
   */
  const shrinks = plan.patches.filter((p) => p.size !== undefined);
  if (shrinks.length) {
    const byTeam = await client.attendanceByTeam(order_id).catch(() => null);
    if (!byTeam) {
      return { declined: `could not check who is signed on to order #${order_id} — refusing to resize a crew block blind` };
    }
    for (const p of plan.patches) {
      if (p.size === undefined) continue;
      const i = live.findIndex((t) => t.id === p.id);
      /**
       * What the block holds NOW. From the array we wrote where we have one, otherwise
       * from the live read — and `undefined` there means unreadable, which on this API
       * only happens when nobody is signed on. An empty block cannot be un-booking
       * anybody, so an unreadable size is safe to resize rather than a reason to refuse.
       */
      const was =
        previous.length && i >= 0 ? capSlotTeamName(previous[i]).size : shapes?.teams.get(p.id)?.size;
      if (was === undefined || Number(p.size) >= Number(was)) continue; // growing is safe
      const on = byTeam.get(p.id) ?? 0;
      if (on > 0) {
        return {
          refused:
            `order #${order_id}: crew block "${live[i]?.name}" is being reduced from ${was} to ${p.size} and ${on} ` +
            `crew are already signed on to it. Shrinking a staffed block may unbook them, so it must be done by hand`,
        };
      }
    }
  }

  // PATCHes first: idempotent, order-independent, and they cannot leave a duplicate
  // behind if this dies halfway.
  await client.patchSlotTeams(plan.patches);

  const added: number[] = [...done];
  if (stillToCreate.length) {
    if (!Number.isInteger(job_id)) {
      // The patches landed; the appended block did not. Said plainly rather than
      // reported as a completed amendment.
      return {
        refused:
          `order #${order_id}: ${plan.patches.length} crew block(s) were corrected, but the job id could not be read ` +
          `so ${stillToCreate.length} new block(s) could not be added — they must be added by hand`,
      };
    }
    for (const team of stillToCreate) {
      const created = await client.createSlotTeam(buildSlotTeamBody(job_id as number, team));
      // On disk before the next POST goes out.
      await hooks.onCreated(created.id);
      added.push(created.id);
    }
  }

  return { amended: { order_id, patched: plan.patches.length, added, job_id } };
}
