// ============================================================================
// Rehearse the 12-month sweep against a stand-in Gmail.
// ----------------------------------------------------------------------------
// The live sweep is a single unrepeatable run over a real mailbox: if the month
// windows leave a gap, or paging stops early, or a MIME body decodes to nothing,
// the corpus is silently wrong and the validation built on it is worthless. So the
// sweep runs here first against a fake Gmail whose contents we know exactly.
//
// The fake serves the two endpoints the sweep uses (messages.list with q/pageToken,
// threads.get) plus the token refresh, and is deliberately awkward in the ways real
// Gmail is: paging under maxResults, a nested multipart body, a 403 rateLimitExceeded,
// and a thread whose messages straddle two month windows.
//
//   npx tsx test/sweepGmail.ts
// ============================================================================
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`); }
};

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

// ---------------------------------------------------------------- the fake mailbox
// Dates are fixed relative to "now" so the sweep's own month windows must find them:
// one message in the current month, one 40 days back (previous month or the one
// before), and a thread with messages on both sides of a month boundary.
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

interface FakeMsg { id: string; threadId: string; date: Date; from: string; to: string; subject: string; plain?: string; html?: string; nested?: boolean }
const MESSAGES: FakeMsg[] = [
  { id: "m1", threadId: "t1", date: daysAgo(2),  from: "Jane Client <jane@bigvenue.example>", to: "bookings@spartancrew.co.uk", subject: "Crew for Saturday", plain: "We need 6 crew on Saturday at the arena." },
  { id: "m2", threadId: "t1", date: daysAgo(1),  from: "Bookings <bookings@spartancrew.co.uk>", to: "jane@bigvenue.example", subject: "Re: Crew for Saturday", plain: "Happy to help — sending a quote." },
  { id: "m3", threadId: "t2", date: daysAgo(40), from: "Sam <sam@othervenue.example>",       to: "bookings@spartancrew.co.uk", subject: "Load-in help", nested: true },
  { id: "m4", threadId: "t3", date: daysAgo(28), from: "Pat <pat@thirdvenue.example>",       to: "bookings@spartancrew.co.uk", subject: "Straddles a month", plain: "First half." },
  { id: "m5", threadId: "t3", date: daysAgo(35), from: "Pat <pat@thirdvenue.example>",       to: "bookings@spartancrew.co.uk", subject: "Straddles a month", html: "<html><body><p>Second&nbsp;half.</p></body></html>" },
];

// Boundary mail: 00:30 UTC on the 1st of each of the last three months, and 23:30 UTC
// on the last day of each. These are exactly the messages a month window that is off
// by a day, or that leaves a seam between windows, will miss — and unlike a check
// against re-derived window maths, missing one shows up as a thread the sweep
// never fetched.
const BOUNDARY: FakeMsg[] = [];
for (let i = 0; i < 3; i++) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1, 0, 30));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 30));
  BOUNDARY.push({ id: `b${i}a`, threadId: `tb${i}a`, date: first, from: `first${i}@edge.example`, to: "bookings@spartancrew.co.uk", subject: `First of month ${i}`, plain: "edge" });
  if (last.getTime() < now.getTime()) {
    BOUNDARY.push({ id: `b${i}b`, threadId: `tb${i}b`, date: last, from: `last${i}@edge.example`, to: "bookings@spartancrew.co.uk", subject: `Last of month ${i}`, plain: "edge" });
  }
}
MESSAGES.push(...BOUNDARY);

const NESTED_BODY = "Nested plain text that only a recursive walk will find.";

function payloadFor(m: FakeMsg) {
  const headers = [
    { name: "From", value: m.from },
    { name: "To", value: m.to },
    { name: "Subject", value: m.subject },
    { name: "Date", value: m.date.toUTCString() },
  ];
  if (m.nested) {
    // multipart/mixed -> multipart/alternative -> text/plain, with an attachment
    // part that has no data. bodyOf() has to recurse past both to find the text.
    return {
      headers,
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "application/pdf", filename: "quote.pdf", body: { attachmentId: "att1", size: 1234 } },
        { mimeType: "multipart/alternative", parts: [
          { mimeType: "text/plain", body: { data: b64url(NESTED_BODY) } },
          { mimeType: "text/html", body: { data: b64url("<p>html twin</p>") } },
        ] },
      ],
    };
  }
  if (m.html) return { headers, mimeType: "text/html", body: { data: b64url(m.html) } };
  return { headers, mimeType: "text/plain", body: { data: b64url(m.plain || "") } };
}

// Gmail's q is "after:Y/M/D before:Y/M/D"; the fake honours it the same way Gmail
// does — inclusive of `after`, exclusive of `before` — so a gap in the sweep's
// windows shows up here as a missing message.
function matches(q: string, m: FakeMsg): boolean {
  const g = (k: string) => {
    const hit = new RegExp(`${k}:(\\d{4})/(\\d{1,2})/(\\d{1,2})`).exec(q);
    return hit ? Date.UTC(+hit[1], +hit[2] - 1, +hit[3]) : null;
  };
  const after = g("after"), before = g("before");
  const t = m.date.getTime();
  if (after !== null && t < after) return false;
  if (before !== null && t >= before) return false;
  return true;
}

let rateLimitOnce = true;
let listCalls = 0, threadCalls = 0, tokenCalls = 0;

function start(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://localhost");
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };

      if (url.pathname === "/token") { tokenCalls++; send(200, { access_token: "fake-token", expires_in: 3600 }); return; }

      if (url.pathname === "/profile") { send(200, { emailAddress: "bookings@spartancrew.co.uk", messagesTotal: MESSAGES.length, threadsTotal: 3 }); return; }

      if (url.pathname === "/messages") {
        listCalls++;
        // One 403 rateLimitExceeded, once: the sweep must back off and retry rather
        // than lose the month.
        if (rateLimitOnce) {
          rateLimitOnce = false;
          send(403, { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }], message: "User-rate limit exceeded" } });
          return;
        }
        const q = url.searchParams.get("q") || "";
        const hits = MESSAGES.filter((m) => matches(q, m));
        // Page one at a time regardless of maxResults, so the paging loop is exercised.
        const cursor = Number(url.searchParams.get("pageToken") || "0");
        const slice = hits.slice(cursor, cursor + 1);
        const next = cursor + 1 < hits.length ? String(cursor + 1) : undefined;
        send(200, { messages: slice.map((m) => ({ id: m.id, threadId: m.threadId })), ...(next ? { nextPageToken: next } : {}) });
        return;
      }

      const thread = /^\/threads\/([^/]+)$/.exec(url.pathname);
      if (thread) {
        threadCalls++;
        const id = thread[1];
        const msgs = MESSAGES.filter((m) => m.threadId === id);
        if (!msgs.length) { send(404, { error: "no such thread" }); return; }
        send(200, {
          id,
          messages: msgs.map((m) => ({ id: m.id, threadId: m.threadId, internalDate: String(m.date.getTime()), snippet: "snip", payload: payloadFor(m) })),
        });
        return;
      }

      send(404, { error: `unexpected path ${url.pathname}` });
    });
    server.listen(0, () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

// ---------------------------------------------------------------- run the sweep
let base = "";

// Must be async, not spawnSync: the stand-in Gmail runs in THIS process, so blocking
// the event loop would leave the child's fetches unanswered and both sides waiting.
function runSweep(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // tsx's CLI directly rather than through `npx` + a shell: no shell quoting, and
    // no deprecation warning for passing args with shell: true.
    const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [tsxCli, join("scripts", "sweep-gmail.ts"), ...args], {
      env: {
        ...process.env,
        GMAIL_API_BASE: base,
        GMAIL_TOKEN_URL: `${base}/token`,
        GOOGLE_CLIENT_ID: "fake-id",
        GOOGLE_CLIENT_SECRET: "fake-secret",
        GMAIL_REFRESH_TOKEN: "fake-refresh",
        // No DATABASE_URL override: --dry never writes, and that is all this runs.
      },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => { child.kill(); reject(new Error("sweep did not finish within 120s")); }, 120_000);
    child.on("error", reject);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status: status ?? -1, stdout, stderr }); });
  });
}

async function main() {
const { server, port } = await start();
base = `http://localhost:${port}`;

