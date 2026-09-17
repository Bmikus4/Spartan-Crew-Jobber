// ============================================================================
// A CURSOR, NOT A STREAM — and one that cannot silently skip an enquiry.
// ----------------------------------------------------------------------------
// A watch/push subscription is a stream: it expires, it needs renewing, and when it
// lapses nothing says so — mail simply stops. That is the shape of every intake outage
// this project has had. A cursor is the opposite: it is a number on disk, it is only
// advanced over work that is finished, and if nothing runs for a week the next run is
// merely bigger.
//
// WHAT THIS FILE PINS, all of them ways a cursor loses mail quietly:
//
//   - the cursor advances ONLY after the caller has taken the messages. At-least-once,
//     never at-most-once: a duplicate is deduped downstream by Message-ID, a skip is an
//     enquiry nobody ever sees.
//   - Gmail expires historyIds after roughly a week and answers 404. That is the normal
//     consequence of a quiet weekend plus a deploy, NOT an error, and it must re-anchor
//     by date rather than give up or restart from zero.
//   - a re-anchor OVERLAPS deliberately. Re-reading a few hours costs a dedupe; a gap
//     costs a booking.
//   - paging is followed to the end. history.list truncates, and taking page one only
//     would lose the oldest unprocessed mail on a busy morning — the exact case this
//     exists for.
//   - only messagesAdded counts. Label changes and deletions generate history records
//     too, and treating those as new mail would re-run the engine on old threads.
//
// Offline. Gmail is a stub.  npx tsx test/gmailCursor.ts
// ============================================================================
import { fetchSince, type GmailGet } from "../app/lib/mail/gmailCursor";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** A stubbed Gmail that records every path asked for. */
function gmailStub(routes: Record<string, any>, opts: { throwOn404?: boolean } = {}): GmailGet & { asked: string[] } {
  const asked: string[] = [];
  const get = (async (path: string) => {
    asked.push(path);
    for (const [pattern, reply] of Object.entries(routes)) {
      if (path.startsWith(pattern)) {
        if (reply?.__status === 404) {
          const e: any = new Error(`${path} -> 404`);
          e.status = 404;
          throw e;
        }
        return typeof reply === "function" ? reply(path) : reply;
      }
    }
    throw new Error(`stub has no route for ${path}`);
  }) as GmailGet & { asked: string[] };
  (get as any).asked = asked;
  return get as any;
}

