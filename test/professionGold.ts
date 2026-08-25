// ============================================================================
// The profession resolver, measured against a hand-labelled gold set.
//
// The corpus study reported "role in the right family 55/100" and that number was
// partly the scorer's fault: it drew from `crew, carpenter, rigger, forklift, ipaf`
// and THE TENANT HAS NO RIGGER. For every rigger case, booking general Crew was the
// correct answer and the scorer marked it wrong. Optimising against that ruler
// would have produced a resolver that invents a role to satisfy a test.
//
// So the labels here are read off the tenant's own 43 rows (app/lib/engine/
// professionList.ts), including the honest label `Crew` where the tenant has no
// such role, and the honest label "call a human" where general Crew is the only
// bookable answer but the client plainly named a trade.
//
// The VOCABULARY is not invented either. It is mined from the profession_hints the
// corpus produced and from 27,830 real messages in data/corpus/sweep-threads.jsonl,
// counted: crew chief 1835, carpenter 682, rigging 413, forklift 380, chippy 608,
// ipaf 203, av tech 164, counterbalance 149, telehandler 144, scissor lift 90,
// crew boss 84, flt 81, steward 70, followspot 49, pasma 48, mewp 46, cherry
// picker 25, banksman 23, labourer 15, climber 5.
//
// Precision and recall are reported PER ROLE and never blended. Booking Crew when
// IPAF was asked for is a different failure from booking Driver when Crew was
// asked for: the first is a job that cannot legally proceed, the second is a
// wasted day. One accuracy number hides which one you have.
//
// Run: npx tsx test/professionGold.ts
// ============================================================================
import { resolveProfession } from "../app/lib/engine/professions";
import { PROFESSION_LIST } from "../app/lib/engine/professionList";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/**
 * `id` is the profession the tenant should be booked for.
 * `flag` means general Crew is the only bookable answer but the client named a
 * trade, so the ticket must call a human rather than book it quietly.
 */
interface Gold { hint: string; id: number; flag?: true; note?: string }

const GOLD: Gold[] = [
  // -- general crew. Crew 1, and SILENT: nobody needs calling about "6 lads".
  { hint: "crew", id: 1 },
  { hint: "general crew", id: 1 },
  { hint: "crew members", id: 1 },
  { hint: "lads", id: 1 },
  { hint: "guys", id: 1 },
  { hint: "hands", id: 1 },
  { hint: "staff", id: 1 },
  { hint: "site crew", id: 1 },
  { hint: "locals", id: 1 },
  { hint: "porters", id: 1, note: "204 real messages; a porter here is general crew" },
  { hint: "stage hands", id: 1 },
  { hint: "stagehands", id: 1 },

  // -- carpenter 3. "chippy" outnumbers "carpenter" in real mail when both
  //    spellings are counted, and neither chippie nor joiner is in the stored name.
  { hint: "carpenter", id: 3 },
  { hint: "carpenters", id: 3 },
  { hint: "chippy", id: 3 },
  { hint: "chippies", id: 3 },
  { hint: "chippies for the build", id: 3 },
  { hint: "joiner", id: 3 },
  { hint: "joiners", id: 3 },
  { hint: "carps", id: 3 },

  // -- IPAF 3a/3b = 5. EVERY MEWP IS THIS. An IPAF job staffed with general crew
  //    cannot legally proceed, and the order looks completely normal.
  { hint: "IPAF", id: 5 },
  { hint: "IPAF operators", id: 5 },
  { hint: "IPAF 3a/3b", id: 5 },
  { hint: "IPAF 3a/3b operators", id: 5 },
  { hint: "IPAF cherry picker operator", id: 5 },
  { hint: "cherry picker operators (IPAF)", id: 5 },
  { hint: "cherry picker operator", id: 5 },
  { hint: "cherrypicker driver", id: 5 },
  { hint: "MEWP operator", id: 5 },
  { hint: "scissor lift operator", id: 5 },
  { hint: "scissorlift", id: 5 },
  { hint: "genie operator", id: 5 },
  { hint: "boom lift operator", id: 5 },
  // A different card, and it must outrank the IPAF cue by naming itself.
  { hint: "IPAF 1b", id: 53 },

  // -- PASMA 6: tower scaffold. 48 real messages.
  { hint: "PASMA", id: 6 },
  { hint: "PASMA trained", id: 6 },
  { hint: "PASMA team", id: 6 },
  { hint: "tower scaffold", id: 6 },

  // -- Driver 9. Last of the vehicle cues, so nothing that names a machine reaches it.
  { hint: "driver", id: 9 },
  { hint: "drivers", id: 9 },
  { hint: "van driver", id: 9 },
  { hint: "minivan driver", id: 46 },
  { hint: "carpool driver", id: 45 },

  // -- Counterbalance 11. THE ONE THAT WAS CONFIDENTLY WRONG: "FLT drivers" landed
  //    on Driver 9 because the stored word "Driver" is longer than the cue "flt".
  { hint: "forklift", id: 11 },
  { hint: "forklift drivers", id: 11 },
  { hint: "fork lift driver", id: 11 },
  { hint: "FLT", id: 11 },
  { hint: "FLT drivers", id: 11 },
  { hint: "forkies", id: 11 },
  { hint: "counterbalance driver", id: 11 },
  { hint: "counterbalance drivers", id: 11 },

  // -- Telehandler 4 (hourly form; the day twin is chosen by shift length elsewhere).
  { hint: "telehandler", id: 4 },
  { hint: "telehandlers", id: 4 },
  { hint: "teleporter", id: 4 },
  { hint: "tele handler driver", id: 4 },

  // -- the roles the tenant names plainly
  { hint: "CSCS", id: 32 },
  { hint: "CSCS labourer", id: 32 },
  { hint: "crew chief", id: 36 },
  { hint: "chiefs", id: 36 },
  { hint: "crew boss", id: 36, note: "Q10: Crew Boss 55 exists and is unreachable" },
  { hint: "MCR crew", id: 63 },
  { hint: "MCR crew chief", id: 64 },
  { hint: "AV tech", id: 16 },
  { hint: "followspot operator", id: 12 },
  { hint: "steward", id: 52 },
  { hint: "stewards", id: 52 },
  { hint: "bar staff", id: 30 },
  { hint: "serving staff", id: 31 },
  { hint: "duty manager", id: 40 },
  { hint: "climber", id: 65 },
  { hint: "climbers", id: 65 },
  { hint: "event staff", id: 62 },
  { hint: "standby crew", id: 58 },
  { hint: "freelancer", id: 56 },
  { hint: "office temp", id: 27 },

  /**
   * -- CREW, BUT CALL SOMEBODY. The tenant has no row for these and general Crew is
   * the only thing that can be booked, but the client named a trade and somebody
   * should decide rather than the engine deciding silently.
   *
   * "rigger" is the live example and it is the study's 45 "misses": 58 real
   * messages say rigger, 413 say rigging, and there is no Rigger in the tenant.
   * Climber 65 is the nearest row and whether a rigger should book as one is BEN'S
   * CALL — it is not a thing to guess in a resolver, so the flag asks him once
   * instead of the engine guessing every time.
   */
  { hint: "rigger", id: 1, flag: true },
  { hint: "riggers", id: 1, flag: true },
  { hint: "rigging crew", id: 1, flag: true },
  { hint: "riggers (up to height)", id: 1, flag: true },
  { hint: "banksman", id: 1, flag: true },
  { hint: "labourer", id: 1, flag: true, note: "CSCS Labourer 32 claims a card they may not hold" },
  // Crew Audio Tech 13, Crew Lighting tech 14 and Host/Hostess 35 are DELETED in the
  // tenant, so Crew is right — and worth a human deciding whether AV tech 16 fits.
  { hint: "audio tech", id: 1, flag: true },
  { hint: "lighting tech", id: 1, flag: true },
  { hint: "hostess", id: 1, flag: true },
];

