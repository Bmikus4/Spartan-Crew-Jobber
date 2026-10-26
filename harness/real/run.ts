// ============================================================================
// The real-mail harness. $0: no model call, no network, no database, no write.
// ----------------------------------------------------------------------------
//   npx tsx harness/real/run.ts --mode score-production [--labels all|live-week] [--set dev|test|all] [--checkpoint] [--display current]
//   npx tsx harness/real/run.ts --mode replay           [--labels all|live-week] [--set dev|test|all] [--checkpoint]
//
// --labels all       (default) the 799 read emails, labels/all.jsonl, split labels/split-all.json
// --labels live-week the live week's 400, labels/live-week.jsonl, split labels/split.json: the
//                    set the baseline was measured on, kept exactly as it was
// score-production  production's stored decisions (decisions.json), scored against the labels.
//                   With --labels live-week --set all it first reproduces eval/live-week-reads.md
//                   figure by figure and exits 1 if any figure differs: that is the baseline proof.
// replay            the stored readings through the current planner on the time-correct world.
//
// THE TEST SET IS FOR CHECKPOINTS ONLY (OPERATING §8.8). --set test and --set all (which
// contains test) refuse to run without --checkpoint. Tuning reads dev, the default.
// Writes eval/harness/runs/<labels>-<mode>-<set>.json and .md: ids, codes and counts only, never text.
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, datasetHash, gitSha, goldPresent, labelsHash } from "./data";
import { labelPath, loadLabels, type LabelSet } from "./labels";
import { loadSplit, splitPath } from "./split";
import { productionRows } from "./system";
import { b42, markdown, score } from "./metrics";
import { extraHashes, reproduce, reproductionMarkdown } from "./reproduce";
import { replay, type EmailLimits } from "./replay";
import { closeNetwork, preflight } from "../core/preflight";

export const HARNESS_VERSION = "real-1";
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

/** Every limit of the time-correct world, as emails affected and total count. */
export function limitsMarkdown(limits: Map<string, EmailLimits>): string {
  const L = [...limits.values()], n = L.length;
  const row = (what: string, k: keyof EmailLimits, note: string) => {
    const v = L.map((x) => x[k]);
    const affected = v.filter((x) => (typeof x === "boolean" ? x : Number(x) > 0)).length;
    const total = v.reduce((a: number, x) => a + (typeof x === "boolean" ? (x ? 1 : 0) : Number(x)), 0);
    return `| ${what} | ${affected} of ${n} | ${total} | ${note} |`;
  };
  const range = (k: keyof EmailLimits) => { const v = L.map((x) => Number(x[k])); return `${Math.min(...v)}-${Math.max(...v)}`; };
  return [
    "| limit | emails affected | total | what it means |", "|---|---|---|---|",
    row("parts deleted after the email", "parts_deleted_after", "audit delete rows on an order the email's world read; the part existed then and its content is gone"),
    row("order cancelled after the email", "status_inferred", "status set back from -1 to 0; the audit row has no old status"),
    row("changed after the audit copy ends", "changed_after_audit_end", "a part modified after 22:51Z 10-22, which no audit row covers"),
    row("modified after the email, no audit row", "modified_without_audit_row", "an upper bound on unlogged changes: 8 audit actions were fetched, and a venue change is none of them"),
    row("bot orders rebuilt from the bot's own op", "absent_rebuilt", "orders the bot created, absent from the snapshot, rebuilt as the bot sent them; staff edits to them are lost"),
    row("client history may predate the snapshot", "history_may_be_cut", "the client has an order in the snapshot's first 30 days (it holds the newest 3,500 orders, from 2025-07-14)"),
    row("thread link with unknown state then", "links_state_unknown", "a job_links row seen before the email and now gone or held"),
    row("thread message stored after production decided", "thread_msgs_stored_after_decision", "sent before the email, so in replay's thread, but not stored when production read it"),
    row("reading picks an order the world does not offer", "reading_pick_not_offered", "the stored reading named an R number absent from the rebuilt context"),
    row("reading made over 1 h after the email", "reading_made_late", "the stored reading may have seen a later OnSinch"),
    row("client email with no stored reading", "no_stored_reading", "replay cannot read it: the failed read becomes a card for a person (process.ts:436-440)"),
    row("client differs from production's", "client_differs", "contacts are as of the snapshot: a contact added after the email would resolve a client production could not"),
    row("write names a place newer than any in use then", "write_place_after", "places carry no date; a place id above every one in use when the email arrived may postdate it"),
    "", `Orders absent from the snapshot that existed at an email's time and cannot be rebuilt (any client): staff-made ${range("absent_staff_orders_unrebuildable")} per email; made through the API with no delete row (the bot or test runs; when each vanished is unknown) ${range("absent_api_orders_unrebuildable")} per email.`,
    "Not rolled back at all (no timestamps in the copy): companies and their contacts (811), places (2,614), professions (45). Settings' create_lead_days is not in the copy: the planner's default applies.",
  ].join("\n");
}

