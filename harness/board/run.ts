// ============================================================================
// The email-to-board harness (addendum Prompt 13, the owner's design of 26 Oct). $0 here: the one AI step
// is a Claude subagent run outside this script on .tmp-data/board/, never OpenRouter.
// ----------------------------------------------------------------------------
// For each of the 20 cases (cases.ts): what it asks for, what the board showed, what it should have shown,
// and the first stage where they part, for two readers side by side: production's stored reading, and a
// subagent's reading of the very prompt production sent (a subagent is not production's reader).
//   npx tsx harness/board/run.ts --requests    the prompts (requests/), and the labelling briefs (gold-requests/)
//   npx tsx harness/board/run.ts --compare     both readers through ground, plan, card and label; the report
// Board gold: the card kind from the two-reader labels; the target and the change, which those labels do not
// carry, from two blind label subagents (gold-a/, gold-b/), a third settling splits (gold-c/).
// Writes eval/board/<date>.md: ids, codes and counts only. The folder .tmp-data/board/ holds email text and is
// gitignored; nothing here prints it.
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM, PROMPT_ID, userPrompt } from "../../app/lib/v2/interpret/extract";
import { ROOT, gold, sha256 } from "../real/data";
import { loadLabels, labelPath, type Label } from "../real/labels";
import { replay } from "../real/replay";
import type { Case } from "./cases";
import { firstMiss, LABEL_OF, type BoardCard, type BoardGold, type Change, type Stage } from "./board";

const DIR = join(ROOT, ".tmp-data/board");
const sub = (d: string) => join(DIR, d);
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const cases = (): Case[] => json(join(ROOT, "eval/board/cases.json"));

/** The labelling brief, the same for every blind labeller. Its hash goes in the report. */
export const GOLD_BRIEF = `You label one email sent to Spartan Crew, a London crew-hire agency, as an experienced booking coordinator would act on it.
Read the request file: "user" holds the email exactly as the system read it (its date, sender, subject, newest words, and the context: the thread's earlier emails and the client's bookings with their R numbers).
Answer with ONE JSON object and nothing else:
{"card": "none" | "needs-created" | "needs-updated" | "reply-with-work",
 "target": "R<number>" | "NEW" | "NONE",
 "change": [{"kind": "new_shift" | "change_times" | "change_crew" | "cancel" | "po", "date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM", "crew": <number>}]}
card: none = nothing for the office to do; needs-created = a booking to make (no order holds it yet); needs-updated = an existing order to change; reply-with-work = a reply is needed and it asks for crew (a quote or a question naming days and crew).
target: the order the email is about, by the R number in the context, NEW for a booking no order holds, NONE when nothing is booked or changed.
change: each change the email asks for, with only the fields the email gives; [] when none.`;

/** The card kind both readers' labels imply, or null when they do not settle it. */
function cardFromLabels(l: Label, k: Case["kind"]): BoardCard | null {
  if (l.consensus.nothing) return "none";
  if (k === "change" || k === "cancel") return "needs-updated";
  if (k === "new booking" || k === "acceptance") return "needs-created";
  if (k === "reply for crew") return "reply-with-work";
  return null;
}

function settle(a: any, b: any, c: any): { v: any; by: string } | null {
  const key = (x: any) => JSON.stringify(x ?? null);
  if (a !== undefined && b !== undefined && key(a) === key(b)) return { v: a, by: "two labellers" };
  if (c !== undefined && (key(c) === key(a) || key(c) === key(b))) return { v: c, by: "the third labeller" };
  return null;
}

