// ============================================================================
// HOW OFTEN DOES THE IDEMPOTENCY KEY DISAGREE WITH THE MESSAGE THE ENGINE ACTS ON?
// ----------------------------------------------------------------------------
// `handleThread` decides a thread is already done by comparing the stored
// `last_message_id` against `selectLatest(thread.messages)` — the RAW messages.
// `compile` writes `last_message_id` from `normalizeThread(thread)`, which selects
// from the CLEANED list: bodies stripped, messages under two characters dropped, and
// a client enquiry recovered out of a colleague's forward and APPENDED with a
// synthetic `<id>:quoted` id.
//
// pipeline.ts says the two are the same choice:
//
//   "selectLatest is the SAME choice the compiler acts on — if the two ever diverged,
//    the key would never match what was stored and the thread would re-run the model
//    on every sweep."
//
// They are not the same call on the same input. This measures the gap on the 638 real
// threads in data/testset/threads.jsonl, which is free and needs no model.
//
// A divergent thread never matches its own stored key, so every sweep re-reads it and
// pays for the model again — and the sweeps are deliberately aggressive precisely
// because the fast path was believed to make them cost nothing.
//
//   npx tsx audit/keydrift.mts
// ============================================================================
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectLatest, normalizeThread, cleanEmailBody, isMachineMessage } from "../app/lib/engine/normalize";
import type { HydratedThread, ThreadMessage } from "../app/lib/engine/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = readFileSync(join(ROOT, "data", "testset", "threads.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as { thread_id: string; messages: ThreadMessage[] });

let usable = 0;
let diverged = 0;
let threw = 0;
const why: Record<string, number> = {};
const examples: Record<string, string[]> = {};

for (const r of rows) {
  const thread: HydratedThread = { thread_id: r.thread_id, messages: r.messages ?? [] };
  if (!thread.messages.length) continue;
  usable++;

  // What handleThread computes, on the raw list.
  const rawKey = selectLatest(thread.messages)?.latest.message_id ?? "";

  // What compile stores, from the normalized list.
  let storedKey: string;
  try {
    storedKey = normalizeThread(thread).latest.message_id;
  } catch {
    // normalizeThread throws when nothing survives cleaning. handleThread would have
    // computed a key first and then had the compile throw under it.
    threw++;
    continue;
  }

  if (rawKey === storedKey) continue;
  diverged++;

  const cause = storedKey.endsWith(":quoted")
    ? "a client enquiry recovered out of a forward (synthetic :quoted id)"
    : thread.messages.some((m) => (m.body ?? "").trim().length > 0 && cleanEmailBody(m.body ?? "").trim().length < 2)
      ? "the newest message cleans away to nothing and is dropped"
      : thread.messages.some((m) => isMachineMessage(m))
        ? "machine mail is ordered differently once bodies are cleaned"
        : "the two selections differ for another reason";
  why[cause] = (why[cause] ?? 0) + 1;
  (examples[cause] ??= []).push(`${r.thread_id}: raw=${rawKey} stored=${storedKey}`);
}

const pct = (n: number) => `${((n / usable) * 100).toFixed(1)}%`;
console.log("=".repeat(78));
console.log("IDEMPOTENCY KEY vs THE MESSAGE COMPILE ACTS ON — 638 real threads");
console.log("=".repeat(78));
console.log(`threads with messages            ${usable}`);
console.log(`normalizeThread threw            ${threw}`);
console.log(`KEY DIVERGES                     ${diverged}  (${pct(diverged)})`);
console.log("");
for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
  for (const e of (examples[k] ?? []).slice(0, 2)) console.log(`        e.g. ${e}`);
}
console.log("");
console.log("Every diverged thread re-runs the model on EVERY delivery and every sweep,");
console.log("because prior.last_message_id can never equal the key handleThread computes.");
