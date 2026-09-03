// ============================================================================
// THE GOLD STANDARD — labelled by hand off the tenant's own lists, never derived
// from the code that is under test.
// ----------------------------------------------------------------------------
// This file is the whole reason the study can produce a number worth acting on.
// A ruler paraphrased from the resolver measures whether the paraphrase is
// faithful; a ruler read off the tenant's 43 professions and 5,567 places is a
// judgement about the booking, and it is the only thing that can disagree with
// the engine usefully.
//
// The rigger row is the case that proves the point. An earlier study's scorer
// demanded a Rigger profession and THE TENANT HAS NONE — roughly one case in
// seven drew that role, so for every one of them booking general Crew was the
// correct answer and the scorer marked it wrong. Its 55/100 was partly a
// measurement of itself.
//
// Every id below was read out of .tmp-data/professions.json (43 rows, live) and
// .tmp-data/places.json (5,567 rows, live) on 2026-09-02 and is quoted with the
// row it came from.
// ============================================================================

// ---------------------------------------------------------------- professions
/**
 * The role a client names, and the OnSinch profession a competent booker would
 * put it on. Labelled from the list, in the booker's voice, not the cue table's.
 *
 * `abstain` marks a role the tenant HAS NO ROW FOR. Booking general Crew is the
 * right answer — there is nothing else to book — but doing it SILENTLY is the
 * failure: a rigger quietly booked as labour and a rigger booked as labour with
 * somebody called are the same order and completely different outcomes. The two
 * are scored as separate properties for exactly that reason.
 */
export interface GoldRole {
  key: string;
  /** How a client writes it. The renderer draws from these; the engine sees only these. */
  said: string[];
  /** The profession id a booker would choose. */
  id: number;
  /** The row's name, quoted, so a reader can check the label without the file. */
  row: string;
  /** No row exists for this trade: Crew is correct, silence is not. */
  abstain?: boolean;
  /**
   * The day-rate twin, and the hours at or above which a booker would use it.
   * Only reachable on a STATED shift — the 08:00-18:00 default is ten hours and
   * reading it would put every untimed plant request on a day rate.
   */
  dayTwin?: { id: number; row: string; atHours: number };
}

export const GOLD_ROLES: GoldRole[] = [
  { key: "crew", id: 1, row: "Crew", said: ["crew", "lads", "guys", "general crew", "hands", "crew members", "staff"] },
  { key: "carpenter", id: 3, row: "Carpenter", said: ["carpenters", "chippies", "carps", "joiners"] },
  { key: "cscs", id: 32, row: "CSCS Labourer", said: ["CSCS labourers", "CSCS lads", "cscs labour"] },
  { key: "ipaf", id: 5, row: "IPAF 3a/3b", said: ["IPAF operators", "IPAF 3a/3b", "cherry picker operators (IPAF)", "IPAF 3a/3b operators"] },
  { key: "pasma", id: 6, row: "PASMA", said: ["PASMA trained crew", "PASMA operatives", "PASMA"] },
  {
    key: "forklift", id: 11, row: "Counterbalance B1 (p/hr)",
    said: ["forklift drivers", "FLT drivers", "counterbalance drivers", "forkies"],
    dayTwin: { id: 22, row: " Counterbalance - (Day Rate) ", atHours: 8 },
  },
  {
    key: "telehandler", id: 4, row: "Telehandler U< 9M J2 (p/hr)",
    said: ["telehandler drivers", "telehandler operators", "telehandlers"],
    dayTwin: { id: 23, row: "Telehandler U< 9M J2 (Day Rate) ", atHours: 8 },
  },
  { key: "bar", id: 30, row: "Bar Staff", said: ["bar staff", "bartenders", "bar team"] },
  { key: "steward", id: 52, row: "Steward", said: ["stewards", "stewarding team"] },
  { key: "climber", id: 65, row: "Climber", said: ["climbers", "rope access climbers"] },
  { key: "driver", id: 9, row: "Driver ", said: ["drivers", "van drivers"] },
  { key: "chief", id: 36, row: "Crew Chief", said: ["crew chief", "a crew chief", "crew chiefs"] },
  // ---- no row exists in the tenant. Crew is right; quiet is wrong.
  { key: "rigger", id: 1, row: "Crew (no Rigger row exists)", abstain: true, said: ["riggers", "rigging crew", "riggers (up to height)"] },
  { key: "porter", id: 1, row: "Crew (no Porter row exists)", abstain: true, said: ["porters", "porter team"] },
];

export const ROLE_BY_KEY = new Map(GOLD_ROLES.map((r) => [r.key, r]));

/**
 * Crew Boss 55 exists in the tenant and must be unreachable by any wording
 * (Ben, Q10). It is named here so a scorer can assert its absence rather than
 * forgetting it exists.
 */
export const FORBIDDEN_PROFESSION = 55;
export const CHIEF_ID = 36;