console.log("\n[1] dry sweep of 3 months against the stand-in mailbox");
const dry = await runSweep(["--months", "3", "--dry"]);
const out = `${dry.stdout}${dry.stderr}`;
if (dry.status !== 0) console.log(out.slice(-1500));
ok("exits 0", dry.status === 0, `status=${dry.status}`);
ok("identified the mailbox", /bookings@spartancrew\.co\.uk/.test(out));
ok("said it was a dry run", /DRY RUN/.test(out));
ok("stored nothing", !/APPLY/.test(out));

console.log("\n[2] every message in the window was found — no gap between month windows");
// t1 (2d), t3 (28d + 35d) fall inside 3 months; t2 (40d) may or may not, depending on
// where today sits in the month, so the floor is the three certain threads.
const distinct = /(\d+) distinct thread\(s\)/.exec(out);
const found = distinct ? Number(distinct[1]) : -1;
ok("found threads in range", found >= 3, `${found} distinct thread(s)`);
ok("paged past the first result", listCalls > 3, `${listCalls} list call(s)`);

console.log("\n[3] a 403 rateLimitExceeded was retried, not fatal");
ok("the rate-limited call was served on retry", rateLimitOnce === false && dry.status === 0);

console.log("\n[4] the sample decoded real bodies");
ok("subject came through", /Crew for Saturday|Straddles a month|Load-in help/.test(out));
ok("a client message was distinguished from Spartan's own", /from clients/.test(out));

