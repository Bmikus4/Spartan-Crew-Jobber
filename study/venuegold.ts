// ============================================================================
// HAND LABELS for the real venue wordings that carry no postcode.
// ----------------------------------------------------------------------------
// The postcode-scorable half of the benchmark needs no opinion: a postcode names
// a building. This is the other half, and it is where the engine's real failures
// live — nicknames, halls inside museums, bare street names, a client's own
// warehouse.
//
// Labelled on 2026-09-03 by reading each wording against the tenant's own rows,
// with the candidate list in front of me. Three verdicts:
//
//   <id>        the row a booker would put the crew on
//   CREATE      the tenant genuinely holds no such venue — a new row is correct
//   AMBIGUOUS   the words do not identify one building, and a competent person
//               would ask. NOT SCORED, in either direction.
//
// AMBIGUOUS is doing real work here and it is not a hedge. "Goodwood" is five
// rows in this tenant — House, Motor Circuit, Racecourse, Festival of Speed, and
// a context-free "Goodwood" — and they are miles apart. Scoring the engine for
// picking one would be scoring a coin toss, and scoring it wrong for picking one
// would be worse. Nine wordings are marked this way and the report says so.
// ============================================================================

export type VenueLabel = number | "CREATE" | "AMBIGUOUS";

export const NO_POSTCODE_GOLD: Record<string, { label: VenueLabel; why: string }> = {
  // ---- correct today, kept in so a change cannot silently break them
  "Guildhall": { label: 33, why: "London Guildhall, 71 Basinghall Street EC2V 7HH. Four address-free duplicates exist and it beats them today" },
  "Battersea Arts Centre": { label: 390, why: "exact name, Lavender Hill SW11 5TN" },
  "Olympia Kensington": { label: 57, why: "Olympia London, Hammersmith Road W14 8UX" },
  "Olympia London": { label: 57, why: "exact name" },
  "Clissold House": { label: 44, why: "exact name" },
  "ExCeL London": { label: 49, why: "ExCel London, 1 Western Gateway E16 1XL" },
  "ExCel": { label: 49, why: "the tenant's own spelling of the same building" },
  "ExCel London": { label: 49, why: "exact name" },
  "Excel": { label: 49, why: "same building" },
  "Excel London": { label: 49, why: "same building" },
  "Excel, London": { label: 49, why: "same building" },
  "Excel Centre": { label: 49, why: "same building" },
  "ExCeL London, Maritime Suites": { label: 49, why: "Maritime Suites is a room inside ExCeL, not another venue" },
  "133 Houndsditch, London": { label: 771, why: "exact address" },
  "Claridge's, London": { label: 148, why: "exact name" },
  "Festival Hall": { label: 206, why: "Royal Festival Hall, Belvedere Road SE1 8XX" },
  "Four Seasons Hotel, Trinity Square": { label: 442, why: "Four Seasons London at Trinity Square, 10 Trinity Square EC3N 4AJ" },
  "Gala Festival, Peckham Rye Park": { label: 498, why: "Peckham Rye Park & Common — the festival is the event, the park is the venue" },
  "King's Cross": { label: 409, why: "exact name" },
  "Lord's Cricket Ground": { label: 117, why: "exact name" },
  "Magazine": { label: 226, why: "Magazine London, 11 Ordnance Crescent SE10" },
  "Royal Lancaster loading Bay": { label: 682, why: "Royal Lancaster London — the loading bay is a door, not a venue" },
  "Salesforce Tower": { label: 76, why: "exact name" },
  "Shoreditch House": { label: 175, why: "exact name" },
  "Sofitel, London Heathrow": { label: 130, why: "Sofitel London Heathrow" },
  "Tate Modern": { label: 109, why: "exact name" },
  "The Brewery": { label: 221, why: "The Brewery, 52 Chiswell Street EC1Y" },
  "Truman Brewery": { label: 854, why: "exact name" },
  "Goodwood Motor Circuit": { label: 629, why: "exact name; distinct from Goodwood House and the Racecourse" },
  "Granger Hertzog": { label: 1570, why: "Granger Hertzog Ltd" },
  "Ham Yard Hotel": { label: 278, why: "exact name" },
  "NHM Cromwell Road London": { label: 36, why: "Natural History Museum (NHM), Cromwell Road SW7 5BD" },
  "Stoke Park": { label: 336, why: "exact name" },
  "Tobacco Dock": { label: 1, why: "Tobacco Dock Ltd, 50 Porters Walk E1W 2SF" },
  "loading bay lift at the London Hilton Metropole": { label: 257, why: "Hilton London Metropole, 225 Edgware Road W2 1JU" },
  "Big Penny Social": { label: 1758, why: "exact name" },
  "Blackout HQ": { label: 24, why: "280 Western Road SW19 2QA; #6619 is an address-free duplicate" },
  "Fulham Football Club, Gate 50, ///sugars.takes.scam": { label: 1455, why: "Fulham FC; the gate and the what3words are a meeting point" },
  "Gate 50 Fulham Football Club": { label: 1455, why: "same" },
  "HSBC Championships Queen's Club": { label: 476, why: "Queen's Club, Palliser Road W14 9EQ — HSBC Championships is the event" },
  "Reception Area of Bridgewater Hall which is opposite the main entrance": { label: 6705, why: "The Bridgewater Hall, Manchester" },
  "Reception Area of Bridgewater Hall, Manchester": { label: 6705, why: "same" },
  "Reception Area of Bridgewater Hall, opposite the main entrance": { label: 6705, why: "same" },
  "Roundhouse": { label: 11, why: "Chalk Farm Road NW1 8EH" },
  "Shangri-La": { label: 127, why: "Shangri-La The Shard, London" },
  "Stoke Park, The 9th Fairway, via the Pavilion Carpark": { label: 336, why: "Stoke Park; the fairway is a meeting point" },
  "The 9th Fairway, via the Pavilion Carpark, Stoke Park": { label: 336, why: "same" },
  "The British Museum": { label: 12, why: "exact name" },
  "Whitfield Studios": { label: 6658, why: "50a Charlotte Street W1T" },
  "Grays Inn, South square WC1": { label: 664, why: "Grays Inn - Theobalds Road WC1R 5NR; South Square is inside the Inn" },
  "29 Market Street, Maidenhead": { label: 6789, why: "the row carries that exact address, though its name is null" },

  // ---- WRONG today. These are the fix targets.
  "BDC": { label: 29, why: "Business Design Centre, 52 Upper Street N1 0QH. Today it matches #6615, a row named 'BDC' with no address at all" },
  "Garden Studios, NW10 London": { label: 105, why: "Garden Studios, 21 Waxlow Road NW10 7NU. Today: no answer — 'garden' and 'studios' are both building-type words, so the name yields no strong token" },
  "1 Hotel": { label: 737, why: "1 Hotel Mayfair, 3 Berkeley Street W1J 8DL. Today: no answer" },
  "NHM Earth hall": { label: 36, why: "Earth Hall is a gallery INSIDE the Natural History Museum. Today it matches 'BBC Earth Experience' on the word Earth" },
  "Guildhall yard": { label: 33, why: "Guildhall Yard is the courtyard of the London Guildhall. Today it matches Guildhall Square, SOUTHAMPTON" },
  "Guildhall yard, London": { label: 33, why: "and this one says London in the text, and still matches Southampton" },
  "Unit 7 Titan Business Estate": { label: "CREATE", why: "no Titan row in the tenant. Today it matches 'London Business School' on the word Business" },
  "Walled Garden": { label: "CREATE", why: "no such row; the tenant holds nothing like it" },
  "Gate 50 W3W: ///sugars.takes.scam": { label: "CREATE", why: "a what3words reference and a gate number, no venue named. No answer today, which is defensible; under a create-when-unresolved policy this is the shape that must NOT create a row" },

  // ---- genuinely ambiguous. Not scored either way.
  "Goodwood": { label: "AMBIGUOUS", why: "five rows — House, Motor Circuit, Racecourse, Festival of Speed, and a context-free 'Goodwood'. Miles apart" },
  "Cromwell Rd": { label: "AMBIGUOUS", why: "five rows on Cromwell Road including the V&A and the NHM. Today it matches '50 Church Rd' in SW19, which is not on Cromwell Road at all" },
  "Commercial St": { label: "AMBIGUOUS", why: "three rows on Commercial Street E1" },
  "Blackout Warehouse": { label: "AMBIGUOUS", why: "the tenant has 'Blackout HQ' but no Blackout warehouse. Today it matches LOCK Warehouse, which is certainly wrong, but the right answer is a question" },
  "EC warehouse": { label: "AMBIGUOUS", why: "as above — matches LOCK Warehouse today" },
  "Warehouse": { label: "AMBIGUOUS", why: "one generic word. Matching it to any specific building is the failure; today it matches LOCK Warehouse" },
  "Blackout Warehouse ": { label: "AMBIGUOUS", why: "trailing-space variant of the same" },
};

/** Wordings the current resolver answers with a building that is certainly wrong. */
export const KNOWN_WRONG = [
  "BDC", "NHM Earth hall", "Guildhall yard", "Guildhall yard, London",
  "Unit 7 Titan Business Estate", "Cromwell Rd", "Warehouse", "EC warehouse", "Blackout Warehouse",
];
