// ============================================================================
// Every write the replay makes on a labelled set, judged against staff's acts (harness/real/writes.ts).
// ----------------------------------------------------------------------------
// $0 and offline: the replay's own preflight closes the network, and no model is called.
//   npx tsx harness/real/writes-run.ts [--set dev|dev-2]     (labels all.jsonl, split-all.json)
// Writes eval/harness/runs/writes-<set>.json and .md. Prospective mail is not judged here: it is spent
// only at a checkpoint.
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Op } from "../../app/lib/v2/bot/ops";
import { ROOT, datasetHash, gitSha, gold, type GoldMessage } from "./data";
import { labelPath, loadLabels } from "./labels";
import { b42 } from "./metrics";
import { loadSplit, splitPath } from "./split";
import { replay } from "./replay";
import { rate } from "./stats";
import { goldActs, judgeWrite, type WriteJudgement } from "./writes";
import { Index } from "./world";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

(async () => {
  const set = arg("set") ?? "dev";
  if (set !== "dev" && set !== "dev-2") throw new Error("--set dev | dev-2 (the prospective set is read only at a checkpoint)");
  const labels = loadLabels(labelPath("all")), split = loadSplit(splitPath("all"));
  const ids = set === "dev" ? split.dev : split.test;
  const days = new Map(labels.map((l) => [l.message_id, [...new Set([l.A?.days, l.B?.days].filter(Boolean).flatMap((s) => String(s).split(";")))]]));
  // Only a later email the readers read as booking work ends this email's window (writes.ts windowFor).
  const work = new Set(labels.filter(b42).map((l) => l.message_id));
  const r = await replay(ids);
  if (r.modelCalls || r.netAttempts) throw new Error(`the replay called out: ${r.modelCalls} model calls, ${r.netAttempts} network attempts`);
  const msgs = gold<GoldMessage[]>("messages.json");
  const byId = new Map(msgs.map((m) => [m.message_id, m]));
  const byThread = new Map<string, GoldMessage[]>();
  for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
  const ix = new Index(), acts = goldActs(ix);
  const dec = new Map(gold<any[]>("decisions.json").map((d) => [d.message_id, d]));
  const out: WriteJudgement[] = [];
  for (const id of ids) {
    const row = r.rows.get(id);
    if (row?.kind !== "write") continue;
    const ops: Op[] = (row.decision.ops ?? []).map((o: any) => o.op);
    const m = byId.get(id)!;
    // The bot's audit rows count only for an email whose production decision ran a write (writes.ts judgeWrite).
    const ran = (dec.get(id)?.executed ?? []).some((e: any) => e?.status === "verified");
    out.push(await judgeWrite(ix, acts.staff, { message_id: id, date_iso: String(m.date_iso), thread: byThread.get(m.thread_id) ?? [] }, ops, row.company_id ?? null, days.get(id) ?? [], (mid) => work.has(mid), ran ? acts.bot : []));
  }
  const by = (k: string) => out.filter((x) => x.verdict === k).length;
  const cls = (j: WriteJudgement) => [...new Set(j.ops)].sort().join("+");
  const classes = [...new Set(out.map(cls))].sort();
  const head = { set, git: gitSha(), dataset: datasetHash(), at: new Date().toISOString(), writes: out.length, completed: by("completed"), partial: by("partial"), wrong: by("wrong") };
  // A new place is keyed by its typed name, and a PO is the client's own reference: the files name neither.
  // Equality is judged on the real values above; only the printed keys are masked.
  const mask = (k: string) => k.replace(/@new:[^|]*?(?= \d+\|)/g, "@new-place").replace(/^po (\d+)=.*$/, "po $1=(value)");
  for (const j of out) { j.extra = j.extra.map(mask); j.lacking = j.lacking.map(mask); }
  const md = [`# Writes judged on ${set} (${out.length})`, "", `git ${head.git}, dataset ${head.dataset}. $0, offline.`, "",
    `- completed ${head.completed}, partial ${head.partial}, wrong ${head.wrong}${out.length ? `; completed ${rate(head.completed, out.length)}` : ""}`, "",
    "| class | writes | completed | partial | wrong |", "|---|---|---|---|---|",
    ...classes.map((c) => { const xs = out.filter((j) => cls(j) === c); return `| ${c} | ${xs.length} | ${xs.filter((x) => x.verdict === "completed").length} | ${xs.filter((x) => x.verdict === "partial").length} | ${xs.filter((x) => x.verdict === "wrong").length} |`; }),
    "", "| message_id | ops | verdict | extra | lacking | window cut by |", "|---|---|---|---|---|---|",
    ...out.map((j) => `| ${j.message_id} | ${j.ops.join(", ")} | ${j.verdict} | ${j.extra.join("; ")} | ${j.lacking.join("; ")} | ${j.window.cut_by ?? ""} |`)];
  const dir = join(ROOT, "eval/harness/runs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `writes-${set}.md`), md.join("\n") + "\n");
  writeFileSync(join(dir, `writes-${set}.json`), JSON.stringify({ ...head, rows: out }, null, 1) + "\n");
  console.log(md.slice(0, 6 + classes.length + 2).join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
