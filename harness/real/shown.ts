// ============================================================================
// What production's TV showed for each email: recorded once, at the code production ran.
// ----------------------------------------------------------------------------
// score-production drew production's stored decisions through the TV code on disk, so a change to
// that code rewrote "what production did". With the held patch applied, the live week's silent
// misses read 8 of 90 instead of the 16 production had, and production's dev recall read 83.7%
// instead of 65.2% (audit/red-team-B.md H7, 10-26). The card a decision was shown as is a fact of
// its time, like the decision itself: eval/harness/production-shown.jsonl holds it per email, ids and
// codes only, frozen at `frozen_at` (the app code production ran when the gold copy was taken).
// `--display current` on score-production still draws production's decisions through the code on
// disk: that is a different question (what would the new TV have shown for the same decisions) and
// is reported under its own name.
//   npx tsx harness/real/shown.ts --freeze    (only at production's code; refuses a dirty app/)
// ============================================================================
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { GOLD, GOLD_IS_DEFAULT, ROOT, datasetHash, gold, type GoldDecision, type GoldMessage } from "./data";

export const SHOWN = join(ROOT, `eval/harness/production-shown${GOLD_IS_DEFAULT ? "" : "-" + basename(GOLD)}.jsonl`);
export type Shown = { message_id: string; outcome: string; card: string | null; code: string; proposes_new: boolean; carried_by: string | null };
type Meta = { frozen_at: string; dataset: string; rows: number };

let cache: { meta: Meta; rows: Map<string, Shown> } | null = null;
export function loadShown(): { meta: Meta; rows: Map<string, Shown> } {
  if (cache) return cache;
  if (!existsSync(SHOWN)) throw new Error(`${SHOWN} is missing: production's shown outcomes are frozen once (harness/real/shown.ts --freeze)`);
  const [head, ...lines] = readFileSync(SHOWN, "utf8").replace(/\r\n/g, "\n").trim().split("\n");
  const meta = JSON.parse(head) as Meta;
  if (meta.dataset !== datasetHash()) throw new Error(`production-shown.jsonl was frozen on dataset ${meta.dataset}; the gold copy is ${datasetHash()}`);
  cache = { meta, rows: new Map(lines.map((l) => JSON.parse(l) as Shown).map((s) => [s.message_id, s])) };
  return cache;
}

if (process.argv.includes("--freeze")) void (async () => {
  const dirty = execSync("git status --porcelain -- app", { cwd: ROOT, encoding: "utf8" }).trim();
  if (dirty) throw new Error("app/ has uncommitted changes: freeze only at the code production runs");
  const sha = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const { productionRows } = await import("./system");
  const msgs = new Set(gold<GoldMessage[]>("messages.json").map((m) => m.message_id));
  const ids = gold<GoldDecision[]>("decisions.json").map((d) => d.message_id).filter((id) => msgs.has(id)).sort();
  const rows = productionRows(ids, "current");
  const out = [JSON.stringify({ frozen_at: sha, dataset: datasetHash(), rows: rows.size } satisfies Meta),
    ...[...rows.values()].map((r) => JSON.stringify({ message_id: r.message_id, outcome: r.outcome, card: r.card, code: r.code, proposes_new: r.proposes_new, carried_by: r.carried_by } satisfies Shown))];
  writeFileSync(SHOWN, out.join("\n") + "\n");
  console.log(`froze ${rows.size} decisions as production showed them, at ${sha}`);
})();
