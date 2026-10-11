// ============================================================================
// Record/replay for every paid call. A recording is keyed by what was asked (model, prompt
// id, the exact request text), so a rerun of the same case replays for free, and a changed
// prompt or model is a new key, never a stale answer.
// ----------------------------------------------------------------------------
// "replay" never spends: a missing recording is an error for that case, not a live call.
// "record" spends up to the cap and stops calling once the cap would be passed.
// ============================================================================
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type Mode = "record" | "replay";

export class SpendCapReached extends Error {}
export class NotRecorded extends Error {}

export class Recorder<T> {
  private store = new Map<string, T>();
  spent = 0;
  calls = 0;
  replayed = 0;

  constructor(private file: string, private mode: Mode, private capUsd: number) {
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as { key: string; value: T };
        this.store.set(r.key, r.value);
      }
    }
  }

  static key(parts: string[]): string {
    return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40);
  }

  get size() { return this.store.size; }

  async call(key: string, live: () => Promise<T>, costOf: (v: T) => number): Promise<T> {
    const hit = this.store.get(key);
    if (hit !== undefined) { this.replayed++; return hit; }
    if (this.mode === "replay") throw new NotRecorded(`no recording for ${key}`);
    if (this.spent >= this.capUsd) throw new SpendCapReached(`spend cap $${this.capUsd} reached`);
    const v = await live();
    this.calls++;
    this.spent += costOf(v);
    this.store.set(key, v);
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify({ key, value: v }) + "\n");
    return v;
  }
}
