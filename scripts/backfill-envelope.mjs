// Fills inbound_raw.envelope and inbound_raw.message_ids for rows captured before the
// restructure, from their own payload.
//
// Without this the two eras report differently: a new row carries an envelope and no
// payload, an old row a payload and no envelope, and every ops script needs to know which
// it is looking at. With it, `envelope` answers for every row and `payload` becomes purely
// a legacy copy that the reclaim can empty.
//
// Reads payload, writes envelope only. The payload is untouched.
//
//   node scripts/backfill-envelope.mjs           # dry run
//   node scripts/backfill-envelope.mjs --apply
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");

// Ids only: selecting every payload at once exceeds the Neon HTTP driver's 64 MB response
// cap, which is the same reason survey-inbound had to stop doing it.
const ids = await sql`
  SELECT id FROM inbound_raw
  WHERE payload IS NOT NULL AND (envelope IS NULL OR message_ids IS NULL) ORDER BY id`;
console.log(`${ids.length} row(s) need an envelope or message_ids${APPLY ? "" : "  (DRY RUN — pass --apply)"}`);

let done = 0, keys = new Set();
for (const { id } of ids) {
  const [r] = await sql`SELECT id, payload FROM inbound_raw WHERE id = ${id}`;
  if (!r?.payload || typeof r.payload !== "object") continue;
  const env = { ...r.payload };
  delete env.messages;
  for (const k of Object.keys(env)) keys.add(k);
  // Which messages THIS delivery carried. Without it every delivery of a thread looks
  // identical once the payload is gone, because the thread rebuilds whole every time.
  const mids = (Array.isArray(r.payload.messages) ? r.payload.messages : [])
    .map((m) => String(m?.message_id ?? m?.messageId ?? m?.id ?? "").trim())
    .filter(Boolean);
  if (!APPLY) continue;
  await sql`UPDATE inbound_raw SET envelope = ${JSON.stringify(env)}, message_ids = ${mids} WHERE id = ${id}`;
  done++;
  if (done % 100 === 0) process.stdout.write(`\r  ${done}/${ids.length}`);
}

console.log(`\nenvelope keys seen: ${[...keys].sort().join(", ") || "(none)"}`);
if (APPLY) {
  const [{ n }] = await sql`SELECT count(*)::int n FROM inbound_raw WHERE envelope IS NOT NULL`;
  console.log(`wrote ${done}; ${n} row(s) now carry an envelope`);
}
