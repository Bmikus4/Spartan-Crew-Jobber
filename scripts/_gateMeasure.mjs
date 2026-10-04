// Hands a number to the next session gate: merges one named measurement into
// .tmp-data/gate-measurements.json, which scripts/session.py folds into its ticket and deletes.
// Merge, not overwrite, so two instruments run before one gate both reach the same ticket.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp-data", "gate-measurements.json");

/** value must carry its own dataset and instrument; a bare rate cannot be compared later. */
export function recordMeasurement(key, value) {
  if (!value || !value.dataset || !value.instrument) throw new Error(`measurement ${key} needs dataset and instrument`);
  const blob = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
  blob.measured = { ...(blob.measured ?? {}), [key]: value };
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(blob, null, 1) + "\n");
  return FILE;
}
