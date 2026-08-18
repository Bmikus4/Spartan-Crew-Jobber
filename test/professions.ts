// ============================================================================
// Resolving a request's wording to one of the tenant's 43 professions.
//
// Run against the committed list pulled from the live tenant,
// HTML entities, stray spaces, tenant typo and deleted rows included. A fixture
// someone typed by hand would not carry the things that actually break this.
//
// Run: npx tsx test/professions.ts
// ============================================================================
import { resolveProfession, professionNote, normProf, type ProfessionRec } from "../app/lib/engine/professions";
import { composeOrder } from "../app/lib/engine/compose";
import { PROFESSION_LIST } from "../app/lib/engine/professionList";
import { PROFESSION } from "../app/lib/engine/types";

// The committed list, not data/professions.json — data/ is gitignored, and a test
// that reads a file nobody else has is a test that only passes on this machine.
// professionList.ts is generated from the same pull and carries every field this
// needs, the HTML entities and the tenant typo included.
const LIST: ProfessionRec[] = PROFESSION_LIST;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const id = (hint?: string, hours?: number) => resolveProfession(hint, LIST, { hours }).id;

console.log("\n[0] the list is the live one");
{
  ok(LIST.length === 43, "43 professions", String(LIST.length));
  ok(LIST.some((p) => p.deleted), "including deleted rows, which is the point");
  ok(LIST.some((p) => /&lt;|&gt;/.test(p.name)), "and HTML-escaped names");
}

console.log("\n[1] what the old static map already got right stays right");
{
  ok(id("general crew") === PROFESSION.CREW, "crew", String(id("general crew")));
  ok(id("carpenter") === PROFESSION.CARPENTER, "carpenter", String(id("carpenter")));
  ok(id("chippy") === PROFESSION.CARPENTER, "chippy", String(id("chippy")));
  ok(id("CSCS labourer") === PROFESSION.CSCS, "CSCS", String(id("CSCS labourer")));
  ok(id("driver") === PROFESSION.DRIVER, "driver", String(id("driver")));
  ok(id() === PROFESSION.CREW, "nothing said -> Crew");
}

console.log("\n[2] a chief is a chief, never general crew (the old ordering bug)");
{
  ok(id("crew chief") === PROFESSION.CREW_CHIEF, "'crew chief' contains 'crew' and must still be 36", String(id("crew chief")));
  ok(id("crew leader") === PROFESSION.CREW_CHIEF, "crew leader", String(id("crew leader")));
}

console.log("\n[3] Q10: Crew Boss 55 is never resolvable");
{
  ok(LIST.some((p) => p.id === 55), "the tenant does have Crew Boss");
  for (const hint of ["crew boss", "boss", "gang boss", "Crew Boss"]) {
    ok(id(hint) !== 55, `"${hint}" -> not 55`, String(id(hint)));
  }
  ok(id("crew boss") === PROFESSION.CREW_CHIEF, "a boss is booked as a chief", String(id("crew boss")));
}

console.log("\n[4] deleted professions never resolve");
{
  const dead = LIST.filter((p) => p.deleted);
  ok(dead.length === 6, "6 deleted rows in the tenant", String(dead.length));
  for (const p of dead) {
    ok(id(p.name) !== p.id, `"${p.name.trim()}" (#${p.id}) is not bookable`, String(id(p.name)));
  }
}

console.log("\n[5] the 37 the static map could not reach");
{
  ok(id("IPAF 3a/3b") === 5, "IPAF 3a/3b -> 5, was Crew", String(id("IPAF 3a/3b")));
  ok(id("PASMA") === 6, "PASMA -> 6, was Crew", String(id("PASMA")));
  ok(id("steward") === 52, "steward -> 52", String(id("steward")));
  ok(id("bar staff") === 30, "bar staff -> 30", String(id("bar staff")));
  ok(id("followspot") === 12, "followspot -> 12", String(id("followspot")));
  ok(id("climber") === 65, "climber -> 65 (stored with a trailing space)", String(id("climber")));
  ok(id("MCR crew chief") === 64, "MCR Crew Chief -> 64, not 36 — the longer name wins", String(id("MCR crew chief")));
  ok(id("crew AV tech") === PROFESSION.AV, "Crew AV tech -> 16, not Crew", String(id("crew AV tech")));
}

console.log("\n[6] Q8(b): day rate at 8 hours or more, hourly below");
{
  // 4/23 Telehandler U<9M J2, 7/24 O>9M J3, 11/22 Counterbalance, 17/25 Rough Terrain.
  ok(id("telehandler", 6) === 4, "6h telehandler -> 4 (p/hr)", String(id("telehandler", 6)));
  ok(id("telehandler", 8) === 23, "8h telehandler -> 23 (Day Rate)", String(id("telehandler", 8)));
  ok(id("telehandler", 10) === 23, "10h telehandler -> 23", String(id("telehandler", 10)));
  ok(id("counterbalance", 4) === 11, "4h counterbalance -> 11 (p/hr)", String(id("counterbalance", 4)));
  ok(id("counterbalance", 9) === 22, "9h counterbalance -> 22 (Day Rate, stored with stray spaces)", String(id("counterbalance", 9)));
  ok(id("rough terrain", 12) === 25, "12h rough terrain -> 25 (Day rate, lowercase 'rate')", String(id("rough terrain", 12)));
  ok(id("rough terrain", 3) === 17, "3h rough terrain -> 17", String(id("rough terrain", 3)));
}

