// ============================================================================
// The model is shown the whole conversation, labelled, in order.
// ----------------------------------------------------------------------------
// Ported from Ben's n8n conversational renderer. Three properties matter and none
// of them is visible from the call site:
//
//   1. EVERY message is rendered, not just the newest — this is the change. The
//      old shape put the newest under "LATEST" and the rest under "HISTORY", and a
//      client's crew request one message down read as background.
//   2. The role label is DETERMINISTIC. The prompt used to ask the model to infer
//      the speaker from the address; a labelled header cannot be misread.
//   3. The cap sheds Spartan's replies BEFORE the client's messages, because only a
//      client message can create a job. A cap that dropped oldest-first would throw
//      away the opening enquiry — the one message most likely to contain the ask.
// ============================================================================
import { renderConversation, labelOf, stamp } from "../app/lib/engine/renderThread";
import type { ThreadMessage } from "../app/lib/engine/types";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const msg = (over: Partial<ThreadMessage> & { body: string }): ThreadMessage => ({
  message_id: Math.random().toString(36).slice(2),
  from: "client@acme.com",
  to: ["bookings@spartancrew.co.uk"],
  date_iso: "2026-08-01T09:00:00Z",
  subject: "Crew request",
  is_from_spartan: false,
  ...over,
});

console.log("conversation renderer");

// --- the whole thread is present -------------------------------------------
{
  const history = [
    msg({ body: "I need 4 crew on the 3rd of October at ExCeL.", date_iso: "2026-08-01T09:00:00Z" }),
    msg({ body: "Thanks, quoting that now.", from: "bookings@spartancrew.co.uk", is_from_spartan: true, date_iso: "2026-08-01T10:00:00Z" }),
  ];
  const latest = msg({ body: "ok", date_iso: "2026-08-02T08:00:00Z" });
  const r = renderConversation(latest, history);
  ok(r.text.includes("4 crew on the 3rd of October"), "the client's original request is rendered");
  ok(r.text.includes("Thanks, quoting that now."), "Spartan's reply is rendered");
  ok(r.shown === 3, "all three messages counted", `got ${r.shown}`);
  // The regression this whole change exists to prevent: a one-word newest message
  // must not be the only thing the classifier can see.
  const beforeNewest = r.text.slice(0, r.text.indexOf("[NEWEST]"));
  ok(beforeNewest.includes("4 crew"), "the request appears BEFORE the newest message, as context");
}

// --- labels are deterministic ----------------------------------------------
{
  ok(labelOf(msg({ body: "x" })) === "from_client", "an external sender is from_client");
  ok(labelOf(msg({ body: "x", is_from_spartan: true })) === "reply_spartan", "Spartan is reply_spartan");
  const r = renderConversation(msg({ body: "hi" }), []);
  ok(r.text.includes("[from_client] [NEWEST]"), "the newest message is marked");
  ok((r.text.match(/\[NEWEST\]/g) || []).length === 1, "exactly one message is the newest");
}

// --- chronological, whatever order it arrives in ----------------------------
{
  const history = [
    msg({ body: "SECOND", date_iso: "2026-08-01T12:00:00Z" }),
    msg({ body: "FIRST", date_iso: "2026-08-01T08:00:00Z" }),
  ];
  const r = renderConversation(msg({ body: "THIRD", date_iso: "2026-08-01T15:00:00Z" }), history);
  ok(r.text.indexOf("FIRST") < r.text.indexOf("SECOND"), "out-of-order history is sorted by date");
  ok(r.text.indexOf("SECOND") < r.text.indexOf("THIRD"), "the newest message is last");
}

// --- the cap sheds Spartan first -------------------------------------------
{
  const big = "x".repeat(900);
  const history = [
    msg({ body: `CLIENTASK ${big}`, date_iso: "2026-08-01T08:00:00Z" }),
    msg({ body: `SPARTANONE ${big}`, from: "bookings@spartancrew.co.uk", is_from_spartan: true, date_iso: "2026-08-01T09:00:00Z" }),
    msg({ body: `SPARTANTWO ${big}`, from: "bookings@spartancrew.co.uk", is_from_spartan: true, date_iso: "2026-08-01T10:00:00Z" }),
  ];
  const r = renderConversation(msg({ body: "ok" }), history, 1200);
  ok(r.text.includes("CLIENTASK"), "the client's message survives a cap that cannot fit everything");
  ok(!r.text.includes("SPARTANONE"), "the oldest Spartan reply is dropped");
  ok(r.droppedSpartan === 2, "both Spartan replies were dropped", `got ${r.droppedSpartan}`);
  ok(r.droppedClient === 0, "no client message was dropped", `got ${r.droppedClient}`);
  ok(r.text.includes("omitted for length"), "the omission is declared, not silent");
}

// --- the newest message is never trimmed ------------------------------------
{
  const latest = msg({ body: "y".repeat(5000) });
  const r = renderConversation(latest, [msg({ body: "z".repeat(5000) })], 100);
  ok(r.text.includes("y".repeat(5000)), "the newest message is rendered in full however small the cap");
  ok(r.droppedClient === 1, "history still yields to the cap", `got ${r.droppedClient}`);
}

// --- a thread with no history still renders ---------------------------------
{
  const r = renderConversation(msg({ body: "first contact" }), []);
  ok(r.text.includes("first contact"), "a brand-new thread renders");
  ok(r.shown === 1, "one message", `got ${r.shown}`);
  ok(!r.text.includes("omitted"), "nothing claims to be omitted");
}

// --- dates ------------------------------------------------------------------
{
  ok(stamp("2026-08-10T14:32:00Z") === "2026-08-10 15:32 UK", "August renders as UK summer time", stamp("2026-08-10T14:32:00Z"));
  ok(stamp("2026-01-10T14:32:00Z") === "2026-01-10 14:32 UK", "January renders as UTC", stamp("2026-01-10T14:32:00Z"));
  // A thread carrying a junk date must still render the body it came with.
  ok(stamp("not a date") === "not a date", "an unparseable date is passed through, not faked");
  const r = renderConversation(msg({ body: "live", date_iso: "" }), [msg({ body: "old", date_iso: "" })]);
  ok(r.text.includes("live") && r.text.includes("old"), "undated messages still render");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
