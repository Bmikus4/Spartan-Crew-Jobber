// ============================================================================
// The venue adjudicator: one model call that CHOOSES, and cannot search.
// ----------------------------------------------------------------------------
// Ben, 2026-08-25: the alias store must not be the only source. Search OnSinch too,
// and put both answers — the one the alias store remembered and the one the search
// found — in front of a Gemini step that decides between them.
//
// THE MODEL NAMED IN THE BRIEF DOES NOT EXIST. There is no google/gemini-3.5-pro on
// OpenRouter: the 3.5 family ships flash and flash-lite only, and the newest actual
// Pro is gemini-3.1-pro-preview ($2/M in, $12/M out). That is the default here
// because the standing instruction for venue resolution is accuracy above cost and
// time, and SPARTAN_VENUE_MODEL overrides it in one env var.
//
// THE WHOLE SAFETY PROPERTY IS THAT IT IS A CHOOSER. `place_id` must be one of the
// ids handed in, and the caller rejects anything else. The model cannot invent a
// venue, cannot reach the tenant, and cannot widen the search — so the worst it can
// do is pick the wrong candidate from a list a deterministic matcher produced, and
// the best it can do is settle the cases that matcher legitimately cannot.
//
// It is asked to answer "none" freely, because the costs are not symmetric: sending
// crew to the wrong building wastes a day and a client, while declining creates a
// duplicate row that a human can merge later.
// ============================================================================
import type { Building, VenueHit } from "./venueSearch";

export interface AdjudicationInput {
  /** Exactly what the client wrote. Never normalised — the casing carries meaning. */
  text: string;
  /** What the alias store remembered for this wording, if anything. */
  remembered?: { place_id: number; source: "exact" | "fuzzy"; building?: Building } | null;
  /** What searching every building turned up, best first. */
  candidates: VenueHit[];
}

export interface Adjudication {
  decision: "match" | "none";
  place_id: number | null;
  confidence: number;
  reason: string;
  /** How the answer was reached, for the ticket and the log. */
  how: "agreed" | "model" | "model-second-pass" | "no-candidates" | "model-unavailable";
}

/** The JSON shape the model must return. Pinned as a tool so it cannot drift. */
export const ADJUDICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "place_id", "confidence", "reason"],
  properties: {
    decision: { type: "string", enum: ["match", "none"] },
    place_id: { type: ["integer", "null"], description: "MUST be one of the candidate ids given, or null" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", maxLength: 300 },
  },
} as const;

export const VENUE_SYSTEM = `You decide which of several stored venue records a crew booking should be attached to. You are choosing from a list. You are not searching, and you cannot add a venue.

Spartan Crew is a London crew supplier. The venue is where people physically drive to at 6am, so this decision has a cost when it is wrong.

WHAT THE RECORDS ARE LIKE. Many rows describe the same building. They exist because an earlier system created a new row whenever it failed to recognise a venue, using the client's own words as both the name and the address. So a row whose name matches the client's wording perfectly is often the WORST record of that building, and a row carrying a postcode and a street is the one worth booking. Prefer the record that can tell a driver where to go.

RULES, in order of authority:
1. Two records in different postcode districts are DIFFERENT BUILDINGS, however similar their names. The Royal Albert Hall in SW7 and the Albert Hall in Manchester are not the same venue.
2. A record that carries a postcode beats a record that does not, even when the one without matches the client's words more closely.
3. A hall, unit, floor or gate named inside a venue ("Hall S3", "Unit 6") is a location within a building, not a different building. Prefer the building unless the client clearly named the part and a record exists for exactly that part.
4. A city name identifies nothing. "London" or "Birmingham" alone is never a match.
5. The alias record is what this system resolved this exact wording to before, possibly confirmed by a human. Treat a human-confirmed alias as strong evidence, and a fuzzy one as a suggestion.

ANSWER "none" WHENEVER YOU ARE NOT SURE. Sending crew to the wrong building costs a day's work and a client. Declining creates one duplicate row that somebody can merge in ten seconds. These are not close, so decline freely.

place_id MUST be one of the candidate ids given to you. Any other value is discarded and treated as "none".`;

