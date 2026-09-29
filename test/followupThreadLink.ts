// ============================================================================
// A follow-up's "Open email thread" button must open the email thread.
// ----------------------------------------------------------------------------
// Ben's spec, in his words: "Do not show a working-looking thread button with a
// guessed or invalid destination." That is the whole of this file.
//
// Two kinds of thread id live in this database and only one of them is a Gmail id.
// The sweep stores Gmail's own — sixteen hex characters, which #all/<id> opens. The
// webhook intake mints ids from RFC headers for mail that never came through Gmail,
// and dropping one of those into the same URL produces a link that looks live, loads,
// and shows an empty mailbox. A button that fails silently is worse than a button
// that says what it is going to do.
//
// So the id is CHECKED rather than assumed, and anything that fails the check is
// relabelled — not hidden. Measured 2026-09-29: of the 63 alerts the board produced
// at the pause, 63 carried real Gmail ids, so the fallback is rare. Rare is exactly
// when a wrong link does the most damage, because nobody is expecting one.
//
// Offline. No network, no database.  npx tsx test/followupThreadLink.ts
// ============================================================================
import { threadLink } from "../app/lib/followup/board";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

console.log("\n[1] a real Gmail thread id opens the thread");
{
  const l = threadLink("1a0b578579aa58fb", "Crew for 180 Studios");
  ok(l.thread_url === "https://mail.google.com/mail/u/0/#all/1a0b578579aa58fb",
    "the id goes straight into #all/", String(l.thread_url));
  ok(l.link_label === "Open email thread", "and the button says so", l.link_label);
}

console.log("\n[2] the gmail: prefix is ours, not Gmail's");
{
  /**
   * gmailWrite.bareThreadId strips this for the same reason: Gmail has never heard of
   * the prefix, and sending it addresses a thread that does not exist — a 404 that
   * reads like a deleted conversation rather than a string bug.
   */
  const l = threadLink("gmail:1a0b578579aa58fb", "Crew for 180 Studios");
  ok(l.thread_url === "https://mail.google.com/mail/u/0/#all/1a0b578579aa58fb",
    "stripped before the URL is built", String(l.thread_url));
}

console.log("\n[3] anything that is not a Gmail id gets no thread link at all");
{
  for (const id of [
    "CAHk=abc123@mail.gmail.com",          // an RFC Message-ID
    "19fb8b3d094fa9a",                     // 15 chars, one short
    "1a0b578579aa58fbc",                   // 17 chars, one long
    "1a0b578579aa58fg",                    // 16 chars but 'g' is not hex
    "",                                    // nothing at all
  ]) {
    const l = threadLink(id, "Crew for 180 Studios");
    ok(l.thread_url === null, `no guessed URL for ${JSON.stringify(id)}`, String(l.thread_url));
  }
}

console.log("\n[4] the fallback is labelled for what it actually does");
{
  const l = threadLink("CAHk=abc123@mail.gmail.com", "Crew for 180 Studios");
  ok(l.link_label === "Search inbox for this subject",
    "it does not claim to open the thread", l.link_label);
  ok(l.fallback_url.startsWith("https://mail.google.com/mail/u/0/#search/"),
    "and it is a real search URL", l.fallback_url);
  ok(l.fallback_url.includes(encodeURIComponent("Crew for 180 Studios")),
    "carrying the subject, encoded");
}

console.log("\n[5] a subject that would break a URL does not");
{
  const l = threadLink("nope", "R11143 | Icon Events @ 50% #crew & van");
  ok(!/[ #|@&]/.test(l.fallback_url.split("#search/")[1] ?? ""),
    "every reserved character is encoded", l.fallback_url);
  const empty = threadLink("nope", "");
  ok(empty.fallback_url.includes("nope"),
    "and with no subject it searches the id rather than nothing", empty.fallback_url);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
