// Grade the brain against the REAL corpus, read-only.
//
// Two independent decisions are made about every email: n8n's coarse is_job gate,
// and the engine's own four-way classification. This prints them as a confusion
// matrix and then lists every disagreement, because a disagreement is either a
// gate false-positive we paid a model call for, or a gate false-negative that
// would have been a missed booking if the gate were trusted.
//
// It also flags the two shapes that matter most for correctness:
//   - the engine treating a thread as a JOB whose newest client message is ours
//   - a staged order whose thread the gate called not-a-job
//
//   node scripts/grade-brain.mjs
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

/** n8n's verdict is plain text lines, not JSON: pull is_job/type_job properly. */
function parseVerdict(v) {
  const text =
    typeof v === "string" ? v
    : v && typeof v === "object" ? String(v.content ?? v.message?.content ?? v.text ?? v.output ?? "")
    : "";
  if (!text) return { is_job: null, type_job: null };
  // Match only to END OF LINE - reading past it swallows the job_summary that
  // follows whenever type_job is blank, which is exactly what it is when
  // is_job is false.
  const m1 = /^\s*is_job\s*:\s*(true|false)\s*$/im.exec(text);
  const m2 = /^\s*type_job\s*:\s*([^\r\n]*)$/im.exec(text);
  return {
    is_job: m1 ? m1[1] === "true" : null,
    type_job: m2 ? (m2[1].trim() || null) : null,
  };
}

const raw = await sql`SELECT thread_id, payload, received_at FROM inbound_raw ORDER BY id`;
const states = await sql`SELECT thread_id, state FROM conversation_state`;
const byThread = new Map(states.map((r) => [r.thread_id, r.state]));

// latest payload per thread
const latest = new Map();
for (const r of raw) latest.set(r.thread_id, r);

const SPARTAN = /@spartancrew\.co\.uk/i;
const matrix = new Map();
const rows = [];
for (const [tid, r] of latest) {
  const p = r.payload || {};
  const v = parseVerdict(p?.n8n?.verdict);
  const s = byThread.get(tid);
  const msgs = Array.isArray(p.messages) ? p.messages : [];
  const clientMsgs = msgs.filter((m) => !SPARTAN.test(String(m.from || "")));
  const gate = v.is_job === null ? "unparsed" : v.is_job ? `job/${v.type_job ?? "?"}` : "not-a-job";
  const eng = s?.classification ?? "(no state)";
  const key = `${gate} -> ${eng}`;
  matrix.set(key, (matrix.get(key) ?? 0) + 1);
  rows.push({
    tid, gate, eng,
    status: s?.status ?? "-",
    staged: !!s?.pending_order,
    msgs: msgs.length,
    clientMsgs: clientMsgs.length,
    verdictType: v.type_job,
  });
}

console.log(`threads: ${rows.length}\n`);
console.log("=== gate verdict -> engine classification ===");
for (const [k, n] of [...matrix].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);

const isJobEng = (c) => c === "new-job" || c === "update";
const disagree = rows.filter((r) => r.gate !== "unparsed" && ((r.gate === "not-a-job") !== !isJobEng(r.eng)));
console.log(`\n=== disagreements: ${disagree.length} ===`);
for (const r of disagree)
  console.log(`  ${r.tid}  gate=${r.gate.padEnd(12)} engine=${String(r.eng).padEnd(18)} status=${String(r.status).padEnd(11)} staged=${r.staged}`);

console.log(`\n=== threads with NO client message at all (nothing to act on) ===`);
const noClient = rows.filter((r) => r.clientMsgs === 0);
for (const r of noClient) console.log(`  ${r.tid}  msgs=${r.msgs}  engine=${r.eng}  status=${r.status}  staged=${r.staged}`);
if (!noClient.length) console.log("  none");

console.log(`\n=== staged orders whose gate said not-a-job ===`);
const bad = rows.filter((r) => r.staged && r.gate === "not-a-job");
for (const r of bad) console.log(`  ${r.tid}  engine=${r.eng}  status=${r.status}`);
if (!bad.length) console.log("  none");

const unparsed = rows.filter((r) => r.gate === "unparsed");
console.log(`\nverdicts that could not be parsed: ${unparsed.length}${unparsed.length ? " (" + unparsed.map((r) => r.tid).join(", ") + ")" : ""}`);