async function main() {
  const mode = arg("mode"), set = arg("set") ?? "dev", checkpoint = process.argv.includes("--checkpoint");
  const labelSet = (arg("labels") ?? "all") as LabelSet;
  if (labelSet !== "all" && labelSet !== "live-week") throw new Error("--labels all | live-week");
  if (mode !== "score-production" && mode !== "replay") throw new Error("--mode score-production | replay");
  if (!["dev", "test", "all"].includes(set)) throw new Error("--set dev | test | all");
  if (set !== "dev" && !checkpoint) throw new Error(`--set ${set} contains the locked test set: it is read only at a checkpoint (add --checkpoint)`);
  if (!goldPresent()) throw new Error(".tmp-data/gold is missing: the harness scores the 2026-10-23 gold copy only");

  const labels = loadLabels(labelPath(labelSet)), split = loadSplit(splitPath(labelSet));
  const ids = new Set(set === "all" ? labels.map((l) => l.message_id) : set === "dev" ? split.dev : split.test);
  const chosen = labels.filter((l) => ids.has(l.message_id));
  const head = { mode: `${mode} (labels ${labelSet}, ${labels.length} emails)`, set, git: gitSha(), dataset: datasetHash(), labels: labelsHash(labelPath(labelSet)), split: split.test_hash, harness: HARNESS_VERSION };
  const out: string[] = [];
  const json: Record<string, unknown> = { ...head, at: new Date().toISOString(), n: chosen.length };
  let failed = false;

  if (mode === "score-production") {
    // Score-production reads only the gold copy, and it still refuses a production credential and closes the
    // network (audit/isolation-report.md G1, 10-25: only replay ran the preflight).
    const pf = preflight({ env: process.env, allowHosts: [], adapterChecks: [] });
    if (!pf.ok) throw new Error(`preflight failed: ${pf.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join("; ")}`);
    closeNetwork([]);
    // Frozen: what production's TV showed (shown.ts). Current: the same decisions through the TV code on disk.
    const display = arg("display") === "current" ? "current" : "frozen";
    json.display = display;
    if (display === "current") out.push(`**Display: current.** Production's stored decisions drawn through the TV code on disk (${gitSha()}), not as production showed them.`, "");
    const rows = productionRows(labels.map((l) => l.message_id), display);
    if (set === "all" && labelSet === "live-week" && display === "frozen") {
      const checks = reproduce(labels, rows);
      out.push(reproductionMarkdown(checks), "", `Reproduction inputs outside the gold copy: ${Object.entries(extraHashes()).map(([k, v]) => `${k} ${v}`).join(", ")}`, "");
      json.reproduction = checks;
      failed = checks.some((c) => !c.ok && !c.descriptive);
    }
    // Every row is passed: an email read with a later one is reached through that email's row.
    const s = score(chosen, rows, { latencyUnit: "min", cost: "not measurable: the gold copy stores no model cost (readings carry no meta)" });
    out.push(markdown(s, { ...head, extra: ["Latency is email sent -> decision recorded (decisions.json created_at - sent_at)."] }));
    json.metrics = s;
    json.rows = chosen.map((l) => { const r = rows.get(l.message_id)!; return { id: l.message_id, outcome: r.outcome, card: r.card, code: r.code, proposes_new: r.proposes_new }; });
  } else {
    const t0 = Date.now();
    const byId = new Map(labels.map((l) => [l.message_id, l]));
    const r = await replay(chosen.map((l) => l.message_id), (id) => [...(byId.get(id)?.A.days ?? "").split(";"), ...(byId.get(id)?.B.days ?? "").split(";")].filter(Boolean));
    const prod = productionRows(chosen.map((l) => l.message_id));
    const same = chosen.filter((l) => prod.get(l.message_id)!.outcome === r.rows.get(l.message_id)!.outcome).length;
    const s = score(chosen, r.rows, { latencyUnit: "ms", cost: `$0: ${r.modelCalls} model calls; every reading is the stored one` });
    out.push(markdown(s, { ...head, extra: [
      `Runs ${r.runs} (${r.warmups} earlier thread emails replayed unscored first, for the thread's prior requests) in ${((Date.now() - t0) / 1000).toFixed(1)} s. Network requests attempted: ${r.netAttempts}. Model calls: ${r.modelCalls}.`,
      `Preflight: ${r.preflight.join("; ")}.`,
      `Same TV outcome as production on ${same} of ${chosen.length}. Latency is in-process time per email.`,
    ] }));
    // Where replay and production part on a B42 inquiry, and what of the world was incomplete there.
    const silentOf = (o: string) => o === "none" || o === "needs-reply";
    const LIM: (keyof EmailLimits)[] = ["parts_deleted_after", "status_inferred", "changed_after_audit_end", "modified_without_audit_row", "absent_rebuilt", "links_state_unknown", "reading_pick_not_offered", "reading_made_late"];
    const moved = chosen.filter(b42).filter((l) => silentOf(prod.get(l.message_id)!.outcome) !== silentOf(r.rows.get(l.message_id)!.outcome));
    out.push("", "**B42 inquiries whose silent status differs from production**", "",
      "| message_id | production | replay | world limits on this email |", "|---|---|---|---|",
      ...moved.map((l) => { const a = prod.get(l.message_id)!, b = r.rows.get(l.message_id)!, lim = (r.limits.get(l.message_id) ?? {}) as Partial<EmailLimits>;
        return `| ${l.message_id} | ${a.outcome} / ${a.code} | ${b.outcome} / ${b.code}${r.booked.has(l.message_id) ? (r.booked.get(l.message_id) ? " (the R named has a live shift on an asked day then)" : " (no R named has a live shift on an asked day then)") : ""} | ${LIM.filter((k) => lim[k]).map((k) => `${k} ${lim[k]}`).join(", ") || "none"} |`; }));
    const silentBooked = s.headline.silent_ids.filter((id) => r.booked.get(id));
    out.push("", `Of the ${s.silent_miss_count} silent misses, ${silentBooked.length} are "already booked" answers that the time-correct world bears out (${silentBooked.join(", ") || "none"}): the labels count them as misses because the "already done" exclusions were frozen from production's own claims. They stay in the score; a reader must settle them.`);
    const uncoded = [...r.rows.values()].filter((x) => x.code === "other" && /^nothing new asked for/.test(String(x.decision.reason ?? ""))).length;
    if (uncoded) out.push("", `HEAD gives ${uncoded} decisions a reason reasons.ts does not code ("nothing new asked for: the requests are the thread's earlier ones"), so they are tallied as "other".`);
    out.push("", "**Limits of the time-correct world on this set**", "", limitsMarkdown(r.limits));
    json.metrics = s;
    json.limits = Object.fromEntries(r.limits);
    json.rows = chosen.map((l) => { const x = r.rows.get(l.message_id)!; return { id: l.message_id, outcome: x.outcome, card: x.card, code: x.code, proposes_new: x.proposes_new, production: prod.get(l.message_id)!.outcome }; });
    failed = r.modelCalls > 0 || r.netAttempts > 0;
  }

  const dir = join(ROOT, "eval/harness/runs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${labelSet}-${mode}${json.display === "current" ? "-display-current" : ""}-${set}.md`), out.join("\n") + "\n");
  writeFileSync(join(dir, `${labelSet}-${mode}${json.display === "current" ? "-display-current" : ""}-${set}.json`), JSON.stringify(json, null, 1) + "\n");
  console.log(out.join("\n"));
  if (failed) { console.error(mode === "replay" ? "REPLAY ISOLATION BROKEN" : "BASELINE NOT REPRODUCED"); process.exit(1); }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
