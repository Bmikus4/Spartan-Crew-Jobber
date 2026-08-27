// ============================================================================
// Point every Gmail node at a reconnected credential.
// ----------------------------------------------------------------------------
// An OAuth credential that expires takes the whole intake down: on 2026-08-26 the
// live bookings workflow failed 71 times in a row, every five minutes from 08:00,
// on "The credential ... needs to be reconnected". Nothing was read for six hours.
// Reconnecting in the n8n UI mints a NEW credential with a new id, and every node
// still points at the dead one.
//
// EDITING LIVE n8n JSON IS THE RECURRING PRODUCTION FAILURE IN THIS ACCOUNT, so:
//
//   - it snapshots every workflow it will touch to n8n/backups/ FIRST, and refuses
//     to proceed if the snapshot cannot be written;
//   - it is a DRY RUN unless --apply is passed;
//   - it changes one field, `node.credentials.gmailOAuth2`, and nothing else. The
//     nodes, connections and settings are sent back exactly as they came;
//   - it deactivates before PUT and reactivates after, because updating an active
//     workflow leaves the old webhook registration behind;
//   - it reads every workflow back afterwards and reports what actually points
//     where, rather than trusting the PUT response.
//
// Workflows that have an INSTALLER (the reply-draft and manual-tag ones) are better
// updated by editing the installer's own credential constant and re-running it —
// that is idempotent and leaves the source of truth in git. This exists for the live
// bookings workflow, which has no installer.
//
// --from IS MANDATORY, and the first dry run is why. Selecting every node with a
// gmailOAuth2 credential matched 17 workflows across FOUR different Gmail accounts —
// "Send Support Tickets" sends from "Test Email", "SamurAI Update" from "Gmail account
// 8", the retired bookings workflows from an older "SpartanCrew Bookings Gmail". A
// blanket swap would have repointed all of them at the bookings mailbox, which is a
// worse outage than the one being fixed and a much quieter one.
//
//   node scripts/swap-gmail-credential.mjs --from <deadId> --to <newId>
//   node scripts/swap-gmail-credential.mjs --from <deadId> --to <newId> --apply
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const BASE = requireEnv("N8N_BASE").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const h = { "X-N8N-API-KEY": requireEnv("N8N_API_KEY"), "content-type": "application/json" };

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const TO = argv.includes("--to") ? String(argv[argv.indexOf("--to") + 1] || "") : "";
const FROM = argv.includes("--from") ? String(argv[argv.indexOf("--from") + 1] || "") : "";
if (!TO || !FROM) {
  console.error("need --from <deadCredentialId> --to <newCredentialId>.");
  console.error("--from is mandatory: this account has four different Gmail credentials and");
  console.error("a blanket swap would repoint unrelated workflows at the bookings mailbox.");
  process.exit(1);
}

async function api(path, init = {}) {
  const r = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`n8n ${init.method || "GET"} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const creds = await api("/credentials?limit=100");
const target = (creds.data ?? []).find((c) => c.id === TO);
if (!target) {
  console.error(`credential ${TO} not found. Available gmailOAuth2:`);
  for (const c of (creds.data ?? []).filter((c) => c.type === "gmailOAuth2")) console.error(`  ${c.id}  ${c.name}`);
  process.exit(1);
}
console.log(`target credential: ${target.id} "${target.name}" (${target.type})\n`);

const list = await api("/workflows?limit=250");
const affected = [];
for (const row of list.data ?? []) {
  const wf = await api(`/workflows/${row.id}`);
  const nodes = (wf.nodes ?? []).filter((n) => n.credentials?.gmailOAuth2);
  // ONLY the credential named by --from. Never "everything that is not the target".
  const stale = nodes.filter((n) => n.credentials.gmailOAuth2.id === FROM);
  if (stale.length) affected.push({ wf, stale, total: nodes.length });
}

if (!affected.length) {
  console.log(`no node uses credential ${FROM}. Nothing to do.`);
  process.exit(0);
}

// Snapshot BEFORE anything is written. n8n/backups is gitignored.
const dir = join(ROOT_DIR, "n8n", "backups");
mkdirSync(dir, { recursive: true });
const stamp = target.updatedAt.replace(/[:.]/g, "-");
for (const a of affected) {
  const file = join(dir, `${a.wf.id}-before-cred-swap-${stamp}.json`);
  writeFileSync(file, JSON.stringify(a.wf, null, 2));
  console.log(`snapshot ${file}`);
}
console.log("");

for (const a of affected) {
  console.log(`${a.wf.active ? "ACTIVE" : "off   "} ${a.wf.id}  ${a.wf.name}`);
  for (const n of a.stale) {
    console.log(`    ${n.name}: ${n.credentials.gmailOAuth2.id} "${n.credentials.gmailOAuth2.name}" -> ${TO}`);
  }
}

if (!APPLY) {
  console.log(`\nDRY RUN. ${affected.length} workflow(s) would change. Re-run with --apply.`);
  process.exit(0);
}

console.log("");
for (const a of affected) {
  const nodes = a.wf.nodes.map((n) =>
    n.credentials?.gmailOAuth2?.id === FROM
      ? { ...n, credentials: { ...n.credentials, gmailOAuth2: { id: target.id, name: target.name } } }
      : n
  );
  const body = { name: a.wf.name, nodes, connections: a.wf.connections, settings: a.wf.settings ?? {} };
  const wasActive = a.wf.active;
  if (wasActive) await api(`/workflows/${a.wf.id}/deactivate`, { method: "POST" });
  await api(`/workflows/${a.wf.id}`, { method: "PUT", body: JSON.stringify(body) });
  if (wasActive) await api(`/workflows/${a.wf.id}/activate`, { method: "POST" });
  console.log(`updated ${a.wf.id} ${a.wf.name}${wasActive ? " (reactivated)" : ""}`);
}

// Read back, rather than trusting the PUT.
console.log("\n=== read back ===");
for (const a of affected) {
  const wf = await api(`/workflows/${a.wf.id}`);
  const ids = [...new Set((wf.nodes ?? []).filter((n) => n.credentials?.gmailOAuth2).map((n) => n.credentials.gmailOAuth2.id))];
  // The dead one must be gone. Other credentials in the same workflow are left alone
  // deliberately, so "OK" means "no longer pointing at the dead credential".
  const good = !ids.includes(FROM);
  console.log(`${good ? "OK  " : "FAIL"} ${wf.id} ${wf.name} — active ${wf.active}, credential(s) ${JSON.stringify(ids)}`);
}
