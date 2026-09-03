// ============================================================================
// F1 CANDIDATE — four deterministic changes, kept OUT of the engine until they
// are shown to win.
// ----------------------------------------------------------------------------
// Ben's condition: only touch the venue path if a deterministic fix can be
// VERIFIED to raise accuracy. So this is a separate implementation, scored
// against the same labels as the shipping one, and nothing in app/ changes until
// the numbers say it should.
//
// The four changes, each aimed at a failure observed on real client mail:
//
//   C1  An exact name or alias match is an answer, and it is taken BEFORE the
//       city-only guard runs.               fixes "Garden Studios", "London Stadium"
//   C2  A row that does not know where it is loses to one that does — including
//       on an exact-name tie.               fixes "BDC" -> #6615
//   C3  A named town vetoes a candidate in a different town.
//                                           fixes "Guildhall yard, London" -> Southampton
//   C4  The CANDIDATE's own identifying words must be mostly accounted for by
//       what the client wrote, not only the other way round.
//                                           fixes "Warehouse" -> LOCK Warehouse,
//                                           "Unit 7 Titan Business Estate" -> London
//                                           Business School, "NHM Earth hall" -> BBC
//                                           Earth Experience, "Cromwell Rd" -> 50 Church Rd
//
// C4 is the one that matters. Every wrong building in this benchmark is a case
// where the client's words were a SUBSET of the candidate's name, so forward
// coverage looked perfect while the candidate carried identifying words the
// client never said. "Warehouse" covers 100% of itself and 50% of "LOCK
// Warehouse"; the word LOCK is the whole difference between two buildings.
// ============================================================================

