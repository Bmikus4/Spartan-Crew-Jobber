// ============================================================================
// The n8n "Build Engine Payload" node, run outside n8n at every gate.
// ----------------------------------------------------------------------------
// scripts/test-engine-payload.mjs runs the node body against Gmail fixtures, but the suite
// only discovers test/*.ts, so until 22 Oct it ran only when someone remembered to. The node
// is what decides which fields the engine ever sees (the reply chain, Cc and attachment names
// for the job matcher), so a broken body must turn the gate red before it is installed.
//
// Offline.  npx tsx test/enginePayloadNode.ts
// ============================================================================
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(process.execPath, [join(root, "scripts", "test-engine-payload.mjs")], { stdio: "inherit" });
process.exit(r.status === 0 ? 0 : 1);