// ---------------------------------------------------------------- measure
const resolved = GOLD.map((g) => ({ g, m: resolveProfession(g.hint, PROFESSION_LIST) }));

console.log("\n[1] every hint resolves to the labelled profession");
{
  const wrong = resolved.filter((r) => r.m.id !== r.g.id);
  for (const r of wrong) {
    console.log(`  MISS  ${JSON.stringify(r.g.hint)}: want ${r.g.id}, got ${r.m.id} ${r.m.name} (by ${r.m.why})`);
  }
  ok(wrong.length === 0, `${GOLD.length - wrong.length}/${GOLD.length} correct`, wrong.length ? `${wrong.length} wrong` : "");
}

console.log("\n[2] per-role precision and recall — never blended");
{
  const ids = [...new Set(GOLD.map((g) => g.id))].sort((a, b) => a - b);
  for (const id of ids) {
    const want = resolved.filter((r) => r.g.id === id);
    const got = resolved.filter((r) => r.m.id === id);
    const tp = got.filter((r) => r.g.id === id).length;
    const recall = tp / want.length;
    const precision = got.length ? tp / got.length : 1;
    const name = want[0].m.name || String(id);
    const line = `${String(id).padStart(3)} ${name.padEnd(26)} recall ${tp}/${want.length}  precision ${tp}/${got.length}`;
    ok(recall === 1 && precision === 1, line);
  }
}

console.log("\n[3] no SILENT default where a trade was named");
{
  // The highest-value assertion in this file. A block that lands on general Crew
  // while the client's words named something specific has to raise its hand.
  const silent = resolved.filter((r) => r.g.flag && !r.m.unrecognised);
  for (const r of silent) console.log(`  SILENT  ${JSON.stringify(r.g.hint)} -> Crew with nothing said`);
  ok(silent.length === 0, `all ${resolved.filter((r) => r.g.flag).length} unknown trades call a human`);

  // And the other half: a general word must NOT raise its hand, or the flag is noise.
  const noisy = resolved.filter((r) => !r.g.flag && r.m.unrecognised);
  for (const r of noisy) console.log(`  NOISE   ${JSON.stringify(r.g.hint)} flagged, but it is general crew`);
  ok(noisy.length === 0, "and no ordinary crew request does");
}

console.log("\n[4] the three failures that cost money, named");
{
  const at = (h: string) => resolveProfession(h, PROFESSION_LIST);
  ok(at("FLT drivers").id === 11, "'FLT drivers' is a forklift, not a van driver (was Driver 9)");
  ok(at("IPAF operators").id === 5, "'IPAF operators' is IPAF, not general crew (was Crew 1)");
  ok(at("cherry picker operator").id === 5, "a cherry picker is a MEWP and needs the card (was Crew 1)");
  ok(at("chippies").id === 3, "'chippies' is a carpenter — still true after the cue table moved");
  ok(at("crew boss").id === 36, "'crew boss' is Crew Chief 36, never Crew Boss 55 (Q10)");
  ok(at("MCR crew chief").id === 64, "'MCR crew chief' stays 64 — a stored name that REFINES the cue still wins");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
