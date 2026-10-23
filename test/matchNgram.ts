// ============================================================================
// The matcher's name similarity (app/lib/match/ngram.ts): 3-gram TF-IDF cosine, containment and
// Soft TF-IDF, weighted by a corpus so that common words carry almost nothing.
// Offline.  npx tsx test/matchNgram.ts
// ============================================================================
import { clean, grams, corpus, gramCosine, gramContainment, softTfIdf, similarity, jaroWinkler } from "../app/lib/match/ngram";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };

// A corpus shaped like OnSinch's: many London venues and hotels, so those words are common.
const C = corpus([
  "Christie's London", "The Savoy London", "The Ritz London", "The Peninsula London", "Hilton London Metropole",
  "London Marriott Hotel", "Hotel Cafe Royal London", "The Langham London", "Mandarin Oriental Hyde Park, London",
  "Roundhouse", "ExCeL London", "Olympia London", "LABS House", "Business Design Centre", "Royal Naval College Greenwich",
  "Old Royal Naval College", "Tobacco Dock", "Truman Brewery", "The Brewery", "Savoy Place", "Kensington Palace",
  "Natural History Museum", "Science Museum London", "Battersea Evolution", "Alexandra Palace London",
]);

console.log("\n[1] cleaning and 3-grams");
ok(clean("Christie's & Co.") === "christies and co", "apostrophes go, & becomes and, punctuation is a space", clean("Christie's & Co."));
ok(JSON.stringify(grams("ab")) === JSON.stringify([" ab", "ab "]), "a word's edges count", JSON.stringify(grams("ab")));
ok(clean("Café") === "cafe", "accents go", clean("Café"));

console.log("\n[2] the same place written differently scores high");
ok(similarity("Christies", "Christie's London", C) >= 0.8, "Christies / Christie's London", similarity("Christies", "Christie's London", C).toFixed(2));
ok(similarity("ExCel", "ExCeL London", C) >= 0.7, "ExCel / ExCeL London", similarity("ExCel", "ExCeL London", C).toFixed(2));
ok(similarity("Old Royal Naval College", "Royal Naval College Greenwich", C) >= 0.6, "words moved and added", similarity("Old Royal Naval College", "Royal Naval College Greenwich", C).toFixed(2));
ok(gramContainment("LABS House", "Labs House 15-19 Bloomsbury Way, London WC1A 2TH", C) === 1, "a short name wholly inside an address line");
ok(gramCosine("LABS House", "Labs House 15-19 Bloomsbury Way, London WC1A 2TH", C) < 0.6, "and the cosine alone marks it down, which is why containment exists");

console.log("\n[3] different places score low; common words carry almost nothing");
ok(similarity("Mandarin Oriental", "Roundhouse", C) === 0, "no shared groups, 0");
const savoyRitz = similarity("The Savoy London", "The Ritz London", C), savoy = similarity("The Savoy London", "Savoy", C);
// 0.29 over OnSinch's 6,758 names (22 Oct); this 25-name corpus makes the common words less common.
ok(savoyRitz < 0.5, "The Savoy London / The Ritz London share only common words", savoyRitz.toFixed(2));
ok(savoy > savoyRitz + 0.2, "The Savoy London / Savoy share the rare word", savoy.toFixed(2));

console.log("\n[4] Jaro-Winkler and Soft TF-IDF");
ok(Math.abs(jaroWinkler("martha", "marhta") - 0.9611) < 0.001, "the textbook value for martha / marhta", jaroWinkler("martha", "marhta").toFixed(4));
ok(jaroWinkler("abc", "abc") === 1 && jaroWinkler("", "abc") === 0, "identical 1, empty 0");
ok(softTfIdf("Kensington Palce", "Kensington Palace", C) >= 0.9, "a typo still counts as the word", softTfIdf("Kensington Palce", "Kensington Palace", C).toFixed(2));

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