console.log("\n[5] nested MIME and HTML-only bodies decode");
// bodyOf() is not exported, so exercise it the way the sweep does: fetch the thread
// through the same fake and decode with the identical logic the script uses.
const t2 = await fetch(`${base}/threads/t2`, { headers: { Authorization: "Bearer fake" } }).then((r) => r.json());
const t3 = await fetch(`${base}/threads/t3`, { headers: { Authorization: "Bearer fake" } }).then((r) => r.json());
const decode = (d: unknown) => Buffer.from(String(d).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function bodyOf(part: any): string {
  if (!part) return "";
  if (Array.isArray(part.parts)) {
    const plain = part.parts.find((p: any) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decode(plain.body.data);
    const html = part.parts.find((p: any) => p.mimeType === "text/html");
    if (html?.body?.data) return decode(html.body.data);
    for (const p of part.parts) { const n = bodyOf(p); if (n) return n; }
  }
  if (part.body?.data) return decode(part.body.data);
  return "";
}
const nested = bodyOf(t2.messages[0].payload);
ok("recursed past an attachment into multipart/alternative", nested === NESTED_BODY, JSON.stringify(nested.slice(0, 40)));
const htmlMsg = t3.messages.find((m: any) => m.id === "m5");
ok("an HTML-only message still yields text", bodyOf(htmlMsg.payload).includes("Second"));

console.log("\n[6] month boundaries are not a seam — the sweep found the edge mail");
// The sweep prints a running distinct-thread count, but not which threads, so the
// boundary threads are checked by what it actually fetched: every thread in range is
// listed, and each boundary message sits in its own thread, so the total has to
// account for all of them.
const inRange = MESSAGES.filter((m) => m.date.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
const expected = new Set(inRange.map((m) => m.threadId)).size;
ok("every thread inside the 3-month window was found", found === expected, `found ${found}, expected ${expected}`);
ok("boundary threads were part of it", BOUNDARY.length > 0 && expected > 3, `${BOUNDARY.length} boundary message(s)`);

// Wait for the listener to actually close before exiting: process.exit() mid-close
// trips a libuv assertion on Windows and makes a passing run look like a crash.
await new Promise<void>((r) => server.close(() => r()));
console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} passed)\n`);
// exitCode, not process.exit(): tsx's esbuild service is still shutting down, and
// exiting out from under it aborts the process after a clean pass.
process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