export interface Place {
  id: number; name?: string; alias?: string | null; address?: string | null;
  city?: string | null; zip?: string | null; active?: boolean;
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;
export function postcodesIn(s: unknown): string[] {
  const out: string[] = [];
  for (const m of String(s ?? "").matchAll(POSTCODE)) out.push((m[1] + m[2]).toUpperCase());
  return [...new Set(out)];
}
const outward = (pc: string) => pc.replace(/\d[A-Z]{2}$/, "");

export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ").trim();

/** Words that say what KIND of building it is. They agree far too often to carry a match. */
const WEAK = new Set([
  "arena","centre","center","hall","halls","stadium","park","hotel","rooms","room","house",
  "exhibition","conference","complex","ground","grounds","theatre","theater","gardens","garden",
  "club","building","campus","court","studio","studios","gallery","museum","school","college",
  "church","dock","docks","docklands","quay","wharf","square","street","road","lane","way",
  "avenue","place","gate","yard","suite","suites","bay","warehouse","estate","tower","the",
]);
const STOP = new Set([
  "a","an","at","in","on","of","and","for","to","our","your","ltd","limited","llp","plc",
  "uk","gb","united","kingdom","england","greater","st","nr","near","venue","site","address","loading","reception","area",
]);

interface Tok { strong: string[]; weak: string[]; nums: string[] }
export function tok(text: unknown): Tok {
  let t = String(text ?? "");
  for (const pc of postcodesIn(t)) t = t.replace(new RegExp(pc.replace(/(.{2,4})(\d[A-Z]{2})/i, "$1 ?$2"), "gi"), " ");
  const strong: string[] = [], weak: string[] = [], nums: string[] = [];
  for (const w of norm(t).split(" ").filter(Boolean)) {
    if (/^\d+$/.test(w)) { if (!nums.includes(w)) nums.push(w); continue; }
    if (STOP.has(w)) continue;
    if (WEAK.has(w)) { if (!weak.includes(w)) weak.push(w); continue; }
    if (w.length < 2) continue;
    if (!strong.includes(w)) strong.push(w);
  }
  return { strong, weak, nums };
}

const identity = (p: Place) => tok(`${p.name ?? ""} ${p.alias ?? ""}`);
const hasContext = (p: Place) => !!(p.address || p.city || p.zip);

/** C3 — the towns the tenant actually knows about, learned from its own rows. */
function townIndex(places: Place[]): Set<string> {
  const s = new Set<string>();
  for (const p of places) {
    const c = norm(p.city);
    if (c && c.length > 2) s.add(c);
  }
  return s;
}

export interface Result {
  id?: number;
  why: string;
  /** No row is good enough. Under the new policy this is where a venue is CREATED. */
  create?: boolean;
}

export function resolveCandidate(text: string, places: Place[], towns?: Set<string>): Result {
  const q = tok(text);
  const qpc = postcodesIn(text);
  const T = towns ?? townIndex(places);
  const live = places.filter((p) => p.active !== false);

  // ---------------------------------------------------------------- postcode
  // The strongest key there is: copied rather than remembered, and it names a
  // building rather than describing one.
  if (qpc.length) {
    const exact = live.filter((p) => postcodesIn(p.zip).some((z) => qpc.includes(z)));
    if (exact.length === 1) return { id: exact[0].id, why: "postcode, one row" };
    if (exact.length > 1) {
      const best = exact
        .map((p) => ({ p, s: cover(identity(p).strong, q.strong), ctx: hasContext(p) }))
        .sort((a, b) => b.s - a.s || Number(b.ctx) - Number(a.ctx))[0];
      return { id: best.p.id, why: `postcode, ${exact.length} rows, name agreement picked one` };
    }
  }

  // ---------------------------------------------------------------- C1 + C2
  // An exact name or alias match is an answer. A row that knows where it is
  // beats one that does not, so a context-free shell can never intercept the
  // building it is a copy of.
  const nq = norm(text);
  const exactName = live.filter((p) => norm(p.name) === nq || norm(p.alias) === nq);
  if (exactName.length) {
    const withCtx = exactName.filter(hasContext);
    if (withCtx.length) return { id: withCtx[0].id, why: "exact name/alias, row has an address" };
    // Only shells match. Under the create-when-unresolved policy a shell is not
    // an address, so it is not an answer — but it is not a new building either.
    return { id: exactName[0].id, why: "exact name/alias, but the row carries no address" };
  }

  // ---------------------------------------------------------------- scoring
  const qTowns = q.strong.filter((w) => T.has(w));
  let best: { p: Place; fwd: number; rev: number; score: number } | null = null;

  for (const p of live) {
    const idt = identity(p);
    if (!idt.strong.length && !idt.weak.length) continue;

    // C3 — a named town vetoes a candidate that says it is somewhere else.
    if (qTowns.length) {
      const pc = norm(p.city);
      if (pc && !qTowns.includes(pc)) {
        // …unless the row's own name carries the town the client named.
        if (!idt.strong.some((w) => qTowns.includes(w))) continue;
      }
    }
    // A postcode conflict is a veto too: different districts are different places.
    if (qpc.length) {
      const ppc = postcodesIn(p.zip);
      if (ppc.length && !ppc.some((z) => qpc.includes(z)) && !ppc.some((z) => qpc.some((x) => outward(x) === outward(z)))) continue;
    }

    const fwd = cover(q.strong, idt.strong);          // how much of what the client said the row accounts for
    const rev = cover(idt.strong, q.strong);          // how much of the ROW the client actually said
    if (!q.strong.length && !idt.strong.length) continue;

    const shared = q.strong.filter((w) => idt.strong.includes(w)).length;
    if (!shared) continue;

    // C4 — the floor. Both directions must hold. A candidate carrying identity
    // words the client never wrote is a different building.
    if (rev < 0.6 || fwd < 0.5) continue;

    const weakBonus = cover(q.weak, idt.weak) * 0.15;
    const ctxBonus = hasContext(p) ? 0.12 : 0;        // C2, again, as a tiebreak
    const score = rev * 0.5 + fwd * 0.35 + weakBonus + ctxBonus;
    if (!best || score > best.score) best = { p, fwd, rev, score };
  }

  if (best) return { id: best.p.id, why: `tokens fwd=${best.fwd.toFixed(2)} rev=${best.rev.toFixed(2)}` };
  return { create: true, why: "nothing cleared the floor — create a venue from what the client wrote" };
}

/** Share of `a`'s members present in `b`. 1 when a is empty (nothing to account for). */
function cover(a: string[], b: string[]): number {
  if (!a.length) return 1;
  let hit = 0;
  for (const w of a) if (b.includes(w)) hit++;
  return hit / a.length;
}
