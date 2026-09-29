// ============================================================================
// An unsent Gmail draft is not a message Spartan sent.
// ----------------------------------------------------------------------------
// Gmail keeps a draft ON its thread, and threads.get returns it beside the real
// mail. Nothing in this repo has ever looked at labelIds, so a draft arrived at
// messagesFromPayload indistinguishable from a reply and was stored with
// is_from_spartan: true — because its From is bookings@spartancrew.co.uk, which
// is perfectly true and completely misleading.
//
// WHAT THAT COSTS. Every reader of thread_messages then believes Spartan answered.
// The direction of a thread inverts: a client waiting on us reads as us waiting on
// the client, which is the cheap silence standing in for the expensive one. It is
// also unrecoverable after the fact — once later mail lands, the tail of the thread
// no longer shows who was owed a reply, and no amount of re-analysis rebuilds it.
//
// WHY DROP THE MESSAGE RATHER THAN FLAG IT. Both inserts in threadMessagesDb.ts
// carry ON CONFLICT (message_id) DO NOTHING, and a draft KEEPS its message id when
// it is sent. Stored-and-flagged, the send hits the conflict clause, does nothing,
// and the row stays marked a draft forever — a real reply permanently invisible.
// Never stored, the send inserts cleanly as a first sighting. The more sophisticated
// option is the one that corrupts.
//
// THIS IS THE ONLY CHOKEPOINT. Both storeThreadMessages and the sweep-ingest route
// normalise through messagesFromPayload, so a guard here cannot be walked around by
// a caller — but it can only act on what the caller sends. The n8n sweep's payload
// builder does not read labelIds at all, so the sweep path stays blind until that
// workflow is redeployed. See test [5].
//
// Run: npx tsx test/draftIsNotAMessage.ts
// ============================================================================
import { messagesFromPayload } from "../app/lib/threadMessagesDb";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const CLIENT = {
  message_id: "m1",
  from: "jo@wall-to-wall.example",
  to: ["bookings@spartancrew.co.uk"],
  date_iso: "2026-09-18T09:00:00.000Z",
  subject: "3 x Crew 19th/20th September",
  body: "Can you cover Friday and Saturday?",
  labelIds: ["INBOX"],
};

const SPARTAN_SENT = {
  message_id: "m2",
  from: "bookings@spartancrew.co.uk",
  to: ["jo@wall-to-wall.example"],
  date_iso: "2026-09-18T10:00:00.000Z",
  subject: "Re: 3 x Crew 19th/20th September",
  body: "Yes — three crew, both days.",
  labelIds: ["SENT"],
};

const SPARTAN_DRAFT = {
  message_id: "m3",
  from: "bookings@spartancrew.co.uk",
  to: ["jo@wall-to-wall.example"],
  date_iso: "2026-09-18T11:00:00.000Z",
  subject: "Re: 3 x Crew 19th/20th September",
  body: "Connectivity check from the Spartan engine. Never sent.",
  labelIds: ["DRAFT"],
};

const payload = (messages: unknown[]) => ({ thread_id: "t1", messages });

console.log("\n[1] a message carrying the DRAFT label is not stored");
{
  const out = messagesFromPayload(payload([CLIENT, SPARTAN_DRAFT]));
  ok(out.length === 1, "one of the two messages survives", `${out.length}`);
  ok(!out.some((m) => m.message_id === "m3"), "and it is not the draft",
    out.map((m) => m.message_id).join(","));
}

console.log("\n[2] the draft does not invert whose turn it is");
{
  /**
   * THE WHOLE POINT, stated as the thing a reader actually asks. The client wrote
   * last and nobody has answered. With the draft stored, the newest message reads
   * as Spartan's and the thread looks answered.
   */
  const out = messagesFromPayload(payload([CLIENT, SPARTAN_DRAFT]));
  const newest = [...out].sort((a, b) => a.date_iso.localeCompare(b.date_iso)).at(-1);
  ok(newest?.is_from_spartan === false,
    "the last message on the thread is still the client's", String(newest?.message_id));
}

console.log("\n[3] a genuinely sent reply is untouched");
{
  const out = messagesFromPayload(payload([CLIENT, SPARTAN_SENT]));
  ok(out.length === 2, "both messages are stored", `${out.length}`);
  const newest = [...out].sort((a, b) => a.date_iso.localeCompare(b.date_iso)).at(-1);
  ok(newest?.is_from_spartan === true, "and Spartan is correctly the last to speak");
}

console.log("\n[4] the signal is accepted in every spelling a caller might send");
{
  const shapes: Array<[string, Record<string, unknown>]> = [
    ["labelIds", { ...SPARTAN_DRAFT, message_id: "a", labelIds: ["DRAFT"] }],
    ["labelIds lowercase", { ...SPARTAN_DRAFT, message_id: "b", labelIds: ["draft"] }],
    ["label_ids", { ...SPARTAN_DRAFT, message_id: "c", labelIds: undefined, label_ids: ["DRAFT"] }],
    ["labels", { ...SPARTAN_DRAFT, message_id: "d", labelIds: undefined, labels: ["DRAFT"] }],
    ["is_draft", { ...SPARTAN_DRAFT, message_id: "e", labelIds: undefined, is_draft: true }],
  ];
  for (const [name, m] of shapes) {
    const out = messagesFromPayload(payload([m]));
    ok(out.length === 0, `${name} is recognised as a draft`, `${out.length} stored`);
  }
  /**
   * DRAFT is a label among others; a draft thread also carries INBOX and the
   * thread's own labels. Membership, never equality.
   */
  const mixed = messagesFromPayload(
    payload([{ ...SPARTAN_DRAFT, message_id: "f", labelIds: ["INBOX", "DRAFT", "Order Built"] }])
  );
  ok(mixed.length === 0, "DRAFT among other labels still counts");
}

console.log("\n[5] no label information means no claim either way");
{
  /**
   * THE HOLE, PINNED SO IT CANNOT BE FORGOTTEN. The n8n sweep payload builder maps
   * every Gmail message and never reads labelIds, so its messages arrive with no
   * signal at all. This guard cannot invent one: a message with no labels is stored,
   * exactly as before. The sweep path is blind until that workflow is redeployed,
   * and this case is what says so out loud rather than leaving a reader to assume
   * the guard covers both intakes.
   */
  const out = messagesFromPayload(payload([{ ...SPARTAN_DRAFT, message_id: "g", labelIds: undefined }]));
  ok(out.length === 1,
    "a message with no label information is still stored — the sweep path is not yet covered",
    `${out.length}`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