// ---------------------------------------------------------------- venues
/**
 * A venue, the way a client says it, and the place row a booker would put the
 * crew on.
 *
 * `gold` is null where the tenant genuinely has no such venue. THE CORRECT
 * BEHAVIOUR THERE IS THE PLACEHOLDER, NOT A NEW ROW, and this label was wrong
 * the first time it was written.
 *
 * The first draft expected a provision, quoting Ben on 2026-08-09: "if company
 * or venue location are not found in the system, always create new ones if
 * they can be inferred." He reversed the venue half of that on 2026-08-31 —
 * "no unresolved venues should create venues" — and reversed it on evidence:
 * every venue the engine had ever provisioned was replayed through the live
 * search index, and of 19, seven had a strong existing match they duplicated,
 * eight more were rows the tenant already held, two were not venues at all,
 * and exactly one was genuinely new. Eighteen of nineteen grew the tenant for
 * nothing, which is the mechanism behind the 600-odd ExCeL rows. Commit
 * b0b3422.
 *
 * So the expectation for an unheld venue is: book the "No Location" row, and
 * call a human. Scoring the engine against the superseded ruling would have
 * reported 50 failures that were the engine obeying its most recent order.
 *
 * `hard` marks the ambiguities a string search cannot settle. They are kept in
 * the corpus deliberately — a study that removes the cases the system is known
 * to be bad at reports the score of a system nobody runs.
 */
export interface GoldVenue {
  key: string;
  said: string[];
  /** The place row a booker would pick, or null when the tenant holds none. */
  gold: number | null;
  row: string;
  hard?: string;
}

/**
 * The venue an unresolved job is booked to. Verified ABSENT from the live
 * tenant on 2026-09-02 (0 rows named "No Location"), so the first enquiry that
 * needs it creates it and every one after matches it by name.
 */
export const PLACEHOLDER_PLACE_NAME = "No Location";

export const GOLD_VENUES: GoldVenue[] = [
  { key: "bdc", gold: 29, row: "Business Design Centre, 52 Upper Street", said: ["Business Design Centre", "the BDC", "Business Design Centre, Islington"] },
  { key: "museum", gold: 12, row: "The British Museum, Great Russell Street", said: ["The British Museum", "the British Museum", "British Museum"] },
  { key: "stadium", gold: 21, row: "London Stadium, Queen Elizabeth Park", said: ["London Stadium", "the London Stadium"] },
  { key: "dock", gold: 1, row: "Tobacco Dock Ltd, 50 Porters Walk", said: ["Tobacco Dock", "Tobacco Dock Ltd"] },
  { key: "vaults", gold: 22, row: "The Vaults Theatre, Launcelot Street", said: ["The Vaults Theatre", "the Vaults"] },
  { key: "clissold", gold: 44, row: "Clissold House, Stoke Newington Church Street", said: ["Clissold House"] },
  { key: "hilton", gold: 42, row: "Hilton London Canary Wharf, South Quay Square", said: ["Hilton London Canary Wharf", "the Hilton Canary Wharf"] },
  { key: "olympia", gold: 57, row: "Olympia London, Hammersmith Road", said: ["Olympia London", "Olympia", "olympia grand"] },
  { key: "ally", gold: 362, row: "Alexandra Palace, Alexandra Palace Way", said: ["Alexandra Palace", "Ally Pally"] },
  /**
   * THE LIVE ROW, NOT THE ONE THE NAME MATCHES.
   *
   * This was labelled 227 "Battersea Evolution ", which is the name a client
   * writes and is therefore the obvious answer. It is also `active: false` — a
   * retired row. The building was renamed and 78 "Evolution London" is the live
   * record for it, same street and same postcode, SW11 4NJ.
   *
   * The label was corrected because the ADJUDICATOR disagreed with it and was
   * right: "Battersea Evolution is the same venue as Evolution London". A gold
   * standard that is never allowed to lose an argument is not a standard, and
   * this is the one place in this study where the engine corrected the ruler.
   */
  { key: "battersea", gold: 78, row: "Evolution London, Queenstown Road, SW11 4NJ (227 'Battersea Evolution' is the same building, active:false)", said: ["Battersea Evolution"] },
  {
    key: "o2", gold: 7, row: "The O2, Peninsula Square",
    said: ["the O2", "The O2", "the o2 north greenwich", "O2 arena"],
    hard: "7 rows contain 'O2'; the spoken forms carry district names the row does not",
  },
  {
    key: "rah", gold: 2, row: "Royal Albert Hall, Kensington Gore, SW7 2AP (alias RAH)",
    said: ["Royal Albert Hall", "the Albert Hall", "RAH"],
    hard: "id 6177 is a context-free duplicate of the same name; 'RAH' is a 3-char alias",
  },
  {
    key: "excel", gold: 49, row: "ExCel London, 1 Western Gateway, E16 1XL",
    said: ["ExCeL", "ExCeL London", "excel docklands", "Excel"],
    hard: "8 rows are named some spelling of Excel and 6 of them are address-free shells",
  },
  {
    key: "new", gold: null, row: "(no such row — expect a NEW venue created from the client words, then a human merges it)",
    said: ["Thornbury Assembly Rooms, 14 Kestrel Way, Thornbury BS35 2QQ"],
  },
];

export const VENUE_BY_KEY = new Map(GOLD_VENUES.map((v) => [v.key, v]));

/**
 * What the tenant's venue table actually is, measured 2026-09-02, and why the
 * hard cases above are hard rather than unlucky.
 *
 * 5,567 rows. 3,403 of them (61%) carry NO address, city or postcode of any
 * kind. 172 names are duplicated, and the largest groups are plainly not
 * client venues at all — 221 copies of one NEC hall, 210 rows named
 * "Placeholder", 198 of a Brighton centre, 171 named "Unknown". A resolver
 * asked to find a real building is searching a table that is mostly noise, and
 * any venue number in this study is a number about that table as much as about
 * the matcher.
 */
export const TENANT_VENUE_FACTS = {
  rows: 5567,
  withoutAnyAddress: 3403,
  duplicatedNames: 172,
  measured: "2026-09-02",
} as const;
