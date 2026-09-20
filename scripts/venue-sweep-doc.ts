// ============================================================================
// Builds the payload for the venue review doc. Read-only, offline.
//
//   npx tsx scripts/venue-sweep-doc.ts
//   -> .tmp-data/venue-sweep-2026-09-18/decisions.json
//
// One entry per DECISION, not per row. 210 rows named "Placeholder" is one
// decision; 221 byte-identical "National Exhibition Centre, Hall 4, ..." rows is
// one decision. That is the whole reason this is reviewable by a person.
//
// Member lists are truncated to a sample. Within a group every row shares a
// normalised name, so eight of them represent two hundred exactly.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { classify, richness, OUT, type Bucket } from "./venue-sweep";

const places: any[] = JSON.parse(fs.readFileSync(path.join(OUT, "snapshot.json"), "utf8"));
const byId = new Map<number, any>(places.map((p) => [Number(p.id), p]));
const c = classify(places);
const n = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The 121 real UK postcode areas. A code that parses but names no real area is a
 * fabricated address — this is the same check August's --enrich used, and it held
 * back "the 134 TX12 rows" on its own.
 */
const AREAS = new Set(
  `AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY
E EC EH EN EX FK FY G GL GU GY HA HD HG HP HR HS HU HX IG IM IP IV JE KA KT KW KY L LA LD LE LL LN LS LU
M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW
SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO ZE`.split(/\s+/)
);

/** Postcodes used in documentation and examples the world over. A venue carrying
 *  one was written by a machine following an example, not by a person. */
const DUMMY = new Set(["EC1A1AA", "EC1A1BB", "AB123CD", "SW1A1AA", "SW1A2AA"]);

/** Streets that do not exist, in the sense that matters: they are what a language
 *  model writes when asked to invent an address. */
const INVENTED = /\b(main street|river street|business road|innovation (drive|way|avenue)|network street|event way|heritage crescent|high street, westbridge|tech city)\b/i;

function fabricationEvidence(name: string): string | null {
  const codes = (name.toUpperCase().match(/\b[A-Z]{1,2}\d{1,2}[A-Z]? ?\d[A-Z]{2}\b/g) ?? []).map((s) =>
    s.replace(/\s+/g, "")
  );
  for (const code of codes) {
    if (DUMMY.has(code)) return `${code} is a documentation-example postcode`;
    const area = code.replace(/[0-9].*$/, "");
    if (!AREAS.has(area)) return `${area} is not a real UK postcode area`;
  }
  const m = name.match(INVENTED);
  if (m) return `"${m[0]}" is an invented street`;
  return null;
}

type Decision = {
  key: string;
  bucket: Bucket | "generic-bare";
  title: string;
  rows: number;
  survivor: number | null;
  survivorName: string;
  proposed: "merge" | "delete" | "judge";
  why: string;
  members: { id: number; name: string; zip: string | null; fields: number; survivor: boolean }[];
  more: number;
};

const SAMPLE = 8;
const decisions: Decision[] = [];

for (const g of c.groups) {
  const members = g.members.map((id) => byId.get(id)).filter(Boolean);
  const head = byId.get(g.survivor);
  const title = String(head?.name ?? "").trim();
  const fab = g.bucket === "shell-group" ? fabricationEvidence(title) : null;

  const proposed: Decision["proposed"] =
    g.bucket === "same-name-diff-postcode" ? "judge" : fab ? "delete" : "merge";

  const why =
    g.bucket === "identical"
      ? "Same name and the same postcode on every row — one venue."
      : g.bucket === "same-name-diff-postcode"
        ? "Same name, DIFFERENT postcodes. Could be one site with two entrances, or two different places. Nothing in the data settles it."
        : g.bucket === "shell-into-locatable"
          ? "One row can locate a job; the rest cannot. They collapse into it."
          : fab
            ? `Fabricated: ${fab}. Not a real venue — created by a workflow, not a client.`
            : "Several rows share this name and NONE carries a postcode. Collapsing them keeps the tenant's only record of the name but does not make it locatable.";

  decisions.push({
    key: "g-" + g.survivor + "-" + g.bucket,
    bucket: g.bucket,
    title,
    rows: members.length,
    survivor: g.survivor,
    survivorName: String(head?.name ?? "").trim(),
    proposed,
    why,
    members: members.slice(0, SAMPLE).map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? "").trim(),
      zip: p.zip ?? null,
      fields: richness(p),
      survivor: Number(p.id) === g.survivor,
    })),
    more: Math.max(0, members.length - SAMPLE),
  });
}

// generic-bare, grouped by name: 210 "Placeholder" rows is ONE decision.
const genericByName = new Map<string, any[]>();
for (const id of c.deletions) {
  const p = byId.get(id);
  if (!p) continue;
  const k = n(p.name);
  const g = genericByName.get(k);
  if (g) g.push(p);
  else genericByName.set(k, [p]);
}
for (const [k, rows] of genericByName) {
  decisions.push({
    key: "gb-" + k.replace(/\s+/g, "-"),
    bucket: "generic-bare",
    title: String(rows[0].name ?? "").trim(),
    rows: rows.length,
    survivor: null,
    survivorName: "",
    proposed: "delete",
    why:
      "The name identifies no building and the row carries nothing that locates one — no postcode, no address, no city. It can only ever be matched by accident.",
    members: rows.slice(0, SAMPLE).map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? "").trim(),
      zip: p.zip ?? null,
      fields: richness(p),
      survivor: false,
    })),
    more: Math.max(0, rows.length - SAMPLE),
  });
}

// Hardest first: judgement calls, then the biggest populations.
const ORDER: Record<string, number> = {
  "same-name-diff-postcode": 0,
  identical: 1,
  "shell-into-locatable": 2,
  "shell-group": 3,
  "generic-bare": 4,
};
decisions.sort((a, b) => (ORDER[a.bucket] ?? 9) - (ORDER[b.bucket] ?? 9) || b.rows - a.rows);

const summary = {
  builtAt: new Date().toISOString(),
  places: places.length,
  decisions: decisions.length,
  rowsCovered: decisions.reduce((a, d) => a + d.rows, 0),
  proposed: decisions.reduce<Record<string, number>>((a, d) => ((a[d.proposed] = (a[d.proposed] ?? 0) + 1), a), {}),
  rowsByProposal: decisions.reduce<Record<string, number>>(
    (a, d) => ((a[d.proposed] = (a[d.proposed] ?? 0) + d.rows), a),
    {}
  ),
};

fs.writeFileSync(path.join(OUT, "decisions.json"), JSON.stringify({ summary, decisions }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log(`\n-> ${path.join(OUT, "decisions.json")}`);
console.log(`\nfabricated groups proposed for deletion:`);
for (const d of decisions.filter((x) => x.proposed === "delete" && x.bucket === "shell-group"))
  console.log(`  x${String(d.rows).padEnd(4)} ${d.title.slice(0, 72)}`);
