// The swept corpus, read from disk. Replaces `SELECT payload FROM sweep_threads` for the
// offline scripts that used it. See scripts/export-sweep-corpus.mjs for why it moved.
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function corpusPath() { return join(ROOT, "data", "corpus", "sweep-threads.jsonl"); }

/**
 * Stream the corpus a thread at a time. 196 MB — do not read it whole without a reason.
 *
 * Splits on "\n" ONLY, and deliberately does not use readline. readline also treats a lone
 * "\r" as a line terminator, and real email bodies in this corpus contain raw carriage
 * returns; JSON.stringify escapes those, but readline was splitting the file inside a JSON
 * string anyway and every record after the first such body failed to parse. The writer emits
 * exactly one "\n" per record and no unescaped "\n" can occur inside one, so this is exact.
 */
export async function* readCorpus() {
  const p = corpusPath();
  if (!existsSync(p)) {
    // Loud rather than empty. A script that silently analysed nothing would report a clean
    // result over no data, which is worse than a crash.
    throw new Error(`no corpus at ${p} — run: npm run corpus:export`);
  }
  let buf = "";
  for await (const chunk of createReadStream(p, "utf8")) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

/** thread_id -> row, for the scripts that join the corpus against a set of ids. */
export async function corpusByThreadId() {
  const m = new Map();
  for await (const r of readCorpus()) m.set(r.thread_id, r);
  return m;
}
