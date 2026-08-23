// ============================================================================
// Give the already-dismissed tickets their reason back, deterministically.
// ----------------------------------------------------------------------------
// The engine now keeps the classifier's explanation when it rejects a thread, but
// that only helps rejections made from here on. 18 of the first 25 dismissed
// tickets carry gate_reason NULL, so the board's Dismissed lane would read
// "no reason recorded" for most of its rows.
//
// No model call is needed to fix them: n8n's own verdict is already stored
// verbatim in inbound_raw, and it ends with the job_summary line that says why.
// This lifts it from there.
//
// Reads inbound_raw, writes only tickets.gate_reason, and only where it is NULL.
//
//   node scripts/backfill-gate-reason.mjs            # report
//   node scripts/backfill-gate-reason.mjs --apply
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");

/** Pull job_summary out of n8n's plain-text verdict. */
function summaryOf(verdict) {
  const text =
    typeof verdict === "string" ? verdict
    : verdict && typeof verdict === "object"
      ? String(verdict.content ?? verdict.message?.content ?? verdict.text ?? verdict.output ?? "")
      : "";
  if (!text) return null;
  // To end of line: the summary is the last field, but never assume that.
  const m = /^\s*job_summary\s*:\s*([^\r\n]*)$/im.exec(text);
  if (!m) return null;
  // Strip the machine "N/A -" prefix, as the compiler now does.
  const why = m[1].replace(/^\s*N\/A\s*[-–—:]\s*/i, "").trim();
  return why || null;
}

// Latest stored payload per thread carries the most recent verdict.
// The gate reason lives in n8n's verdict, which is in the envelope on rows captured after
// the restructure and inside the payload on rows captured before it. Neither needs the
// message bodies, so this reads no mail at all.
const raw = await sql`SELECT thread_id, envelope, payload FROM inbound_raw ORDER BY id`;
const latest = new Map();
for (const r of raw) latest.set(r.thread_id, r.envelope ?? r.payload);

const blank = await sql`
  SELECT thread_id, classification, status FROM tickets
  WHERE gate_reason IS NULL
    AND (classification = 'not-a-job' OR status = 'ignored' OR is_client_inquiry = false)`;

console.log(`dismissed tickets with no reason: ${blank.length}\n`);
let found = 0;
const updates = [];
for (const t of blank) {
  const why = summaryOf(latest.get(t.thread_id)?.n8n?.verdict);
  if (why) { found++; updates.push({ thread_id: t.thread_id, why }); console.log(`  ${t.thread_id}  ${why.slice(0, 88)}`); }
  else console.log(`  ${t.thread_id}  (no verdict stored — leaving blank)`);
}
console.log(`\nrecoverable: ${found}/${blank.length}`);

if (!APPLY) { console.log("\n(report only — re-run with --apply)"); process.exit(0); }

for (const u of updates) {
  await sql`UPDATE tickets SET gate_reason = ${u.why} WHERE thread_id = ${u.thread_id} AND gate_reason IS NULL`;
}
const left = await sql`
  SELECT count(*)::int AS n FROM tickets
  WHERE gate_reason IS NULL
    AND (classification = 'not-a-job' OR status = 'ignored' OR is_client_inquiry = false)`;
console.log(`\napplied ${updates.length}. Dismissed tickets still without a reason: ${left[0].n}`);
