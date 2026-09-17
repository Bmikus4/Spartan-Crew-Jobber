// ============================================================================
// IS THE WHOLE SYSTEM HEALTHY? One command, six subsystems, no guessing.
// ----------------------------------------------------------------------------
// Every check here answers a question that has burned a session at least once:
//
//   "the workflow is ACTIVE"          means nothing. `Spartan Intake Watchdog` reported
//                                     success every 15 minutes for six days on a dead
//                                     credential, because its Gmail node only fires when
//                                     there is an alarm to send. So workflows are judged
//                                     on their last EXECUTION, not on a flag.
//   "the API returned 200"            means nothing. n8n accepted two credential-change
//                                     PUTs with 200 and applied neither; OnSinch answers
//                                     an unsupported filter with an empty list. So every
//                                     count that could be zero gets a POSITIVE CONTROL
//                                     that proves the question was even asked.
//   "no rows came back"               is not evidence of absence. Where a control fails,
//                                     this prints UNKNOWN rather than a verdict.
//
// Read-only. Touches nothing, writes nothing, spends no model call.
//   npx tsx scripts/health.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();

type Verdict = "OK" | "WARN" | "DOWN" | "UNKNOWN";
const rows: Array<{ area: string; verdict: Verdict; detail: string }> = [];
const say = (area: string, verdict: Verdict, detail: string) => rows.push({ area, verdict, detail });

const N8N = (process.env.N8N_BASE || "").replace(/\/$/, "").replace(/\/api\/v1$/, "");
const nh = { "X-N8N-API-KEY": process.env.N8N_API_KEY || "" };
const ONS = (process.env.ONSINCH_BASE_URL || "").replace(/\/$/, "");
const oh = { Authorization: `apikey ${(process.env.ONSINCH_API_KEY || "").trim()}`, Accept: "application/json" };