function goldFor(c: Case, labels: Map<string, Label>): BoardGold | null {
  const read = (d: string) => (existsSync(join(sub(d), `${c.message_id}.json`)) ? json(join(sub(d), `${c.message_id}.json`)) : undefined);
  const [a, b, x] = [read("gold-a"), read("gold-b"), read("gold-c")];
  const l = labels.get(c.message_id);
  const card = (l && cardFromLabels(l, c.kind)) ?? settle(a?.card, b?.card, x?.card)?.v;
  const target = settle(a?.target, b?.target, x?.target);
  // The change settles on its kinds; of the agreeing answers the one giving more (a date) is kept. Dates are
  // checked at the grounding stage, so two labellers who agree what is asked are not split by one omitting it.
  const kinds = (ch: Change[] | undefined) => (ch ? ch.map((c) => c.kind).sort() : undefined);
  const byKinds = settle(kinds(norm(a?.change)), kinds(norm(b?.change)), kinds(norm(x?.change)));
  const fullest = [norm(a?.change), norm(b?.change), norm(x?.change)].filter((c): c is Change[] => !!c && JSON.stringify(kinds(c)) === JSON.stringify(byKinds?.v))
    .sort((p, q) => JSON.stringify(q).length - JSON.stringify(p).length)[0];
  const change = byKinds && fullest ? { v: fullest, by: byKinds.by } : null;
  if (!card || !target || !change) return null;
  return { card, target: target.v, change: change.v, label: LABEL_OF[card as BoardCard], by: `card: ${l && cardFromLabels(l, c.kind) ? "the two-reader labels" : "labellers"}; target: ${target.by}; change: ${change.by}` };
}
const norm = (ch: any): Change[] | undefined => Array.isArray(ch) ? ch.map((x: any) => ({ kind: x.kind, ...(x.date ? { date: x.date } : {}), ...(x.start ? { start: x.start } : {}), ...(x.end ? { end: x.end } : {}), ...(x.crew ? { crew: Number(x.crew) } : {}) }))
  .sort((p: Change, q: Change) => JSON.stringify(p).localeCompare(JSON.stringify(q))) : undefined;

async function writeRequests(): Promise<void> {
  for (const d of ["requests", "responses", "gold-requests", "gold-a", "gold-b", "gold-c"]) mkdirSync(sub(d), { recursive: true });
  const cs = cases();
  let n = 0;
  await replay(cs.map((c) => c.message_id), () => [], {
    onExtract: (id, [sentIso, from, subject, newest, context]) => {
      if (!cs.some((c) => c.message_id === id)) return;
      const user = userPrompt(sentIso, from, subject, newest, context);
      writeFileSync(join(sub("requests"), `${id}.json`), JSON.stringify({ message_id: id, prompt_id: PROMPT_ID, system: SYSTEM, user }, null, 1));
      writeFileSync(join(sub("gold-requests"), `${id}.json`), JSON.stringify({ message_id: id, brief: GOLD_BRIEF, user }, null, 1));
      n++;
    },
  });
  console.log(`${n} requests written to .tmp-data/board/requests and gold-requests (prompt ${PROMPT_ID}, brief ${sha256(GOLD_BRIEF).slice(0, 8)})`);
}