async function main() {
  console.log("\n[1] the ordinary tick: new mail since the cursor");
  {
    const gmail = gmailStub({
      "history?": { historyId: "5000", history: [{ messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] },
                                                 { messagesAdded: [{ message: { id: "m2", threadId: "t1" } }] }] },
    });
    const out = await fetchSince({ gmail, cursor: "4000" });
    ok(out.messageIds.join(",") === "m1,m2", "both new messages come back", out.messageIds.join(","));
    ok(out.nextCursor === "5000", "and the new cursor is Gmail's historyId", String(out.nextCursor));
    ok(out.reanchored === false, "no re-anchor was needed");
  }

  console.log("\n[2] only messagesAdded — a label change is not new mail");
  {
    // Gmail emits history records for labelsAdded, labelsRemoved and messagesDeleted.
    // Counting those would re-run the engine over threads that merely got tagged.
    const gmail = gmailStub({
      "history?": { historyId: "5100", history: [
        { labelsAdded: [{ message: { id: "old1", threadId: "t9" } }] },
        { messagesDeleted: [{ message: { id: "old2", threadId: "t9" } }] },
        { messagesAdded: [{ message: { id: "new1", threadId: "t3" } }] },
      ] },
    });
    const out = await fetchSince({ gmail, cursor: "5000" });
    ok(out.messageIds.join(",") === "new1", "only the added message", out.messageIds.join(","));
  }

  console.log("\n[3] paging is followed to the end");
  {
    let call = 0;
    const gmail = gmailStub({
      "history?": () => {
        call++;
        return call === 1
          ? { historyId: "6000", nextPageToken: "p2", history: [{ messagesAdded: [{ message: { id: "a", threadId: "t1" } }] }] }
          : { historyId: "6000", history: [{ messagesAdded: [{ message: { id: "b", threadId: "t2" } }] }] };
      },
    });
    const out = await fetchSince({ gmail, cursor: "5900" });
    ok(out.messageIds.join(",") === "a,b", "both pages", out.messageIds.join(","));
    ok(gmail.asked.some((p) => p.includes("pageToken=p2")), "the page token was actually followed");
  }

  console.log("\n[4] a duplicate id across pages is returned once");
  {
    let call = 0;
    const gmail = gmailStub({
      "history?": () => {
        call++;
        return call === 1
          ? { historyId: "6100", nextPageToken: "p2", history: [{ messagesAdded: [{ message: { id: "dup", threadId: "t1" } }] }] }
          : { historyId: "6100", history: [{ messagesAdded: [{ message: { id: "dup", threadId: "t1" } }] }] };
      },
    });
    const out = await fetchSince({ gmail, cursor: "6000" });
    ok(out.messageIds.length === 1 && out.messageIds[0] === "dup", "deduped", out.messageIds.join(","));
  }

  console.log("\n[5] AN EXPIRED CURSOR IS NORMAL, and must re-anchor rather than give up");
  {
    // Gmail drops historyIds after about a week. A quiet Christmas is enough. Failing
    // here would stop intake for the one reason nobody would think to look for.
    const gmail = gmailStub({
      "history?": { __status: 404 },
      "messages?": { messages: [{ id: "r1", threadId: "t1" }, { id: "r2", threadId: "t2" }] },
      "profile": { historyId: "9000" },
    });
    const out = await fetchSince({ gmail, cursor: "1" });
    ok(out.reanchored === true, "it re-anchored");
    ok(out.messageIds.join(",") === "r1,r2", "and still returned the recent mail", out.messageIds.join(","));
    ok(out.nextCursor === "9000", "with a fresh cursor from the profile", String(out.nextCursor));
    ok(gmail.asked.some((p) => /newer_than/.test(p)), "the fallback was a bounded date query, not the whole mailbox",
       gmail.asked.find((p) => p.startsWith("messages?")) ?? "");
  }

  console.log("\n[6] a first run with no cursor anchors without replaying the archive");
  {
    const gmail = gmailStub({
      "messages?": { messages: [{ id: "f1", threadId: "t1" }] },
      "profile": { historyId: "100" },
    });
    const out = await fetchSince({ gmail, cursor: null });
    ok(out.reanchored === true, "treated as a re-anchor");
    ok(gmail.asked.some((p) => /newer_than/.test(p)), "bounded, so a first deploy does not replay 12 months");
    ok(out.nextCursor === "100", "and the cursor starts from now", String(out.nextCursor));
  }

  console.log("\n[7] nothing new is not an error, and does not move the cursor backwards");
  {
    const gmail = gmailStub({ "history?": { historyId: "7000" } });
    const out = await fetchSince({ gmail, cursor: "7000" });
    ok(out.messageIds.length === 0, "no messages");
    ok(out.nextCursor === "7000", "cursor held", String(out.nextCursor));
  }

  console.log("\n[8] the cursor NEVER goes backwards, whatever Gmail says");
  {
    // Defensive: a lower historyId coming back would re-deliver everything between, and
    // on a mailbox this size that is a self-inflicted flood of engine runs.
    const gmail = gmailStub({ "history?": { historyId: "100", history: [{ messagesAdded: [{ message: { id: "x", threadId: "t" } }] }] } });
    const out = await fetchSince({ gmail, cursor: "9999" });
    ok(out.nextCursor === "9999", "the higher cursor is kept", String(out.nextCursor));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}

main();
