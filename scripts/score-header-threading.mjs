// ============================================================================
// Does header threading reproduce Gmail's grouping? Scored against Gmail itself.
// ----------------------------------------------------------------------------
// The routing-rule intake takes OAuth out of the intake path, which is the point of
// it, but it delivers MESSAGES and Gmail's `threadId` never arrives. Everything
// downstream keys on a thread, so the design rests on whether `Message-ID`,
// `In-Reply-To` and `References` group mail the way Gmail does.
//
// Gmail will answer that itself: scripts/probe-threading.mjs asks for both its own
// grouping AND the headers, for the same mail. This clusters from the headers alone
// and counts the disagreements. Two kinds, and they are not equally bad:
//
//   SPLIT   one Gmail thread lands in several clusters. The engine would open a
//           second conversation for a job it already has — it loses continuity, and
//           the identity rule then has to catch it downstream.
//   MERGE   one cluster spans several Gmail threads. TWO DIFFERENT JOBS BECOME ONE.
//           This is the expensive direction: a crew change for one booking applied
//           to another, which is the exact failure the identity rule exists to stop.
//
// Two populations are scored, because they are not the same question:
//   whole thread   every message Gmail holds, including Spartan's own replies.
//   inbound only   what a routing rule on an INBOUND envelope recipient actually
//                  delivers. Spartan's outbound replies would not be routed, and a
//                  reply chain missing its middle is the hard case.
//
//   node scripts/score-header-threading.mjs
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./_env.mjs";

const path = join(ROOT_DIR, ".tmp-data", "threading-probe.json");
if (!existsSync(path)) throw new Error(`no probe data at ${path} — run: node scripts/probe-threading.mjs`);
const rows = JSON.parse(readFileSync(path, "utf8"));

const SPARTAN = /@spartancrew\.co\.uk/i;
/** Message-IDs as they appear in headers: <id>, possibly several, possibly folded. */
const idsIn = (s) => String(s || "").match(/<[^>\s]+>/g) ?? [];
const norm = (s) => String(s || "").trim().toLowerCase();

function cluster(msgs) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); return x; };
  const union = (a, b) => { const ra = find(add(a)), rb = find(add(b)); if (ra !== rb) parent.set(ra, rb); };

  // Every message is a node keyed by its own Message-ID. A message with none gets a
  // synthetic key so it forms its own cluster rather than silently joining another.
  const keyOf = new Map();
  for (const m of msgs) {
    const k = norm(m.rfc_message_id) || `__no-id__${m.gmail_message_id}`;
    keyOf.set(m, k);
    add(k);
  }
  const known = new Set(keyOf.values());
  for (const m of msgs) {
    const me = keyOf.get(m);
    // Only join to references we actually HOLD. Joining on an unseen id would build a
    // cluster around a message nobody has, and two replies to the same absent parent
    // would fuse — which is a merge, the expensive direction.
    for (const ref of [...idsIn(m.in_reply_to), ...idsIn(m.references)]) {
      const r = norm(ref);
      if (known.has(r)) union(me, r);
    }
  }
  const out = new Map();
  for (const m of msgs) {
    const root = find(keyOf.get(m));
    if (!out.has(root)) out.set(root, []);
    out.get(root).push(m);
  }
  return [...out.values()];
}

function score(msgs, label) {
  const byGmail = new Map();
  for (const m of msgs) {
    if (!byGmail.has(m.gmail_thread_id)) byGmail.set(m.gmail_thread_id, []);
    byGmail.get(m.gmail_thread_id).push(m);
  }
  const clusters = cluster(msgs);

  // SPLIT: a Gmail thread whose messages land in more than one cluster.
  const clusterOf = new Map();
  clusters.forEach((c, i) => c.forEach((m) => clusterOf.set(m, i)));
  let split = 0; const splitEx = [];
  for (const [tid, ms] of byGmail) {
    const n = new Set(ms.map((m) => clusterOf.get(m))).size;
    if (n > 1) { split++; splitEx.push(`${tid} -> ${n} clusters  "${String(ms[0].subject).slice(0, 50)}"`); }
  }
  // MERGE: a cluster spanning more than one Gmail thread.
  let merge = 0; const mergeEx = [];
  for (const c of clusters) {
    const tids = new Set(c.map((m) => m.gmail_thread_id));
    if (tids.size > 1) { merge++; mergeEx.push(`${[...tids].join(" + ")}  "${String(c[0].subject).slice(0, 50)}"`); }
  }

  console.log(`\n${label}`);
  console.log(`   ${msgs.length} message(s), ${byGmail.size} Gmail thread(s) -> ${clusters.length} cluster(s)`);
  console.log(`   SPLIT  ${split}/${byGmail.size} Gmail thread(s) broken apart   ${((100 * split) / byGmail.size).toFixed(1)}%`);
  console.log(`   MERGE  ${merge} cluster(s) spanning more than one thread`);
  for (const e of splitEx.slice(0, 8)) console.log(`      split:  ${e}`);
  if (splitEx.length > 8) console.log(`      … and ${splitEx.length - 8} more`);
  for (const e of mergeEx.slice(0, 8)) console.log(`      MERGE:  ${e}`);
  return { split, merge, threads: byGmail.size };
}

// A positive control. Clustering on the Gmail thread id itself must be perfect; if it
// is not, the scorer is broken and nothing below it means anything.
const control = (() => {
  const byGmail = new Map();
  for (const m of rows) { if (!byGmail.has(m.gmail_thread_id)) byGmail.set(m.gmail_thread_id, []); byGmail.get(m.gmail_thread_id).push(m); }
  return byGmail.size;
})();
console.log(`control: clustering on Gmail's own id gives ${control} thread(s) for ${rows.length} message(s)`);

score(rows, "WHOLE THREAD — every message Gmail holds");
const inbound = rows.filter((m) => !SPARTAN.test(m.from));
score(inbound, "INBOUND ONLY — what a routing rule on an inbound recipient delivers");

console.log(`\nA split costs continuity and the identity rule can still recover it.`);
console.log(`A MERGE puts two jobs on one conversation and must be zero.\n`);
