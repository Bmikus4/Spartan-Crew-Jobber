// Read-only: what real enquiry mail actually looks like when it reaches the
// engine. Prints the payload key shape, then one line per stored thread with
// n8n's verdict and the engine's stored decision, then full bodies for the
// N most recent threads. Run: node scripts/survey-inbound.mjs [N]
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";
import { payloadFor } from "./_thread.mjs";
loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const DEEP = Number(process.argv[2] || 4);

// No `payload` here. Selecting every payload at once returns more than the Neon HTTP
// driver will carry in one response (64 MB, HTTP 507). The envelope carries everything the
// shape survey and the tallies need; only the full-text section below wants the mail, and
// it fetches per thread.
const rows = await sql`SELECT id, thread_id, received_at, envelope FROM inbound_raw ORDER BY id ASC`;
console.log(`inbound_raw: ${rows.length} rows`);

const keyCount = new Map();
const walk = (o, p = "") => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return;
  for (const [k, v] of Object.entries(o)) {
    const path = p ? `${p}.${k}` : k;
    keyCount.set(path, (keyCount.get(path) || 0) + 1);
    if (v && typeof v === "object" && !Array.isArray(v) && path.split(".").length < 3) walk(v, path);
  }
};
// Shape reporting is about the WRAPPER n8n sends, not the mail. Walking a reconstructed
// payload would report thread_messages' own column names as if n8n had sent them, which is
// the opposite of what this survey is for. Every row carries an envelope — backfill-envelope
// gave one to the rows captured before the restructure — so both eras report the same shape.
for (const r of rows) walk(r.envelope ?? {});
console.log("\n=== payload key shape (count of rows carrying it) ===");
for (const [k, n] of [...keyCount].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

const byThread = new Map();
for (const r of rows) {
  if (!byThread.has(r.thread_id)) byThread.set(r.thread_id, []);
  byThread.get(r.thread_id).push(r);
}
const state = new Map();
for (const s of await sql`SELECT thread_id, state FROM conversation_state`) state.set(s.thread_id, s.state);

// n8n's classifier usually emits flat `key: value` lines, but when the model
// node is swapped the raw openAI message object comes through instead.
const verdictText = (v) => (typeof v === "string" ? v : v?.content || JSON.stringify(v || ""));
const field = (verdict, name) => {
  const m = verdictText(verdict).match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
  return m ? m[1].trim() : "";
};

console.log(`\n=== ${byThread.size} threads ===`);
for (const [tid, rs] of byThread) {
  const last = rs[rs.length - 1];
  const n8n = last.envelope?.n8n || {};
  const st = state.get(tid) || {};
  console.log(
    `\n${tid}  msgs=${rs.length}  ${new Date(last.received_at).toISOString().slice(0, 16)}` +
      `\n   from      ${field(n8n.verdict, "from") || "(none)"}` +
      `\n   n8n       is_job=${field(n8n.verdict, "is_job") || "?"} type=${field(n8n.verdict, "type_job") || "-"}` +
      `\n   summary   ${(field(n8n.verdict, "job_summary") || "").slice(0, 160)}` +
      `\n   engine    status=${st.status || "-"} kind=${st.classification?.kind || st.kind || "-"} ` +
      `order=${st.onsinch_order_id || "-"} flags=${(st.needs_human_reasons || st.reasons || []).slice(0, 3).join("|")}`,
  );
}

// --- aggregates: who actually triggers the engine, and what it decided ---
const tally = (label, pairs) => {
  const m = new Map();
  for (const k of pairs) m.set(k, (m.get(k) || 0) + 1);
  console.log(`\n=== ${label} ===`);
  for (const [k, n] of [...m].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
};
const senders = rows.map((r) => field(r.envelope?.n8n?.verdict, "from").toLowerCase() || "(none)");
tally("messages by sender", senders);
tally("messages by sender domain", senders.map((s) => s.split("@")[1] || "(none)"));
tally(
  "messages by n8n verdict",
  rows.map((r) => {
    const v = r.envelope?.n8n?.verdict;
    const own = field(v, "from").toLowerCase().endsWith("@spartancrew.co.uk");
    return `is_job=${field(v, "is_job") || "?"} ${own ? "(our own outbound)" : "(inbound)"}`;
  }),
);
tally("threads by engine status", [...byThread.keys()].map((t) => state.get(t)?.status || "(no state)"));

console.log(`\n\n=== full text of the ${DEEP} most recent threads ===`);
for (const [tid, rs] of [...byThread].slice(-DEEP)) {
  console.log(`\n${"=".repeat(78)}\nTHREAD ${tid}  (${rs.length} inbound rows)`);
  const seen = new Set();
  for (const r of rs) {
    // Full text DOES need the mail, so this one rebuilds. See scripts/_thread.mjs.
    const p = (await payloadFor(sql, r.thread_id, null, r.envelope)) || {};
    const n8n = p.n8n || {};
    const hist = n8n.history_text || p.history_text || [];
    const msgs = p.messages || [];
    console.log(`\n-- row ${r.id} ${new Date(r.received_at).toISOString().slice(0, 16)}`);
    console.log(`   verdict: ${verdictText(n8n.verdict).replace(/\n/g, " | ").slice(0, 300)}`);
    for (const m of msgs) {
      const key = m.id || m.message_id || JSON.stringify(m).slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`   MSG from=${m.from || "?"} subject=${m.subject || "?"} date=${m.date || "?"}`);
      console.log(String(m.body || m.text || "").trim().split("\n").map((l) => "      " + l).join("\n").slice(0, 2000));
    }
    for (const h of Array.isArray(hist) ? hist : [hist]) {
      const key = "h:" + String(h).slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log("   HIST " + String(h).trim().slice(0, 1500));
    }
  }
}
