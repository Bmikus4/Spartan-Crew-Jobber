// Decomposes the inbound_raw payloads already stored into thread_messages, so the history
// is in the new shape alongside the old one.
//
// Reads only. Nothing in inbound_raw is modified here.
//
//   node scripts/backfill-thread-messages.mjs           # dry run
//   node scripts/backfill-thread-messages.mjs --apply
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");

// Ids only. Selecting every payload at once returns more than the Neon HTTP driver will
// carry in one response, so each is fetched inside the loop.
const ids = await sql`SELECT id FROM inbound_raw WHERE payload IS NOT NULL ORDER BY id`;
console.log(`${ids.length} payload(s) to decompose${APPLY ? "" : "  (DRY RUN — pass --apply)"}`);

const seen = new Set();
let copies = 0, inserted = 0;

for (const { id } of ids) {
  const [r] = await sql`SELECT id, thread_id, payload FROM inbound_raw WHERE id = ${id}`;
  const p = r?.payload;
  const msgs = Array.isArray(p?.messages) ? p.messages : [];
  const thread_id = String(p?.thread_id ?? p?.threadId ?? r?.thread_id ?? "").trim();
  for (const m of msgs) {
    copies++;
    const mid = String(m?.message_id ?? m?.messageId ?? m?.id ?? "").trim();
    if (!mid || !thread_id) continue;
    if (seen.has(mid)) continue;
    seen.add(mid);
    if (!APPLY) continue;
    const rawFrom = String(m?.from ?? "");
    const from = rawFrom.match(/<([^>]+)>/)?.[1] ?? rawFrom.trim();
    const rows = await sql`
      INSERT INTO thread_messages
        (message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan)
      VALUES (${mid}, ${thread_id}, ${from},
              ${JSON.stringify(Array.isArray(m?.to) ? m.to : [])},
              ${String(m?.date_iso ?? m?.date ?? "")}, ${String(m?.subject ?? "")},
              ${String(m?.body ?? "") || null},
              ${/@spartancrew\.co\.uk$/i.test(from)})
      ON CONFLICT (message_id) DO NOTHING
      RETURNING message_id`;
    if (rows.length) inserted++;
  }
}

console.log(`message copies seen: ${copies}`);
console.log(`distinct messages:   ${seen.size}`);
console.log(`duplication factor:  ${(copies / Math.max(seen.size, 1)).toFixed(1)}x`);
if (APPLY) {
  const [{ n }] = await sql`SELECT count(*)::int n FROM thread_messages`;
  console.log(`inserted ${inserted}; thread_messages now holds ${n}`);
}
