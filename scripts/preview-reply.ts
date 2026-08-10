// ============================================================================
// See what a reply would say, WITHOUT drafting it anywhere.
// ----------------------------------------------------------------------------
// replies_enabled is a switch that starts writing into a live client mailbox, and
// the only honest way to decide whether to flip it is to read what it produces
// against real threads. This runs composeReply on stored threads and prints the
// result. It creates no draft, sends nothing, and writes nothing to the database.
//
// It uses the same prompt, model and thread text the production path uses -
// REPLY_SYSTEM in prompts.ts, ported near-verbatim from the live n8n "Create
// Email1" node - so what you read here is what a client would read.
//
// Costs one model call per thread. Default 3.
//
//   npx tsx scripts/preview-reply.ts                # 3 most recent job threads
//   npx tsx scripts/preview-reply.ts --limit 5
//   npx tsx scripts/preview-reply.ts --thread <id>
//   npx tsx scripts/preview-reply.ts --any          # include not-a-job threads
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";
import { createOpenRouterReasoner } from "../app/lib/engine/reason";
import { normalizeThread } from "../app/lib/engine/normalize";
import { coerceThread } from "../app/lib/engine/intake";
import type { Classification } from "../app/lib/engine/types";

loadEnv();

const argv = process.argv.slice(2);
const LIMIT = Number(argv[argv.indexOf("--limit") + 1]) || 3;
const ONLY = argv.includes("--thread") ? String(argv[argv.indexOf("--thread") + 1] || "") : "";
const ANY = argv.includes("--any");

const sql = neon(requireEnv("DATABASE_URL"));
const reasoner = createOpenRouterReasoner({
  apiKey: requireEnv("OPENROUTER_API_KEY"),
  model: process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6",
});

const strip = (html: string) =>
  html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();

async function main() {
  // Neon's tagged template interpolates VALUES, not SQL, so the filter is two
  // separate queries rather than a fragment spliced into one.
  const rows = ONLY
    ? await sql`SELECT thread_id, payload, NULL AS classification FROM inbound_raw WHERE thread_id = ${ONLY} ORDER BY received_at DESC LIMIT 1`
    : ANY
      ? await sql`
          SELECT DISTINCT ON (r.thread_id) r.thread_id, r.payload, t.classification
          FROM inbound_raw r JOIN tickets t ON t.thread_id = r.thread_id
          ORDER BY r.thread_id, r.received_at DESC`
      : await sql`
          SELECT DISTINCT ON (r.thread_id) r.thread_id, r.payload, t.classification
          FROM inbound_raw r JOIN tickets t ON t.thread_id = r.thread_id
          WHERE t.classification IN ('new-job','update')
          ORDER BY r.thread_id, r.received_at DESC`;

  const pick = (rows as Array<Record<string, unknown>>).slice(0, LIMIT);
  console.log(`previewing ${pick.length} thread(s). No draft is created and nothing is sent.\n`);

  for (const row of pick) {
    const thread = coerceThread(row.payload);
    if (!thread) { console.log(`${row.thread_id}: payload did not satisfy the intake contract`); continue; }
    const { latest, history } = normalizeThread(thread);
    const cls = (row.classification as Classification) ?? "new-job";

    console.log("=".repeat(78));
    console.log(`THREAD ${row.thread_id}   classified: ${cls}`);
    console.log(`the message it is replying to - from ${latest.from}`);
    console.log(`  subject: ${latest.subject}`);
    console.log(`  ${String(latest.body).replace(/\s+/g, " ").slice(0, 320)}`);
    console.log(`  (${history.length} earlier message(s) also sent to the model)`);
    console.log("-".repeat(78));

    const reply = await reasoner.composeReply(latest, history, cls);
    console.log(`SUBJECT: ${reply.subject}`);
    console.log(`PRIORITY: ${(reply as { priority?: string }).priority ?? "-"}`);
    console.log("");
    console.log(strip(reply.html).split("\n").map((l) => "  " + l).join("\n"));
    console.log("");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
