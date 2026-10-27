// ============================================================================
// A trade the client names -> the OnSinch profession the bot books it as.
// ----------------------------------------------------------------------------
// ORDERS ARE CREATED WHATEVER PROFESSION IS NAMED (Ben, 10-11: "Orders must still be created [DECISIONS V7]
// reguardless of profession, you have a profession list, do your best"). Until then a named
// trade sent the whole email to a person: RG Jones and Wall to Wall (carpenter) and ILEC (AV
// technician) in the first two days of shadow.
//
// The ids are OnSinch's (GET /professions, 10-11). Where one trade has several professions
// (a driver is Carpool 45, Minivan 46 or Driver 9; a forklift is Counterbalance Day Rate 22
// or per hour 11) the candidates are in ops' own order of use across 2,995 orders, Dec 2023
// to Oct 2026, and the planner takes the one ops last booked for THAT client when there is
// one: the profession picks the pricelist line, so a client's own history is the evidence.
// A TRADE THE SYSTEM CANNOT VERIFY IS BOOKED AS STANDARD CREW, never sent to a person (Ben, [DECISIONS V7]
// 10-11: "if you ever cant verify the crew type always book as standard crew"). That covers a
// trade with no live profession (Audio Tech 13, Lighting Tech 14 and Host 35 are deleted;
// rigger and electrician never existed), a trade word the email does not hold, and Security
// while OnSinch has none. The card says "booked as Crew" each time.
// Security is looked up by name in OnSinch's live list rather than fixed: a Security
// profession made in the OnSinch admin (the API cannot create one) is booked from then on.
// A word not listed here is plain crew under the crew-chief rule (Ben, 10-11). [DECISIONS V7]
// ============================================================================

/** named: the profession is looked up in OnSinch's live list by this name, not fixed by id. */
export type Trade = { candidates: string[]; label: string; asCrew?: boolean; named?: RegExp };
export type LiveProfession = { id: string; name: string };

const T = (re: RegExp, candidates: string[], label: string, asCrew = false) => ({ re, t: { candidates, label, asCrew } as Trade });

// First match wins, so the specific forms sit above the general ones.
const TABLE = [
  T(/\bmcr\b.*\b(chief|boss)\b/, ["64"], "MCR Crew Chief"),
  T(/\bmcr\b/, ["63"], "MCR Crew"),
  T(/carpent|chipp(ie|y)|joiner/, ["3"], "Carpenter"),
  T(/(telehand?ler|\bteli\b).*(over|above|>)\s*9|\bj3\b/, ["24", "7"], "Telehandler over 9m"),
  T(/telehand?ler|\bteli\b/, ["23", "4"], "Telehandler"),
  T(/rough ?terrain|all ?terrain/, ["25", "17"], "Rough Terrain"),
  // "Forkies": unmatched, "make it 3 forkies" fell through to plain crew and would have set the crew to 3.
  T(/fork ?lift|forkie|counter ?balance|\bflt\b/, ["22", "11"], "Counterbalance"),
  T(/\bipaf\b.*\b1b\b/, ["53"], "IPAF 1b"),
  T(/\bipaf\b|cherry ?picker|scissor ?lift|boom ?lift|\bmewp\b/, ["5"], "IPAF 3a/3b"),
  T(/\bpasma\b/, ["6"], "PASMA"),
  // After the machines: a "forklift driver" is a forklift, not a driver.
  T(/mini ?van|van driver/, ["46"], "Minivan Driver"),
  T(/car ?pool/, ["45"], "Carpool Driver"),
  T(/driver/, ["45", "46", "9"], "Driver"),
  T(/follow ?spot/, ["12"], "Followspot"),
  T(/\b(av|a\/v|video|vision|led)\b.*\b(tech|techs|technicians?|engineers?|op|ops|operators?)\b/, ["16"], "AV tech"),
  T(/bar ?staff|bartender|barista/, ["30"], "Bar Staff"),
  T(/serving|waiter|waitress|waiting staff/, ["31"], "Serving Staff"),
  T(/steward/, ["52"], "Steward"),
  T(/\bcscs\b/, ["32"], "CSCS Labourer"),
  T(/banksm[ae]n/, ["67"], "Banksman"),
  T(/climber/, ["65"], "Climber"),
  T(/duty manager/, ["40"], "Duty Manager"),
  T(/office temp/, ["42"], "Office Temp"),
  T(/\b(audio|sound)\b.*\b(tech|techs|technicians?|engineers?|op|ops)\b/, ["1"], "audio tech", true),
  T(/\b(lighting|lx)\b.*\b(tech|techs|technicians?|engineers?|op|ops)\b/, ["1"], "lighting tech", true),
  T(/rigger|rigging/, ["1"], "rigger", true),
  T(/electrician|sparks/, ["1"], "electrician", true),
  { re: /security|\bsia\b|door ?(staff|supervisors?)/, t: { candidates: [], label: "Security", named: /security/i } as Trade },
  T(/\bhost(ess)?s?\b/, ["1"], "host", true),
  T(/cleaner|cleaning/, ["1"], "cleaner", true),
];

/** OnSinch's names for the ids above, as ops read them on the TV. */
export const PROFESSION_NAME: Record<string, string> = {
  "1": "Crew", "3": "Carpenter", "4": "Telehandler (per hour)", "5": "IPAF 3a/3b", "6": "PASMA", "7": "Telehandler over 9m (per hour)",
  "9": "Driver", "11": "Counterbalance (per hour)", "12": "Followspot", "16": "AV tech", "17": "Rough Terrain (per hour)",
  "22": "Counterbalance (Day Rate)", "23": "Telehandler (Day Rate)", "24": "Telehandler over 9m (Day Rate)", "25": "Rough Terrain (Day Rate)",
  "30": "Bar Staff", "31": "Serving Staff", "32": "CSCS Labourer", "36": "Crew Chief", "40": "Duty Manager", "42": "Office Temp",
  "45": "Carpool Driver", "46": "Minivan Driver", "52": "Steward", "53": "IPAF 1b", "63": "MCR Crew", "64": "MCR Crew Chief", "65": "Climber", "67": "Banksman",
};

/** The profession a trade names, or null when it names none (plain crew). */
export function tradeOf(words: string | undefined): Trade | null {
  if (!words) return null;
  const q = words.toLowerCase();
  return TABLE.find(({ re }) => re.test(q))?.t ?? null;
}

/**
 * Of a trade's candidates, the one this client's own orders used most recently, else ops' most
 * used. A named trade's candidates are the live professions with its name; with none, null.
 */
export function pickProfession(trade: Trade, clientOrders: any[], live: LiveProfession[] = []): { id: string; fromHistory: boolean } | null {
  const candidates = trade.named ? live.filter((p) => trade.named!.test(p.name)).map((p) => p.id) : trade.candidates;
  if (!candidates.length) return null;
  if (candidates.length === 1) return { id: candidates[0], fromHistory: false };
  const want = new Set(candidates);
  let best: { id: string; at: number } | null = null;
  for (const o of clientOrders) {
    const at = Date.parse(o?.created ?? "") || 0;
    for (const j of ([] as any[]).concat(o?.Job ?? []))
      for (const t of ([] as any[]).concat(j?.SlotTeam ?? []))
        for (const s of ([] as any[]).concat(t?.Slot ?? []))
          if (s?.cancelled !== true && want.has(String(s?.profession_id)) && (!best || at > best.at)) best = { id: String(s.profession_id), at };
  }
  return best ? { id: best.id, fromHistory: true } : { id: candidates[0], fromHistory: false };
}
