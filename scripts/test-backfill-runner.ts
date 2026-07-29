// Exercise the REAL backfill runner end to end against LIVE OnSinch orders, by
// seeding conversation_state with synthetic threads built to match two of them,
// running the dry run, and asserting the buckets. Then removes its own rows.
//
// This covers what the unit tests cannot: candidateThreads() flattening the
// stored ConversationState into the scorer's ThreadSide, and the runner's
// bucketing over real order records.
//
// Dry run only - never passes --apply, so nothing is written to tickets.
//
//   npx tsx scripts/test-backfill-runner.ts
import { neon } from "@neondatabase/serverless";
import { execFileSync } from "node:child_process";
import { loadEnv, requireEnv, onsinchGet } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const KEY = requireEnv("ONSINCH_API_KEY");
const TAG = `bftest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

async function main() {
  // Two real, recent, non-internal orders to target.
  const r = await onsinchGet(`/orders?limit=100&page=1&with=Job`, KEY);
  const rows: Record<string, any>[] = (r?.data ?? []).filter((o: any) => Number(o.company_id) !== 1);
  rows.sort((a, b) => Date.parse(b.created ?? 0) - Date.parse(a.created ?? 0));
  const [o1, o2] = rows;
  if (!o1 || !o2) { console.error("could not fetch two orders"); process.exit(1); }
  const venueOf = (name: string) => { const i = String(name).lastIndexOf("@"); return i === -1 ? "" : String(name).slice(i + 1).trim(); };
  console.log(`targets: #${o1.id} "${o1.name}"  and  #${o2.id} "${o2.name}"\n`);

  // A thread that should link to o1 on identity + venue + date, and a decoy that
  // should link to nothing.
  // withIds=false is the REALISTIC backfill case: a thread the engine has not
  // resolved OnSinch ids for yet, so the link has to be earned from the company
  // name, venue and date alone. That is exactly the path the "unavailable
  // evidence is not evidence against" fix exists for.
  const seed = (thread_id: string, o: Record<string, any> | null, email: string, withIds = true) => ({
    thread_id,
    subject: o ? `Crew for ${venueOf(o.name)}` : "unrelated invoice question",
    participants: [email, "bookings@spartancrew.co.uk"],
    last_message_id: "m1",
    last_processed_epoch: o ? Date.parse(o.created) - 2 * 86400000 : Date.parse("2020-01-01"),
    classification: "new-job",
    facts: {
      contact_email: email,
      company_name: o ? undefined : "Nothing To Do With Us Ltd",
      location_text: o ? venueOf(o.name) : "somewhere else",
      requests: o ? [{ date: String(o.happening).slice(0, 10), size: 4 }] : [{ date: "2020-01-02" }],
    },
    company_id: o && withIds ? o.company_id : null,
    user_id: o && withIds ? o.user_id : null,
    desired_order: null,
    priority: "medium",
    needs_human: false,
    status: "open",
    notes: [],
    order_action_log: [],
  });

  const rowsToSeed = [
    seed(`${TAG}-match`, o1, "someone@client.example"),
    // no resolved ids: must link on name/venue/date evidence only
    seed(`${TAG}-noids`, o2, "other@client.example", false),
    seed(`${TAG}-decoy`, null, "accounts@unrelated.example"),
  ];
  for (const s of rowsToSeed) {
    await sql`INSERT INTO conversation_state (thread_id, status, needs_human, onsinch_order_id, state)
              VALUES (${s.thread_id}, ${s.status}, ${s.needs_human}, ${null}, ${JSON.stringify(s)})
              ON CONFLICT (thread_id) DO UPDATE SET state = EXCLUDED.state`;
  }
  console.log(`seeded ${rowsToSeed.length} synthetic threads\n`);

  let out = "";
  try {
    out = execFileSync("npx", ["tsx", "scripts/backfill-jobs.ts", "--count", "30"], {
      encoding: "utf8", cwd: process.cwd(), shell: true,
    });
  } finally {
    const del = await sql`DELETE FROM conversation_state WHERE thread_id LIKE ${TAG + "%"} RETURNING thread_id`;
    console.log(`(cleanup: removed ${del.length} synthetic threads)\n`);
  }

  console.log("--- runner output ---");
  console.log(out.split("\n").filter((l) => /^(OnSinch|Inbox|linked|ambiguous|unmatched|skipped|  LINK|  AMBIG|\(dry run)/.test(l)).join("\n"));
  console.log("--- assertions ---");

  ok(/Inbox:\s+3 candidate threads/.test(out), "the runner saw all seeded threads");
  ok(/skipped\s+\d+ internal Spartan order/.test(out) || !/co=1/.test(out), "internal Spartan orders reported separately, not as failures");
  ok(new RegExp(`LINK  #${o1.id} -> ${TAG}-match`).test(out), `#${o1.id} linked to the matching thread`);
  ok(new RegExp(`LINK  #${o2.id} -> ${TAG}-noids`).test(out),
    `#${o2.id} linked WITHOUT resolved ids (earned from name/venue/date)`);
  ok(!new RegExp(`-> ${TAG}-decoy`).test(out), "the decoy thread was linked to NOTHING");
  ok(/\(dry run — nothing written/.test(out), "dry run wrote nothing");

  // and prove it really wrote nothing
  const left = await sql`SELECT count(*)::int AS n FROM tickets WHERE thread_id LIKE ${TAG + "%"}`;
  ok((left[0] as any).n === 0, "no tickets created by the dry run");

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
