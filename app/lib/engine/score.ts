// ============================================================================
// score — deterministic port of the n8n "Score Findings" code node.
// OnSinch has NO fuzzy search, so after GET /places?name=... we score the
// candidates against the extracted location string and pick the best, or
// signal "create new" when nothing clears the confidence bar.
// ============================================================================
import type { PlaceCandidate } from "./types";

const MAX_SCORE = 113;
const MATCH_THRESHOLD_PCT = 75;

export interface ScoreResult {
  decision: "match" | "create-new";
  place?: PlaceCandidate;
  match_pct: number;
}

export function scorePlaces(
  locationText: string,
  candidates: PlaceCandidate[]
): ScoreResult {
  const target = (locationText || "").toLowerCase();

  const scored = candidates.map((v) => {
    let score = 0;
    const name = (v.name || "").toLowerCase();
    if (name && target.includes(name)) score += 10;
    if (name.length > 3) score += Math.min(name.length, 20);

    const addr = (v.address || "").toLowerCase();
    if (addr && target.includes(addr)) score += 20;

    const city = (v.city || "").toLowerCase();
    if (city && target.includes(city)) score += 15;

    const zip = (v.zip || "").toLowerCase();
    if (zip && target.includes(zip)) score += 25;

    if (v.address) score += 5;
    if (v.city) score += 5;
    if (v.zip) score += 5;
    if (v.lat) score += 3;
    if (v.lng) score += 3;
    if (v.alias) score += 2;

    return { v, pct: Math.round((score / MAX_SCORE) * 100) };
  });

  scored.sort((a, b) => b.pct - a.pct);
  const best = scored[0];

  if (!best || best.pct < MATCH_THRESHOLD_PCT) {
    return { decision: "create-new", match_pct: best?.pct ?? 0 };
  }
  return { decision: "match", place: best.v, match_pct: best.pct };
}
