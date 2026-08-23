// ============================================================================
// A row captured after the restructure still yields a payload.
// ----------------------------------------------------------------------------
// Nine ops scripts read inbound_raw.payload. The restructure stopped writing it.
// The failure mode if this seam is wrong is the bad kind: the column still
// exists, so every one of them reads null and reports "no enquiries" rather than
// crashing. This asserts the reconstruction instead of trusting it.
//
// Run: npx tsx test/opsScriptsReadMessages.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { payloadFor } from "../scripts/_thread.mjs";
import { captureInboundRaw } from "../app/lib/inboundRawDb";
import { coerceThread } from "../app/lib/engine/intake";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `opstest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const original = {
  thread_id: `${TAG}-t`,
  n8n: { verdict: { from: "jane@client.com", gate: "priceable" } },
  messages: [
    { message_id: `${TAG}-1`, from: "Jane <jane@client.com>", to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-08-01T09:00:00Z", subject: "Crew for Friday", body: "Eight riggers please." },
    { message_id: `${TAG}-2`, from: "Jane <jane@client.com>", to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-08-02T09:00:00Z", subject: "Re: Crew for Friday", body: "Make it nine." },
  ],
};

async function main() {
  await captureInboundRaw(original, "test");
  const [row] = (await sql`
    SELECT thread_id, payload, envelope FROM inbound_raw
    WHERE thread_id = ${TAG + "-t"} ORDER BY id DESC LIMIT 1`) as any[];
  ok(row.payload === null, "the stored row has no payload");

  const rebuilt: any = await payloadFor(sql, row.thread_id, row.payload, row.envelope);
  ok(rebuilt.messages.length === 2, "the reconstruction has both messages", String(rebuilt.messages.length));
  ok(rebuilt.messages[1].body === "Make it nine.", "with their bodies");
  ok(rebuilt.n8n?.verdict?.gate === "priceable", "and the n8n verdict the envelope kept");

  const a = coerceThread(rebuilt);
  const b = coerceThread(original);
  ok(JSON.stringify(a) === JSON.stringify(b),
     "coerceThread cannot tell the reconstruction from the original");

  // A pre-restructure row must still be returned exactly as stored.
  const legacy = await payloadFor(sql, "whatever", original, null);
  ok(legacy === original, "a row that still carries a payload is passed through untouched");

  await sql`DELETE FROM inbound_raw WHERE thread_id = ${TAG + "-t"}`;
  await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG + "-t"}`;
  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}
main();
