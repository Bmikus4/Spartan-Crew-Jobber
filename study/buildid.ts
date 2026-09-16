// ============================================================================
// WHICH BUILD AN ANSWER CAME FROM.
// ----------------------------------------------------------------------------
// The engine leg resumes by thread id so a run that dies halfway does not have to be
// re-bought. Keyed on the id alone it also "resumes" across a CODE CHANGE: run the
// harness, edit the engine, run it again with a new label, and all 100 answers are read
// back from the previous build's file. The second run costs nothing, makes no model call,
// and reports the first run's number — so every before/after says the change did nothing,
// whatever the change was. That happened on 2026-09-17: --label=after wrote a file
// byte-identical to --label=before for a build that had changed underneath it.
//
// Fingerprinting the engine source separates the two. Same build: resume, which is what
// the resume is for. Different build: re-run, which costs money and is the point of
// asking. The git head is not enough — a working tree with uncommitted changes is exactly
// when a before/after is being run.
//
// It lives in its own file so the harness and the study can both read it without either
// importing the other's command-line entry point.
// ============================================================================
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

export function engineBuildId(root = ROOT): string {
  const files: string[] = [];
  const walk = (p: string) => {
    for (const e of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(join(root, "app", "lib", "engine"));
  const h = createHash("sha256");
  // The PATH goes into the hash as well as the bytes, so moving a rule between files is
  // a different build even when nothing about the text of it changed.
  for (const f of files) h.update(f.slice(root.length)).update(readFileSync(f));
  return h.digest("hex").slice(0, 12);
}