/** One candidate, rendered for the prompt. Facts only — no scores to anchor on. */
function renderCandidate(h: VenueHit, tag?: string): string {
  const b = h.building;
  const e = h.evidence;
  const bits = [
    `id ${b.place_id}${tag ? ` [${tag}]` : ""}`,
    `name: ${b.name || "(none)"}`,
    b.alias ? `alias: ${b.alias}` : null,
    b.address ? `address: ${b.address}` : null,
    b.city ? `city: ${b.city}` : null,
    `postcode: ${b.postcode ?? "NONE RECORDED"}`,
    b.spellings.length > 1 ? `other spellings held: ${b.spellings.slice(1, 4).join(" | ")}` : null,
    `duplicate rows for this building: ${b.members.length}`,
    b.unlocatable ? `CANNOT LOCATE A JOB — no postcode or coordinates on any row` : null,
    `matched on: ${[
      e.postcode_exact && "exact postcode",
      e.outward_match && "postcode district",
      e.exact_spelling && "exact name",
      e.exact_alias && "exact alias",
      e.street_number && "street number",
      `${Math.round(e.token_covered * 100)}% of the client's words`,
    ].filter(Boolean).join(", ")}`,
  ].filter(Boolean);
  return bits.join("\n  ");
}

export function buildAdjudicationPrompt(inp: AdjudicationInput): string {
  const parts: string[] = [];
  parts.push(`The client wrote this venue:\n  "${inp.text}"`);
  if (inp.remembered) {
    const b = inp.remembered.building;
    parts.push(
      `\nWhat this system resolved that exact wording to before (${inp.remembered.source}${
        inp.remembered.source === "exact" ? ", human-confirmed" : ", unconfirmed"
      }):\n  id ${inp.remembered.place_id}${
        b ? `\n  name: ${b.name}\n  postcode: ${b.postcode ?? "NONE RECORDED"}${b.address ? `\n  address: ${b.address}` : ""}` : "  (the record no longer exists)"
      }`
    );
  } else {
    parts.push(`\nThis system has not resolved this wording before.`);
  }
  parts.push(`\nEvery venue in the tenant was searched. The closest are:\n`);
  parts.push(inp.candidates.map((h, i) => `${i + 1}. ${renderCandidate(h)}`).join("\n\n"));
  parts.push(
    `\nWhich record should this booking be attached to? Reply with one of the ids above, or null.`
  );
  return parts.join("\n");
}

/** A model that answers this one question. Injected, for the same reason as Reasoner. */
export interface VenueJudge {
  adjudicate(system: string, user: string): Promise<unknown>;
}

/**
 * Decide. Deterministic wherever it can be, and the model only where it cannot.
 *
 * The agreement short-circuit is not a cost saving dressed up as a rule: when the
 * alias store and the search both name the same record there is nothing for a model
 * to weigh, and asking it anyway introduces a chance of a worse answer than the one
 * already in hand.
 */
export async function adjudicateVenue(
  inp: AdjudicationInput,
  judge: VenueJudge | null
): Promise<Adjudication> {
  const ids = new Set(inp.candidates.map((h) => h.building.place_id));
  if (inp.remembered) ids.add(inp.remembered.place_id);

  if (!inp.candidates.length && !inp.remembered) {
    return { decision: "none", place_id: null, confidence: 1, reason: "no candidate venue matched", how: "no-candidates" };
  }

  const best = inp.candidates[0];
  if (inp.remembered && best && inp.remembered.place_id === best.building.place_id) {
    return {
      decision: "match",
      place_id: best.building.place_id,
      confidence: 1,
      reason: "the alias store and a search of every venue agree",
      how: "agreed",
    };
  }

  if (!judge) {
    /**
     * No model configured. Fall back to the DETERMINISTIC answer rather than to the
     * remembered one: search looked at every building in the tenant, and the alias
     * store looked at one row somebody typed once.
     */
    if (best) {
      return { decision: "match", place_id: best.building.place_id, confidence: 0.5,
               reason: "no adjudicator configured — took the best search result", how: "model-unavailable" };
    }
    return { decision: "match", place_id: inp.remembered!.place_id, confidence: 0.5,
             reason: "no adjudicator configured — took the remembered alias", how: "model-unavailable" };
  }

  /**
   * Three outcomes, not two. "the call failed" and "the model answered with an id
   * nobody offered" both meant `null` at first, and the second pass then kept the
   * model's FIRST answer in both cases — so a model that folded into an invented id
   * under pressure was rewarded with its original overrule. A transport failure
   * means there is no second opinion; an out-of-set answer IS the second opinion,
   * and it is an unusable one.
   */
  type Ask = Adjudication | "failed" | "out-of-set";
  const ask = async (extra?: string): Promise<Ask> => {
    const user = extra ? `${buildAdjudicationPrompt(inp)}\n\n${extra}` : buildAdjudicationPrompt(inp);
    let raw: unknown;
    try { raw = await judge.adjudicate(VENUE_SYSTEM, user); }
    catch (err) { console.error("[venue] adjudicator failed", err); return "failed"; }
    const r = raw as Partial<Adjudication> | null;
    if (!r || typeof r !== "object") return "failed";
    if (r.decision === "none") {
      return { decision: "none", place_id: null, confidence: Number(r.confidence ?? 0),
               reason: String(r.reason ?? "declined"), how: "model" };
    }
    const id = Number(r.place_id);
    /**
     * THE LINE THAT MAKES THIS SAFE. An id that was not offered is not a venue the
     * model found, it is a venue the model invented, and there is no way to tell
     * which from here. Discarded, not investigated.
     */
    if (!Number.isInteger(id) || !ids.has(id)) {
      console.error(`[venue] adjudicator returned an id that was not a candidate: ${JSON.stringify(r.place_id)}`);
      return "out-of-set";
    }
    return { decision: "match", place_id: id, confidence: Number(r.confidence ?? 0),
             reason: String(r.reason ?? ""), how: "model" };
  };

  const first = await ask();
  if (first === "failed" || first === "out-of-set") {
    // The model failed or answered out of set. The deterministic answer stands; a
    // broken adjudicator must not cost the booking.
    if (best) return { decision: "match", place_id: best.building.place_id, confidence: 0.4,
                       reason: "adjudicator unusable — took the best search result", how: "model-unavailable" };
    return { decision: "none", place_id: null, confidence: 0, reason: "adjudicator unusable and no search result", how: "model-unavailable" };
  }

  /**
   * SECOND PASS ON DISAGREEMENT. When the model overrules the deterministic top
   * choice, it is asked once more with the disagreement stated. Agreement on the
   * second pass decides; continued disagreement is a decline rather than a coin
   * toss — the model changing its mind under mild pressure is exactly the signal
   * that neither answer is safe to drive crew to.
   */
  if (first.decision === "match" && best && first.place_id !== best.building.place_id) {
    const second = await ask(
      `NOTE: a deterministic matcher, scoring every venue on postcode, name and edit distance, ` +
      `chose id ${best.building.place_id} ("${best.building.name}"). You chose id ${first.place_id}. ` +
      `One of you is wrong. Consider it again and answer with whichever is right, or null if you are not sure.`
    );
    // No second opinion to be had. The overrule stands on its single answer, which
    // is the same standing it would have had with no second pass at all.
    if (second === "failed") return { ...first, how: "model" };
    // It answered, and the answer was an id nobody offered. That is a model that did
    // not hold, and neither of its answers can be driven to.
    if (second === "out-of-set") {
      return { decision: "none", place_id: null, confidence: 0,
               reason: `the adjudicator overruled the matcher and then answered with a venue that was never offered — neither answer is safe`,
               how: "model-second-pass" };
    }
    if (second.decision === "match" &&
        (second.place_id === first.place_id || second.place_id === best.building.place_id)) {
      return { ...second, how: "model-second-pass" };
    }
    return { decision: "none", place_id: null, confidence: 0,
             reason: `the adjudicator and the matcher disagreed and did not settle (${best.building.place_id} vs ${first.place_id})`,
             how: "model-second-pass" };
  }
  return first;
}