console.log("\n[6b] the tenant's own typo does not break a pair");
{
  // 7 is "Telehandler O> 9M J3 (p/hr)"; its day-rate half is stored as "Telehander"
  // with the l missing. Compared literally the pair does not exist, and a 10-hour
  // O>9M telehandler silently stays on an hourly rate.
  ok(LIST.some((p) => /Telehander\b/.test(p.name)), "the typo is really in the tenant");
  ok(resolveProfession("Telehandler O> 9M J3", LIST, { hours: 10 }).id === 24,
    "10h O>9M telehandler -> 24 (Day Rate)", String(resolveProfession("Telehandler O> 9M J3", LIST, { hours: 10 }).id));
  ok(resolveProfession("Telehandler O> 9M J3", LIST, { hours: 5 }).id === 7, "5h -> 7 (p/hr)",
    String(resolveProfession("Telehandler O> 9M J3", LIST, { hours: 5 }).id));
}

console.log("\n[7] an unstated shift length does not move anyone onto a day rate");
{
  ok(id("telehandler") === 4, "no hours -> the hourly form, as the static map always booked", String(id("telehandler")));
}

console.log("\n[8] a profession with no twin is untouched by the shift length");
{
  for (const hours of [2, 8, 14]) {
    ok(id("carpenter", hours) === PROFESSION.CARPENTER, `${hours}h carpenter is still 3`, String(id("carpenter", hours)));
  }
}

console.log("\n[9] a confirmed alias is the whole answer");
{
  const m = resolveProfession("riggers", LIST, { aliasId: 65 });
  ok(m.id === 65 && m.why === "alias", "the store's id wins over the text", `${m.id}/${m.why}`);
  const dead = resolveProfession("anything", LIST, { aliasId: 13 });
  ok(dead.id !== 13, "but an alias onto a DELETED profession does not resolve", String(dead.id));
  const boss = resolveProfession("anything", LIST, { aliasId: 55 });
  ok(boss.id !== 55, "nor onto Crew Boss", String(boss.id));
}

console.log("\n[10] Q12: the inference is said out loud, never silent");
{
  const m = resolveProfession("telehandler", LIST, { hours: 9 });
  const note = professionNote("telehandler", m);
  ok(!!note && /23/.test(note) && /rate form inferred/.test(note),
    "the note names the id and says the rate was inferred", note ?? "(none)");
  const plain = professionNote("carpenter", resolveProfession("carpenter", LIST));
  ok(!!plain && !/inferred/.test(plain), "a stated profession is not reported as inferred", plain ?? "(none)");
  const miss = professionNote("interpretive dancer", resolveProfession("interpretive dancer", LIST));
  ok(!!miss && /not recognised/.test(miss), "an unrecognised one says so rather than passing as Crew", miss ?? "(none)");
  ok(professionNote(undefined, resolveProfession(undefined, LIST)) === null, "and saying nothing is not a warning");
}

console.log("\n[11] the normaliser absorbs what the tenant actually stores");
{
  ok(normProf("Telehandler U&lt; 9M J2 (p/hr)").includes("u< 9m"), "HTML entities decoded", normProf("Telehandler U&lt; 9M J2 (p/hr)"));
  ok(normProf(" Counterbalance - (Day Rate) ") === "counterbalance day rate", "stray spaces and punctuation", normProf(" Counterbalance - (Day Rate) "));
}

console.log("\n[12] composed onto a real order");
{
  const compose = (r: any) => composeOrder({
    facts: { requests: [r] } as any, company_id: 1, user_id: 2, place_id: 3,
    pricelist_category_id: 342, jobName: "job", orderName: "order",
  });

  const stated = compose({ date: "2026-08-12", start_time: "07:00", end_time: "19:00", size: 1, profession_hint: "telehandler" });
  ok(stated.order?.slot_teams[0].profession_id === 23, "a stated 12-hour telehandler books the day rate",
    String(stated.order?.slot_teams[0].profession_id));
  ok(stated.warnings.some((w) => /rate form inferred/.test(w)), "and says so on the ticket",
    stated.warnings.find((w) => /profession/.test(w)) ?? "(none)");

  // The 08:00-18:00 default is ten hours. Reading it would move this onto a day rate
  // off an email that said nothing about the hours.
  const silent = compose({ date: "2026-08-12", size: 1, profession_hint: "telehandler" });
  ok(silent.order?.slot_teams[0].profession_id === 4, "an unstated shift stays hourly",
    String(silent.order?.slot_teams[0].profession_id));
  ok(!silent.warnings.some((w) => /rate form inferred/.test(w)), "with no rate inference claimed");

  const pasma = compose({ date: "2026-08-12", start_time: "08:00", end_time: "16:00", size: 2, profession_hint: "PASMA" });
  ok(pasma.order?.slot_teams[0].profession_id === 6, "PASMA reaches 6, where the static map booked Crew",
    String(pasma.order?.slot_teams[0].profession_id));

  const settled = compose({ date: "2026-08-12", size: 1, profession_hint: "riggers", profession_id: 65 });
  ok(settled.order?.slot_teams[0].profession_id === 65, "a settled id beats the wording",
    String(settled.order?.slot_teams[0].profession_id));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
