// ============================================================================
// Run the sweep workflow's Code nodes outside n8n.
// ----------------------------------------------------------------------------
// The three Code nodes in n8n/spartan-sweep.workflow.json are strings until n8n
// runs them, so a mistake in one is invisible until it is discovered halfway
// through a month of real mail. This executes each with a stand-in $input and
// checks what comes out, including that the payload it builds is the SAME shape
// scripts/sweep-gmail.ts builds — a corpus gathered by either route has to be one
// corpus, or measurements taken from it are comparing two different things.
//
//   npx tsx test/sweepWorkflowNodes.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`); }
};

const wf = JSON.parse(readFileSync(join(process.cwd(), "n8n", "spartan-sweep.workflow.json"), "utf8"));
const code = (name: string): string => {
  const node = wf.nodes.find((n: any) => n.name === name);
  if (!node) throw new Error(`no node "${name}" in the workflow`);
  return node.parameters.jsCode;
};

/** n8n's Code-node contract, as much of it as these nodes use. */
function runNode(jsCode: string, items: Array<{ json: any }>): Array<{ json: any }> {
  const $input = {
    first: () => items[0],
    all: () => items,
  };
  const fn = new Function("$input", "Buffer", `${jsCode}`);
  return fn($input, Buffer);
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

console.log("\n[1] Build Window turns a request into a Gmail query");
{
  const explicit = runNode(code("Build Window"), [{ json: { body: { after: "2025/09/01", before: "2025/10/01" } } }]);
  ok("explicit window becomes after:/before:", explicit[0].json.q === "after:2025/09/01 before:2025/10/01", explicit[0].json.q);
  ok("label is filename-safe", explicit[0].json.label === "2025-09-01", explicit[0].json.label);

  const rel = runNode(code("Build Window"), [{ json: { body: { monthsAgo: 1 } } }]);
  const q = rel[0].json.q as string;
  const m = /^after:(\d{4})\/(\d{1,2})\/1 before:(\d{4})\/(\d{1,2})\/1$/.exec(q);
  ok("monthsAgo yields a whole calendar month", !!m, q);
  if (m) {
    const from = Date.UTC(+m[1], +m[2] - 1, 1);
    const to = Date.UTC(+m[3], +m[4] - 1, 1);
    const days = (to - from) / 86_400_000;
    ok("that month is 28-31 days long", days >= 28 && days <= 31, `${days} days`);
    const now = new Date();
    const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    ok("monthsAgo:1 is last month, not this one", from === expected, new Date(from).toISOString().slice(0, 10));
  }

  // Consecutive windows must meet exactly — a seam loses a day of mail, an overlap
  // costs a re-fetch. Checked against the node's own output, not re-derived maths.
  const w0 = runNode(code("Build Window"), [{ json: { body: { monthsAgo: 0 } } }])[0].json;
  const w1 = runNode(code("Build Window"), [{ json: { body: { monthsAgo: 1 } } }])[0].json;
  ok("last month's window ends where this month's begins", w1.before === w0.after, `${w1.before} vs ${w0.after}`);

  let threw = false;
  try { runNode(code("Build Window"), [{ json: { body: {} } }]); } catch { threw = true; }
  ok("a request with no window at all is refused", threw);
}

console.log("\n[2] Distinct Threads collapses a message list to threads");
{
  const items = [
    { json: { id: "m1", threadId: "t1" } },
    { json: { id: "m2", threadId: "t1" } },
    { json: { id: "m3", threadId: "t2" } },
    // No threadId: the node falls back to `id`, which is what lets it also accept a
    // list of threads. Gmail's message list always carries threadId, so this only
    // matters for the thread-shaped input.
    { json: { id: "t3" } },
  ];
  const out = runNode(code("Distinct Threads"), items);
  const ids = out.map((o) => o.json.threadId);
  ok("duplicates collapsed", ids.filter((i) => i === "t1").length === 1, JSON.stringify(ids));
  ok("every distinct thread kept", ids.includes("t1") && ids.includes("t2"), JSON.stringify(ids));
  ok("falls back to id when threadId is absent", ids.includes("t3"));
  ok("nothing empty got through", ids.every(Boolean));
}

console.log("\n[3] Build Sweep Payload matches what the terminal sweep produces");
{
  const thread = {
    id: "t9",
    messages: [
      {
        id: "m1",
        internalDate: String(Date.UTC(2025, 8, 10, 9, 0)),
        snippet: "snip",
        payload: {
          headers: [
            { name: "From", value: "Jane Client <Jane@BigVenue.example>" },
            { name: "To", value: "bookings@spartancrew.co.uk, ops@spartancrew.co.uk" },
            { name: "Subject", value: "Crew for Saturday" },
            { name: "Date", value: "Tue, 01 Jan 2030 00:00:00 +0000" },   // a lying header
          ],
          mimeType: "multipart/mixed",
          parts: [
            { mimeType: "application/pdf", filename: "spec.pdf", body: { attachmentId: "a1", size: 9 } },
            { mimeType: "multipart/alternative", parts: [
              { mimeType: "text/plain", body: { data: b64url("We need 6 crew on Saturday.") } },
              { mimeType: "text/html", body: { data: b64url("<p>html twin</p>") } },
            ] },
          ],
        },
      },
      {
        id: "m2",
        internalDate: String(Date.UTC(2025, 8, 10, 10, 0)),
        payload: {
          headers: [
            { name: "From", value: "Bookings <bookings@spartancrew.co.uk>" },
            { name: "To", value: "jane@bigvenue.example" },
            { name: "Subject", value: "Re: Crew for Saturday" },
          ],
          mimeType: "text/html",
          body: { data: b64url("<html><body><style>p{}</style><p>Quote&nbsp;attached.</p></body></html>") },
        },
      },
    ],
  };

  const out = runNode(code("Build Sweep Payload"), [{ json: thread }]);
  const p = out[0].json;
  ok("thread_id carried", p.thread_id === "t9", p.thread_id);
  ok("both messages mapped", p.messages.length === 2, `${p.messages.length}`);

  const [first, second] = p.messages;
  ok("address extracted from a display name and lowercased", first.from === "jane@bigvenue.example", first.from);
  ok("all recipients kept", Array.isArray(first.to) && first.to.length === 2, JSON.stringify(first.to));
  ok("internalDate wins over a lying Date header", first.date_iso.startsWith("2025-09-10"), first.date_iso);
  ok("body found under multipart/mixed -> alternative, past the attachment", first.body === "We need 6 crew on Saturday.", JSON.stringify(first.body));
  ok("client mail is not marked as Spartan's", first.is_from_spartan === false);
  ok("Spartan's own reply is marked", second.is_from_spartan === true);
  ok("HTML-only body is stripped to text", second.body === "Quote attached.", JSON.stringify(second.body));
  ok("no style block leaked into the text", !/p\{\}/.test(String(second.body)));
  ok("sweep marker set for the store", p.sweep?.mailbox === "bookings@spartancrew.co.uk" && p.sweep?.swept === true);

  // Same field set as the terminal sweep builds, so the two routes fill one corpus.
  const expectedFields = ["message_id", "from", "to", "date_iso", "subject", "body", "is_from_spartan"].sort();
  ok("message fields identical to scripts/sweep-gmail.ts", JSON.stringify(Object.keys(first).sort()) === JSON.stringify(expectedFields), Object.keys(first).sort().join(","));
}

// Storing the payload is not re-checked here: test/sweepIsolation.ts already drives
// storeSweptThread with this exact shape and proves the production tables are
// untouched afterwards.

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} passed)\n`);
process.exitCode = fail === 0 ? 0 : 1;
