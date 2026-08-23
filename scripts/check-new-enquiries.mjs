// Read-only: what the engine made of every enquiry that arrived after a given
// inbound_raw id. Nothing is written, to Neon or to OnSinch.
//
//   node scripts/check-new-enquiries.mjs 825
//   node scripts/check-new-enquiries.mjs 825 --full   (also print the email bodies)
//
// Written for watching test enquiries land: it joins the three places one email
// touches — the raw n8n payload, the engine's own state row, and the ticket the
// board shows — so a disagreement between them is visible rather than needing
// three separate lookups to notice.
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";
import { payloadFor } from "./_thread.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

const since = Number(process.argv[2] || 0);
const full = process.argv.includes("--full");
if (!Number.isInteger(since)) {
  console.error("usage: node scripts/check-new-enquiries.mjs <since_inbound_id> [--full]");
  process.exit(2);
}

const rows = await sql`
  SELECT id, thread_id, received_at, payload, envelope
  FROM inbound_raw WHERE id > ${since} ORDER BY id`;

if (!rows.length) {
  const [{ mx }] = await sql`SELECT COALESCE(MAX(id),0)::int AS mx FROM inbound_raw`;
  console.log(`nothing new since ${since} (highest id is ${mx})`);
  process.exit(0);
}

console.log(`${rows.length} new inbound row(s) since ${since}\n`);

for (const r of rows) {
  // payload is null on rows captured after the restructure; the messages come from
  // thread_messages and the n8n verdict from the envelope. See scripts/_thread.mjs.
  const p = (await payloadFor(sql, r.thread_id, r.payload, r.envelope)) || {};
  const n8n = p.n8n || {};
  const msgs = p.messages || [];
  const latest = msgs[msgs.length - 1] || {};
  console.log("=".repeat(78));
  console.log(`inbound ${r.id}  thread ${r.thread_id}  ${new Date(r.received_at).toISOString()}`);
  console.log(`  from     ${latest.from || n8n.client_information?.email || "?"}`);
  console.log(`  subject  ${latest.subject || "(none)"}`);
  console.log(`  n8n      msgs=${n8n.message_count ?? msgs.length} verdict=${JSON.stringify(n8n.verdict)} label=${n8n.classifications?.[0]?.label ?? "?"}`);
  if (full) {
    console.log("  ---- body ----");
    console.log(String(latest.body || latest.text || "").trim().split("\n").map((l) => "  | " + l).join("\n").slice(0, 3000));
  }

  const [st] = await sql`SELECT * FROM conversation_state WHERE thread_id=${r.thread_id}`;
  if (!st) {
    console.log("\n  ENGINE: no conversation_state row — the engine never processed this thread");
  } else {
    const d = st.desired_order || null;
    const teams = d?.slot_teams || [];
    const crew = teams.reduce((n, t) => n + (t.size || 0), 0);
    console.log(`\n  ENGINE  classification=${st.classification} status=${st.status} needs_human=${st.needs_human}`);
    console.log(`          company=${st.company_id ?? "-"} contact=${st.user_id ?? "-"} place=${st.place_id ?? "-"}`);
    console.log(`          onsinch order=${st.onsinch_order_id ?? "-"} R${st.onsinch_order_number ?? "-"} J${st.onsinch_job_id ?? "-"}`);
    if (d) {
      console.log(`          card=${d.pricelist_category_id} (${d.rate_card_source ?? "?"})  provisional=${d.provisional} quote=${d.quote}`);
      console.log(`          ${teams.length} team(s), ${crew} crew:`);
      for (const t of teams) {
        console.log(`            p${t.profession_id} x${t.size}  ${t.beginning || "TBC"} -> ${t.end || "TBC"}  place=${t.place_id}  "${String(t.name).slice(0, 52)}"`);
      }
      if (d.provision_company) console.log(`          WILL CREATE COMPANY: ${d.provision_company.name}`);
      if (d.provision_place) console.log(`          WILL CREATE VENUE: ${d.provision_place.name}`);
    } else {
      console.log("          no order composed");
    }
    if (st.pending_order) console.log(`          HELD: a ${st.pending_order.kind} is staged, not written`);
    for (const n of st.notes || []) console.log(`          note: ${n}`);
    for (const a of st.order_action_log || []) console.log(`          action: ${a.kind} order=${a.order_id ?? "-"} ok=${a.ok}${a.error ? " err=" + a.error : ""}`);
  }

  const [tk] = await sql`SELECT status, classification, onsinch_order_id, onsinch_job_id, reply_draft_id
                         FROM tickets WHERE thread_id=${r.thread_id}`;
  console.log(`\n  BOARD   ${tk ? `status=${tk.status} class=${tk.classification} order=${tk.onsinch_order_id ?? "-"} J${tk.onsinch_job_id ?? "-"} draft=${tk.reply_draft_id ?? "-"}` : "no ticket row"}`);
  console.log();
}

const [{ mx }] = await sql`SELECT MAX(id)::int AS mx FROM inbound_raw`;
console.log(`highest inbound id is now ${mx} — pass that as <since> next time`);
