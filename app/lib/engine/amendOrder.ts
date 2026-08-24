// ============================================================================
// Changing the crew or the times on a draft order WITHOUT destroying it.
// ----------------------------------------------------------------------------
// Until 2026-08-23 the only route was delete-and-repost (replaceOrder.ts), for one
// reason: `PATCH /slotTeams` works and takes every field the engine sets, but the teams
// created nested inside `POST /orders` never hand back their ids and there is no
// `GET /slotTeams`, so there was nothing to aim a PATCH at.
//
// `client.slotTeamsForOrder` closed that (see its comment — the ids are in the audit
// log, for every order, back to 2023). What is left is the harder half: deciding WHICH
// live team each desired team overwrites, given that nothing in the API returns a live
// team's current size, window or place. The engine cannot diff. It can only overwrite.
//
// THE ANSWER IS NOT NAMES. A team's name is composed from the client's own words for
// the work, so an amendment that rewords the task changes it. Matching on the name would
// find nothing, POST a new team, and leave the old one standing: an order carrying both
// blocks, double the crew, and a 201 that says everything went fine. Names are not
// unique either — order 13784 carries two teams called "General".
//
// THE ANSWER IS POSITION, against the set this engine last wrote. The state row holds
// the exact `slot_teams` array that was nested in the create, in order, and the audit
// returns the ids in that same creation order. So live[i] IS previous[i] — a
// correspondence established by our own write, not inferred from content.
//
// Positional overwrite plus append is then TOTAL AND EXACT: patch live[0..M-1] to
// next[0..M-1], create next[M..], and the resulting team set equals `next` field for
// field, whatever order the blocks arrived in. A block inserted in the middle shifts
// what each id holds and changes nothing about the outcome. Ids are not identity here;
// the set is.
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
 * `previous` is the team array this engine last wrote to the order; `live` is what the
 * audit read returned, in creation order.
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
  },
  hooks: AmendHooks
): Promise<AmendResult> {
  const { order_id, previous } = args;
  const next = args.desired.slot_teams ?? [];
  const done = args.alreadyCreated ?? [];

  if (next.some((t) => !t.beginning || !t.end)) {
    // Same rule as the rebuild path: OnSinch would refuse it, and a TBC block is not a
    // booking. Declined rather than refused — the fallback says it better.
    return { declined: `a slot team has no start or finish (the date is still TBC)` };
  }

  const pre = await preflightOrder(client, { order_id, company_id: args.desired.company_id });
  if (pre.refused) return { refused: pre.refused };

  const read = await client.slotTeamsForOrder(order_id);
  /**
   * A resumed run has already appended some of the teams, so the live set is longer
   * than the one we last wrote by exactly that many. Those are ours and are excluded
   * before the correspondence is checked — otherwise the retry declines on its own
   * progress and hands a human an order that is halfway correct.
   */
  const live = done.length ? read.teams.filter((t) => !done.includes(t.id)) : read.teams;
  const plan = planAmendment(previous, next, live);
  if (plan.declined) return { declined: plan.declined };

  const stillToCreate = plan.creates.slice(done.length);
  if (!plan.patches.length && !stillToCreate.length) {
    // Nothing moved. Reached when a resumed run finds its work already done, and when
    // the only change was an order-level field, which the caller patches separately.
    return { amended: { order_id, patched: 0, added: [...done], job_id: read.job_id } };
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
      const was = i >= 0 ? capSlotTeamName(previous[i]).size : undefined;
      if (was === undefined || Number(p.size) >= Number(was)) continue; // growing is safe
      const on = byTeam.get(p.id) ?? 0;
      if (on > 0) {
        return {
          refused:
            `order #${order_id}: crew block "${live[i].name}" is being reduced from ${was} to ${p.size} and ${on} ` +
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
    const job_id = read.job_id;
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

  return { amended: { order_id, patched: plan.patches.length, added, job_id: read.job_id } };
}
