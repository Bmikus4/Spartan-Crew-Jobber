// ============================================================================
// The real-mail harness's inputs, read only, and the three hashes every report carries.
// ----------------------------------------------------------------------------
// Nothing here opens a network connection or a database. The gold copy is the 2026-10-23
// production snapshot (.tmp-data/gold, gitignored); the labels are the blind reads converted
// by labels.ts. A report that cannot name the commit, the data and the labels it was scored
// on cannot be reproduced (OPERATING §8.6), so every report carries all three.
// ============================================================================
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/**
 * The production copy. HARNESS_GOLD names another copy (the prospective set's, taken 10-26): a copy the
 * harness has hashed is never overwritten, so each later read goes to its own directory.
 */
export const GOLD = join(ROOT, process.env.HARNESS_GOLD || ".tmp-data/gold");
export const GOLD_IS_DEFAULT = !process.env.HARNESS_GOLD || process.env.HARNESS_GOLD === ".tmp-data/gold";
export const READS = join(ROOT, "eval/reads");
export const LABELS = join(ROOT, "eval/harness/labels/live-week.jsonl");
export const SPLIT = join(ROOT, "eval/harness/labels/split.json");
export const LABELS_ALL = join(ROOT, "eval/harness/labels/all.jsonl");
export const SPLIT_ALL = join(ROOT, "eval/harness/labels/split-all.json");
/** Mail sent after the 10-22 copy was taken: no tuning step read it, so all of it is the locked test set (red-team-B H1). */
export const LABELS_PROSPECTIVE = join(ROOT, "eval/harness/labels/prospective.jsonl");
export const SPLIT_PROSPECTIVE = join(ROOT, "eval/harness/labels/split-prospective.json");

/** Every gold file a mode reads. The dataset hash covers all of them, in this order. */
export const GOLD_FILES = ["messages.json", "orders.json", "timeline.json", "decisions.json", "readings.json", "links.json", "companies.json", "places.json", "professions.json"] as const;
export type GoldFile = (typeof GOLD_FILES)[number];

const cache = new Map<string, unknown>();
export function readJson<T = any>(path: string): T {
  if (!cache.has(path)) cache.set(path, JSON.parse(readFileSync(path, "utf8")));
  return cache.get(path) as T;
}
export const gold = <T = any>(f: GoldFile): T => readJson<T>(join(GOLD, f));
export const goldPresent = () => GOLD_FILES.every((f) => existsSync(join(GOLD, f)));

export const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
/** A text file's hash is of its text: git checks these files out as CRLF on this box (red-team-B H14). */
export const textOf = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
export const fileHash = (p: string) => sha256(textOf(p)).slice(0, 16);

/** One hash over every gold file, so a re-copied snapshot is a different dataset. */
export function datasetHash(): string {
  return sha256(GOLD_FILES.map((f) => `${f}:${sha256(readFileSync(join(GOLD, f)))}`).join("\n")).slice(0, 16);
}
export const labelsHash = (path = LABELS) => fileHash(path);

/** HEAD, marked "+dirty" when the working tree differs from it: such a run is not reproducible from the sha alone. */
export function gitSha(): string {
  try {
    const head = execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return head.slice(0, 12) + (dirty ? "+dirty" : "");
  } catch {
    return "unknown";
  }
}

/** A CSV with quoted cells (the readers' notes carry commas). Cells are trimmed, as eval/reads/scripts/score.mts did. */
export function csvRows(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.trim());
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "", quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? "").trim()]));
  });
}

/** The sender's bare address, as process.ts reads it (process.ts:163). */
export const addr = (from: unknown) => String(from ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();

export type GoldMessage = {
  message_id: string; thread_id: string; from_address: string; to_addresses: string[] | null; date_iso: string;
  subject: string | null; body: string | null; is_from_spartan: boolean; first_seen_at: string;
};
export type GoldDecision = {
  message_id: string; thread_id: string; sent_at: string; kind: "none" | "handoff" | "write"; decision: any;
  executed: any[] | null; code_version: string | null; company_id: number | null; company: string | null; created_at: string;
};
