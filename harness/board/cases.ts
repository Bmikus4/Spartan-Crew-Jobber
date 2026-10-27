// ============================================================================
// The email-to-board case set (addendum Prompt 13): 20 emails of the current reader's labelled
// window, D-cur (eval/dev-windows.md), chosen by kind, the same 20 on every run.
// ----------------------------------------------------------------------------
// D-cur: the dev and dev-2 emails production decided from 10-16 07:00:44Z (the current reader),
// and prospective-1. Never E3 (mail from 10-29), never the 40 pause-window emails. Each kind is
// filled in hash order of its ids, so the set is fixed by the data, not by anyone's choosing:
//   new booking      a new booking, the thread's first client email            4
//   acceptance       a new booking answering our message (a quote taken up)    3
//   change           a change to a booking                                     4
//   cancel           a cancellation                                            2
//   reply for crew   a question or quote that names a day and a crew count     3
//   non-work         nothing asked, both readers                               4
//   npx tsx harness/board/cases.ts        (writes eval/board/cases.json: ids and kinds only)
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gold, sha256, ROOT, type GoldMessage, type GoldDecision } from "../real/data";
import { loadLabels, labelPath, has, type Label } from "../real/labels";

export const CURRENT_READER_FROM = Date.parse("2026-10-16T07:00:44Z");
const PAUSE = [Date.parse("2026-10-21T01:05:00Z"), Date.parse("2026-10-22T00:25:59Z")];
const E3_FROM = Date.parse("2026-10-29T00:00:00Z");
export const QUOTA: Array<[Kind, number]> = [["new booking", 4], ["acceptance", 3], ["change", 4], ["cancel", 2], ["reply for crew", 3], ["non-work", 4]];
export type Kind = "new booking" | "acceptance" | "change" | "cancel" | "reply for crew" | "non-work";
export type Case = { message_id: string; kind: Kind; set: "dev" | "dev-2" | "prospective-1" };

const both = (l: Label, k: string) => has(l.A, k) && has(l.B, k);
const T = (s: unknown) => Date.parse(String(s ?? "")) || 0;

export function kindOf(l: Label, prev: GoldMessage | undefined): Kind | null {
  if (l.consensus.nothing) return "non-work";
  if (both(l, "cancel")) return "cancel";
  if (both(l, "change")) return "change";
  if (l.consensus.new_booking) return prev?.is_from_spartan ? "acceptance" : "new booking";
  if (l.consensus.b42_shifts) return "reply for crew";
  return null;
}

export function chooseCases(): Case[] {
  const msgs = gold<GoldMessage[]>("messages.json");
  const byId = new Map(msgs.map((m) => [m.message_id, m]));
  const byThread = new Map<string, GoldMessage[]>();
  for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
  for (const l of byThread.values()) l.sort((a, b) => T(a.date_iso) - T(b.date_iso));
  const decided = new Map(gold<GoldDecision[]>("decisions.json").map((d) => [d.message_id, d]));
  const read = new Set(gold<any[]>("readings.json").map((r) => r.message_id));
  const split = JSON.parse(readFileSync(join(ROOT, "eval/harness/labels/split-all.json"), "utf8")) as { dev: string[]; test: string[] };
  const setOf = new Map<string, Case["set"]>([...split.dev.map((id) => [id, "dev"] as const), ...split.test.map((id) => [id, "dev-2"] as const)]);
  const pool: Array<{ l: Label; set: Case["set"] }> = [
    ...loadLabels(labelPath("all")).filter((l) => setOf.has(l.message_id)).map((l) => ({ l, set: setOf.get(l.message_id)! })),
    ...loadLabels(labelPath("prospective")).map((l) => ({ l, set: "prospective-1" as const })),
  ];
  const out: Case[] = [];
  const taken = new Set<string>();
  for (const [kind, n] of QUOTA) {
    const fit = pool.filter(({ l }) => {
      const m = byId.get(l.message_id), d = decided.get(l.message_id);
      if (!m || !d || !read.has(l.message_id) || taken.has(l.message_id) || l.excluded) return false;
      const at = T(m.date_iso);
      if (T(d.created_at) < CURRENT_READER_FROM || at >= E3_FROM || (at >= PAUSE[0] && at <= PAUSE[1])) return false;
      const thread = byThread.get(m.thread_id) ?? [];
      const prev = [...thread].reverse().find((x) => T(x.date_iso) < at);
      return kindOf(l, prev) === kind;
    }).sort((a, b) => sha256(a.l.message_id).localeCompare(sha256(b.l.message_id))).slice(0, n);
    for (const { l, set } of fit) { out.push({ message_id: l.message_id, kind, set }); taken.add(l.message_id); }
  }
  return out;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("harness/board/cases.ts")) {
  const cases = chooseCases();
  mkdirSync(join(ROOT, "eval/board"), { recursive: true });
  writeFileSync(join(ROOT, "eval/board/cases.json"), JSON.stringify(cases, null, 1) + "\n");
  const by = new Map<string, number>();
  for (const c of cases) by.set(c.kind, (by.get(c.kind) ?? 0) + 1);
  console.log(`${cases.length} cases: ${[...by].map(([k, n]) => `${k} ${n}`).join(", ")}`);
}
