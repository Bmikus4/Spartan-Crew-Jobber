// Run the "Build Engine Payload" n8n Code node body OUTSIDE n8n, against
// realistic Gmail fixtures, and assert it emits the engine intake contract.
// This is the only way to know the node works before the Gmail credential is
// reconnected. Run: node scripts/test-engine-payload.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./_env.mjs";

const src = readFileSync(join(ROOT_DIR, "n8n", "nodes", "build-engine-payload.js"), "utf8");

/** Execute the node body with n8n's globals faked. */
function runNode({ nodes = {}, json = {} }) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`no node "${name}"`); // n8n throws too
    const list = Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]];
    return { item: { json: list[0] }, all: () => list.map((j) => ({ json: j })) };
  };
  const fn = new Function("$", "$json", "Buffer", `${src}`);
  return fn($, json, Buffer);
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let fails = 0;
const ok = (cond, label, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// A realistic two-message Gmail thread: client enquiry, then a Spartan reply.
const gmailThread = {
  id: "thr_18c9a",
  messages: [
    {
      id: "msg_001",
      internalDate: "1769000000000",
      payload: {
        headers: [
          { name: "From", value: "Jane Doe <jane@bigevents.com>" },
          { name: "To", value: "bookings@spartancrew.co.uk" },
          { name: "Subject", value: "Crew needed 12 Aug - ExCeL" },
          { name: "Date", value: "Mon, 21 Jul 2026 09:14:00 +0100" },
          { name: "Message-ID", value: "<abc@mail.bigevents.com>" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Hi, we need 6 crew on 12 August at ExCeL London, 08:00-18:00.\n\nThanks\nJane") } },
          { mimeType: "text/html", body: { data: b64("<p>ignore me</p>") } },
        ],
      },
    },
    {
      id: "msg_002",
      internalDate: "1769003600000",
      payload: {
        headers: [
          { name: "From", value: "Bookings <bookings@spartancrew.co.uk>" },
          { name: "To", value: "jane@bigevents.com, ops@bigevents.com" },
          { name: "Subject", value: "Re: Crew needed 12 Aug - ExCeL" },
        ],
        body: { data: b64("Thanks Jane, confirming availability now.") },
      },
    },
  ],
};

const normalizeData = {
  original_email: { email_id: "msg_001", thread_id: "thr_18c9a", from: "jane@bigevents.com", subject: "Crew needed 12 Aug - ExCeL", body: "Hi, we need 6 crew on 12 August at ExCeL London, 08:00-18:00." },
  thread_history: { messages: ["some earlier cleaned body"] },
};
const renderer = { client_information: { name: "Jane Doe", email: "jane@bigevents.com" }, metadata: { render_hash: "deadbeef", classifications: [{ label: "from_client" }] } };
const verdict = { message: { content: '{"is_order":true}' } };

console.log("1. full Gmail thread -> engine contract");
let out = runNode({
  nodes: { "Normalize Data": normalizeData, "Get a thread2": gmailThread, "Conversational Renderer": renderer, "Determine if Order": verdict, Merge1: [] },
  json: { found: false, thread_first_seen: true, thread_message_count: 1 },
});
let p = out[0].json;
ok(Array.isArray(out) && out.length === 1, "returns one item");
ok(p.thread_id === "thr_18c9a", "thread_id", p.thread_id);
ok(p.messages.length === 2, "two messages", `got ${p.messages.length}`);
const m0 = p.messages[0];
ok(m0.message_id === "msg_001", "message_id", m0.message_id);
ok(m0.from === "jane@bigevents.com", "from unwrapped from display name", m0.from);
ok(m0.to.length === 1 && m0.to[0] === "bookings@spartancrew.co.uk", "to[]", JSON.stringify(m0.to));
ok(m0.subject === "Crew needed 12 Aug - ExCeL", "subject", m0.subject);
ok(/6 crew on 12 August/.test(m0.body), "text/plain body decoded, not the HTML part");
ok(m0.is_from_spartan === false, "client message not flagged spartan");
ok(new Date(m0.date_iso).getTime() === 1769000000000, "date_iso from internalDate", m0.date_iso);
const m1 = p.messages[1];
ok(m1.is_from_spartan === true, "spartan reply flagged");
ok(m1.to.length === 2, "multi-recipient To split", JSON.stringify(m1.to));
ok(/confirming availability/.test(m1.body), "payload.body (no parts) decoded");
ok(Date.parse(p.messages[0].date_iso) <= Date.parse(p.messages[1].date_iso), "chronological");

console.log("2. contract shape matches app/lib/engine/types.ts ThreadMessage");
const REQUIRED = ["message_id", "from", "to", "date_iso", "subject", "body", "is_from_spartan"];
ok(p.messages.every((m) => REQUIRED.every((k) => k in m)), "every message has all 7 fields");

console.log("3. context is carried, not dropped");
ok(p.n8n.client_information.name === "Jane Doe", "renderer client_information");
ok(p.n8n.render_hash === "deadbeef", "render_hash");
ok(p.n8n.history_text.length === 1, "bodies-only history carried as history_text");
ok(p.n8n.dedupe.thread_first_seen === true, "dedupe verdict carried (from $json fallback)");
ok(p.n8n.latest_message_id === "msg_001", "latest_message_id");

console.log("3b. dedupe flags come from the Dedupe Claim NODE, not $json");
// At the tap, $json is the classifier's item and never carries these. Reading
// $json reported found:false for every message; the node must be the source.
out = runNode({
  nodes: {
    "Normalize Data": normalizeData,
    "Get a thread2": gmailThread,
    "Dedupe Claim": { found: true, first_seen: false, thread_first_seen: false, thread_message_count: 3, seen_count: 2 },
  },
  json: { found: false, thread_first_seen: true }, // deliberately contradicts the node
});
p = out[0].json;
ok(p.n8n.dedupe.found === true, "found taken from the node (true), not $json (false)");
ok(p.n8n.dedupe.first_seen === false, "first_seen from the node");
ok(p.n8n.dedupe.thread_first_seen === false, "thread_first_seen from the node, not $json");
ok(p.n8n.dedupe.thread_message_count === 3, "thread_message_count from the node", String(p.n8n.dedupe.thread_message_count));

console.log("4. no Gmail thread node -> falls back to Merge1");
out = runNode({
  nodes: { "Normalize Data": normalizeData, Merge1: [gmailThread.messages[0]], "Conversational Renderer": renderer, "Determine if Order": verdict },
  json: {},
});
p = out[0].json;
ok(p.messages.length === 1, "one message from Merge1", `got ${p.messages.length}`);
ok(p.thread_id === "thr_18c9a", "thread_id from Normalize Data", p.thread_id);

console.log("5. nothing but Normalize Data -> still emits a usable thread");
out = runNode({ nodes: { "Normalize Data": normalizeData }, json: {} });
p = out[0].json;
ok(p.messages.length === 1, "single fallback message");
ok(p.messages[0].body.includes("6 crew"), "original body used");
ok(p.messages[0].from === "jane@bigevents.com", "from");

console.log("6. empty everything -> valid shape, no throw");
out = runNode({ nodes: {}, json: {} });
p = out[0].json;
ok(Array.isArray(p.messages), "messages is an array");
ok(p.messages.length === 0, "no messages invented");
ok(typeof p.thread_id === "string", "thread_id is a string");

console.log("7. snippet-only message (no decodable body)");
out = runNode({
  nodes: { "Get a thread2": { id: "t9", messages: [{ id: "m9", snippet: "Need 4 crew Friday", payload: { headers: [{ name: "From", value: "x@y.com" }] } }] } },
  json: {},
});
ok(out[0].json.messages.length === 1 && /4 crew/.test(out[0].json.messages[0].body), "snippet used as last resort");

console.log("8. the REAL shape 'Get a thread' returns: headers flattened onto the item");
// Copied from live execution 300327. payload has NO headers array - it holds only
// the MIME parts - and the headers sit on the item itself in wire casing. Every
// fixture above used payload.headers, so the tests passed while three real
// threads reached the engine with from and subject blank.
out = runNode({
  nodes: {
    "Get a thread2": {
      id: "19fae4d0dffce9e8",
      historyId: "41065513",
      messages: [
        {
          id: "19fae5a30d110664",
          threadId: "19fae4d0dffce9e8",
          snippet: "Hi Dan, Thanks for your call earlier.",
          sizeEstimate: 267346,
          internalDate: "1785336574000",
          labels: [{ id: "SENT", name: "SENT" }],
          "MIME-Version": "1.0",
          Date: "Wed, 29 Jul 2026 15:49:34 +0100",
          "Message-ID": "<CADtfxmFn2uNz9GjEsNJMAnF6@mail.gmail.com>",
          Subject: "4x Crew - Saturday 1st August - Olympia",
          From: "Bookings Spartan Crew <bookings@spartancrew.co.uk>",
          To: "Dan Hill <dan@tyserallan.com>",
          "Content-Type": 'multipart/mixed; boundary="0000000000004aea360657c11087"',
          payload: {
            partId: "",
            mimeType: "multipart/mixed",
            filename: "",
            body: { size: 0 },
            parts: [{ mimeType: "text/plain", body: { data: b64("Hi Dan,\r\n\r\nPlease see the attached price quote for 08:00-20:00 on Saturday.") } }],
          },
        },
      ],
    },
  },
  json: {},
});
p = out[0].json;
const r0 = p.messages[0];
ok(p.messages.length === 1, "one message", String(p.messages.length));
ok(r0.from === "bookings@spartancrew.co.uk", "from read off the flattened header (was '')", JSON.stringify(r0.from));
ok(r0.subject === "4x Crew - Saturday 1st August - Olympia", "subject read off the flattened header (was '')", JSON.stringify(r0.subject));
ok(r0.to.length === 1 && r0.to[0] === "dan@tyserallan.com", "to[] read off the flattened header (was [])", JSON.stringify(r0.to));
ok(r0.is_from_spartan === true, "is_from_spartan now correct - it was false for every message");
ok(r0.message_id === "19fae5a30d110664", "message_id still the Gmail id, not the RFC Message-ID", r0.message_id);
ok(new Date(r0.date_iso).getTime() === 1785336574000, "date_iso from internalDate", r0.date_iso);
ok(/price quote/.test(r0.body), "body still decoded from payload.parts");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