const mins = (iso: unknown) => Math.round((Date.now() - Date.parse(String(iso))) / 60000);
const ago = (iso: unknown) => {
  const m = mins(iso);
  return Number.isFinite(m) ? (m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`) : "never";
};

// The OAuth grant behind "Spartan Crew 8/27/26". Revoked around 2026-09-09; it took intake
// down for three days (2026-09-10: 288 failed runs, zero successes, zero mail ingested) and
// left thread tagging silently dead for five. n8n reports a revoked grant per EXECUTION, never
// on the credential or the workflow, so a workflow that has not been triggered since the
// revocation looks perfectly healthy. Scanning for the id is the only way to see it coming.
const REVOKED_CRED = { id: "hGFZ7vGl625ZeExK", name: "Spartan Crew 8/27/26" };

/** The workflows this engine depends on, and what each one failing actually costs. */
const WATCH: Array<{ match: RegExp; label: string; cost: string; staleMins: number }> = [
  { match: /Email SamurAI v3\.4 Spartan Crew Bookings/i, label: "intake (enquiries in)", cost: "no enquiries reach the engine", staleMins: 20 },
  { match: /^Spartan Engine — Manual Tag$/i, label: "gmail labels", cost: "threads are not labelled", staleMins: 0 },
  { match: /^Spartan Engine — Reply Draft$/i, label: "client reply drafts", cost: "deliberately off — not a fault", staleMins: 0 },
  { match: /^Spartan Intake Watchdog$/i, label: "intake watchdog", cost: "a silent intake outage goes unreported", staleMins: 40 },
  // Daily, so 26 hours of grace. Until this exists and is active, nothing re-reads a
  // booking after the conversation goes quiet: an order staff deleted leaves the thread
  // pointing at nothing, and a shape OnSinch silently did not take is never noticed.
  { match: /^Spartan Reconciliation Sweep$/i, label: "reconciliation sweep", cost: "deleted orders are never re-bound and silent write failures are never caught", staleMins: 26 * 60 },
];

(async () => {
  // ---- 1. n8n ------------------------------------------------------------------
  let wfs: any[] = [];
  try {
    const r = await fetch(`${N8N}/api/v1/workflows?limit=250`, { headers: nh });
    wfs = (await r.json())?.data ?? [];
    // The control: this instance is known to hold many workflows. An empty list means
    // the API is not answering, not that the workflows are gone.
    if (!wfs.length) say("n8n API", "UNKNOWN", `HTTP ${r.status} but ZERO workflows — control failed, everything below it is meaningless`);
    else say("n8n API", "OK", `${wfs.length} workflows readable`);
  } catch (err: any) {
    say("n8n API", "DOWN", String(err?.message ?? err));
  }

  for (const w of WATCH) {
    const hit = wfs.find((x) => w.match.test(x.name));
    if (!hit) { say(w.label, wfs.length ? "DOWN" : "UNKNOWN", `workflow not found — ${w.cost}`); continue; }
    const full = await (await fetch(`${N8N}/api/v1/workflows/${hit.id}`, { headers: nh })).json();
    const ex = (await (await fetch(`${N8N}/api/v1/executions?workflowId=${hit.id}&limit=5`, { headers: nh })).json())?.data ?? [];
    const proj = full.shared?.[0]?.project?.name ?? "?";
    const last = ex[0];
    const errs = ex.filter((e: any) => e.status === "error").length;

    // A flag is not health. The last execution is.
    let verdict: Verdict = "OK";
    let why = `${full.active ? "active" : "INACTIVE"}, ${proj}, last ${last ? `${last.status} ${ago(last.startedAt)}` : "never run"}`;
    if (!full.active) verdict = "DOWN";
    else if (!last) verdict = "UNKNOWN";
    else if (last.status === "error") { verdict = "DOWN"; why += `, ${errs}/${ex.length} recent failed — ${w.cost}`; }
    else if (w.staleMins && mins(last.startedAt) > w.staleMins) { verdict = "WARN"; why += `, expected every ~${w.staleMins}m`; }
    if (verdict === "DOWN" && /deliberately off/.test(w.cost)) { verdict = "WARN"; why += " (expected)"; }
    say(w.label, verdict, why);
  }

  // ---- 2. Is the revoked grant still wired to anything? -------------------------
  try {
    const stuck: string[] = [];
    let armed = 0; // wired to the dead grant AND able to fire on its own
    for (const w of wfs) {
      const full = await (await fetch(`${N8N}/api/v1/workflows/${w.id}`, { headers: nh })).json();
      if (!JSON.stringify(full.nodes ?? []).includes(REVOKED_CRED.id)) continue;
      // A webhook-only workflow fails only when something calls it, which is a trap for the
      // next caller rather than a live outage. A schedule trigger fails on its own clock.
      const selfFiring = full.active && (full.nodes ?? []).some((n: any) => /Trigger$/.test(String(n.type)));
      if (selfFiring) armed++;
      stuck.push(`${full.name}${full.active ? (selfFiring ? " [ON A SCHEDULE]" : " [webhook-only]") : " [inactive]"}`);
    }
    say("revoked credential", armed ? "DOWN" : stuck.length ? "WARN" : "OK",
      stuck.length ? `${REVOKED_CRED.name} still wired to: ${stuck.join("; ")}` : `${REVOKED_CRED.name} referenced by no workflow`);
  } catch (err: any) {
    say("revoked credential", "UNKNOWN", String(err?.message ?? err));
  }

  // ---- 3. OnSinch --------------------------------------------------------------
  // NOT via timelineAudits. `action[eq]=order_created_via_api` looked like the obvious
  // measure and is not one: it recorded 4 of the engine's 39 creates over 2026-09-07..14,
  // reading as an eight-day outage that never happened while the engine was booking daily.
  // The engine's own order_action_log is the only honest count of what it did.
  try {
    const ctl = (await (await fetch(`${ONS}/orders?limit=1`, { headers: oh })).json())?.pagination?.count ?? 0;
    say("OnSinch API", ctl ? "OK" : "UNKNOWN", ctl ? `reachable, ${ctl} orders visible` : "control read returned nothing");
  } catch (err: any) {
    say("OnSinch API", "DOWN", String(err?.message ?? err));
  }

  // ---- 4. the state store, and what the engine actually did --------------------
  try {
    const sql = neon(requireEnv("DATABASE_URL"));
    const [{ n }] = (await sql`select count(*)::int n from conversation_state`) as any[];
    const [{ last }] = (await sql`select max(updated_at) last from conversation_state`) as any[];
    const [{ bound }] = (await sql`select count(*)::int bound from conversation_state where onsinch_order_id is not null`) as any[];
    say("state store", n > 0 ? "OK" : "UNKNOWN", `${n} threads, ${bound} holding an order, last write ${ago(last)}`);

    // Mail reaching the engine at all. This is the number that went to ZERO on 2026-09-10
    // while every workflow flag, every dashboard and the watchdog itself stayed green.
    const [{ m }] = (await sql`select count(*)::int m from inbound_raw where received_at > now() - interval '48 hours'`) as any[];
    const [{ seen }] = (await sql`select max(received_at) seen from inbound_raw`) as any[];
    say("mail ingested", m > 0 ? "OK" : "DOWN", `${m} messages in 48h, last ${ago(seen)}`);

    const acts = (await sql`select e->>'kind' kind, (e->>'ok')::boolean ok, count(*)::int c
      from conversation_state, jsonb_array_elements(coalesce(state->'order_action_log','[]'::jsonb)) e
      where to_timestamp(((e->>'ts')::bigint)/1000) > now() - interval '7 days'
      group by 1,2 order by 3 desc`) as any[];
    const sum = acts.reduce((t, a) => t + a.c, 0);
    say("engine writes", sum > 0 ? "OK" : "WARN",
      sum ? acts.map((a) => `${a.kind}${a.ok ? "" : " FAILED"} ${a.c}`).join(", ") + " (7d)" : "the engine has written nothing to OnSinch in 7 days");
  } catch (err: any) {
    say("state store", "DOWN", String(err?.message ?? err));
  }

  // ---- 5. the deployed app -----------------------------------------------------
  try {
    const r = await fetch("https://spartan-crew-jobber.vercel.app/", { method: "GET" });
    say("deployment", r.ok ? "OK" : "DOWN", `spartan-crew-jobber.vercel.app -> HTTP ${r.status}`);
  } catch (err: any) {
    say("deployment", "DOWN", String(err?.message ?? err));
  }

  // ---- 6. the four labels ------------------------------------------------------
  // Read through the credential that is known to work, so this reports whether the
  // LABELS exist. Whether the engine can POST them is the "gmail labels" row above.
  try {
    const wanted = ["Order Built", "Order Updated", "Order Needs Built", "Order Needs Updated"];
    const { execSync } = await import("node:child_process");
    const out = execSync(`node scripts/gmail-label-admin.mjs --list`, {
      env: { ...process.env, GMAIL_CRED_ID: "6Ab8OMlONlOA9vtG", GMAIL_CRED_NAME: "Gmail account 14" },
      encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "ignore"],
    });
    const missing = wanted.filter((w) => !new RegExp(`\\s${w}(\\s|$)`, "m").test(out));
    const manual = /\sManual(\s|$)/m.test(out);
    say("the four labels", missing.length || manual ? "WARN" : "OK",
      missing.length ? `missing: ${missing.join(", ")}` : `all four present${manual ? ", but 'Manual' is back" : ", 'Manual' gone"}`);
  } catch (err: any) {
    say("the four labels", "UNKNOWN", `could not read the mailbox: ${String(err?.message ?? err).slice(0, 80)}`);
  }

  // ---- report ------------------------------------------------------------------
  const pad = Math.max(...rows.map((r) => r.area.length));
  console.log("");
  for (const r of rows) console.log(`  ${r.verdict.padEnd(7)} ${r.area.padEnd(pad)}  ${r.detail}`);
  const down = rows.filter((r) => r.verdict === "DOWN");
  const unknown = rows.filter((r) => r.verdict === "UNKNOWN");
  console.log(`\n  ${down.length} down, ${rows.filter((r) => r.verdict === "WARN").length} warn, ${unknown.length} unknown, ${rows.filter((r) => r.verdict === "OK").length} ok`);
  if (unknown.length) console.log(`  UNKNOWN means the check could not be made — treat it as un-answered, never as healthy.`);
})();