async function compare(): Promise<void> {
  const cs = cases();
  const labels = new Map([...loadLabels(labelPath("all")), ...loadLabels(labelPath("prospective"))].map((l) => [l.message_id, l]));
  const orders = gold<any[]>("orders.json");
  const byNumber = new Map(orders.map((o: any) => [`R${o.number}`, o]));
  const orderIdOf = (r: string) => (byNumber.get(r) ? Number(byNumber.get(r).id) : null);
  const orderCompany = (r: string) => (byNumber.get(r) ? Number(byNumber.get(r).company_id) : null);
  const readings = new Map<string, any>();
  for (const f of existsSync(sub("responses")) ? readdirSync(sub("responses")) : []) {
    try { readings.set(f.replace(/\.json$/, ""), json(join(sub("responses"), f))); } catch { /* an unreadable answer is a reader miss */ }
  }
  const ids = cs.map((c) => c.message_id);
  const stored = await replay(ids);
  const agent = await replay(ids, () => [], { readings });
  if (stored.modelCalls || stored.netAttempts || agent.modelCalls || agent.netAttempts) throw new Error("the replay called out");
  const meta = existsSync(join(DIR, "subagent.json")) ? json(join(DIR, "subagent.json")) : {};
  const rows: string[] = [];
  const tally = new Map<string, number>();
  const count = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  let golded = 0;
  for (const c of cs) {
    const g = goldFor(c, labels);
    if (!g) { rows.push(`| ${c.message_id} | ${c.kind} | no gold (labellers split) | | | | |`); count("no gold"); continue; }
    golded++;
    const a = stored.rows.get(c.message_id)!, b = agent.rows.get(c.message_id)!;
    const sa = firstMiss({ ...a, grounded: stored.grounded.get(c.message_id) }, g, orderCompany, orderIdOf);
    const sb = readings.has(c.message_id) ? firstMiss({ ...b, grounded: agent.grounded.get(c.message_id) }, g, orderCompany, orderIdOf) : { stage: "asks" as Stage, why: "the subagent gave no reading" };
    // The stage both part at says whose it is: reading what is asked is the reader's (both of them, when
    // both miss it); the card and label are the display's; the rest is the code between them.
    const cause = !sa ? "-" : !sb ? "reader" : sb.stage !== sa.stage ? "reader and code"
      : sa.stage === "asks" ? "reader (both)" : ["card kind", "card text", "label"].includes(sa.stage) ? "display" : "code";
    if (sa) count(`production: ${sa.stage}`);
    if (sb) count(`subagent: ${sb.stage}`);
    if (sa) count(`cause: ${cause}`);
    rows.push(`| ${c.message_id} | ${c.kind} | ${g.card}, ${g.target} | ${a.card ?? "none"} (${a.code}) | ${sa ? `${sa.stage}: ${sa.why}` : "matches"} | ${b.card ?? "none"} (${b.code}) | ${sb ? `${sb.stage}: ${sb.why}` : "matches"} | ${cause} |`);
  }
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(join(ROOT, "eval/board"), { recursive: true });
  const md = [
    `# Email to board, ${date}`, "",
    `20 cases of D-cur (harness/board/cases.ts, eval/board/cases.json). Production's stored reading and a subagent's reading of the`,
    `same prompt (${PROMPT_ID}), each through ground, plan, card and label on the time-correct world ($0, no network).`,
    `Subagent: ${meta.model ?? "?"}, brief ${meta.brief ?? "?"}. Gold: card from the two-reader labels; target and change from two blind`,
    `labellers and a third on their splits (${meta.gold_model ?? "?"}, brief ${sha256(GOLD_BRIEF).slice(0, 8)}). ${golded} of ${cs.length} have gold.`, "",
    `A miss is named by the first stage where the board parts from gold (client, asks, grounding, target, ops, card kind,`,
    `label; card text has no gold and is not judged). Its cause: **reader** when the subagent's reading reaches the gold board`,
    `and production's does not; **reader (both)** when both readings miss what is asked; **display** when both part at the`,
    `card or label; **code** when both part at a stage between; **reader and code** when they part at different stages.`,
    `A quote with its shifts booked To Confirm answers a reply-with-work gold (Ben 10-13). A subagent is not production's`,
    `reader: the two columns are side by side, not a verdict.`, "",
    "| email | kind | gold | production's board | production's first miss | subagent's board | subagent's first miss | cause |",
    "|---|---|---|---|---|---|---|---|",
    ...rows, "",
    "**Totals**", "",
    ...[...tally].sort((p, q) => p[0].localeCompare(q[0])).map(([k, n]) => `- ${k}: ${n}`), "",
  ].join("\n");
  writeFileSync(join(ROOT, `eval/board/${date}.md`), md);
  console.log(`eval/board/${date}.md: ${golded} with gold; ${[...tally].map(([k, n]) => `${k} ${n}`).join("; ")}`);
}

const mode = process.argv.includes("--requests") ? writeRequests : process.argv.includes("--compare") ? compare : null;
if (process.argv[1]?.replace(/\\/g, "/").endsWith("harness/board/run.ts")) {
  if (!mode) { console.error("--requests | --compare"); process.exit(2); }
  mode().catch((e) => { console.error(String(e?.message ?? e).slice(0, 300)); process.exit(1); });
}
