// ============================================================================
// The TV's tick records who looked, and nothing else.
// ----------------------------------------------------------------------------
// It writes only feed_marks rows with mark 'checked', undoing it removes only the tick
// (never a staff edit the verifier found), and a reply cannot be ticked.
// Run: npx tsx test/feedCheck.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { applyCheck, type CheckStore, type Press } from "../app/lib/feed/check";
import { project, type FeedMark } from "../app/lib/feed/project";
import type { ConversationState } from "../app/lib/onsinch/types";
import { fromStates } from "./fixtures/stateSource";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NOW = Date.parse("2026-10-03T12:00:00Z");
// A need, though a tick closes a check on an engine write the same way.
const KEY = "needs-updated:c:901:0";
const state = {
  thread_id: "c", subject: "s", participants: [], last_message_id: "m", last_processed_epoch: NOW,
  classification: "update", facts: { requests: [] }, desired_order: null, priority: "medium", status: "error", notes: [],
  onsinch_order_id: 901, order_action_log: [],
} as unknown as ConversationState;

/** An in-memory feed_marks with the same (item_key, mark) key and the same insert-once rule. */
function memStore() {
  const rows = new Map<string, FeedMark>();
  const calls: string[] = [];
  const presses: Press[] = [];
  const store: CheckStore = {
    async logPress(p) { presses.push(p); },
    async addMark(m) { calls.push(`add:${m.mark}`); const k = `${m.item_key}|${m.mark}`; if (!rows.has(k)) rows.set(k, { ...m, at: NOW }); },
    async removeCheck(item_key) { calls.push("remove:checked"); rows.delete(`${item_key}|checked`); rows.delete(`${item_key}|denied`); },
  };
  return { rows, calls, store, presses };
}

void (async () => {
  console.log("\n[1] a tick records who, and only as a tick");
  {
    const s = memStore();
    const r = await applyCheck({ item_key: KEY, thread_id: "c", checked: true }, "kate@spartancrew.co.uk", s.store);
    ok(r.status === 200, "accepted");
    const row = [...s.rows.values()][0];
    ok(s.rows.size === 1 && row.mark === "checked" && row.by === "kate@spartancrew.co.uk", "one 'checked' row, by the signed-in person");
    ok(project(new Map(), [...s.rows.values()], null, NOW, new Map(), [...fromStates([state], new Map(), NOW)]).cards[0]?.green === true, "and the card is green");
  }

  console.log("\n[1a] the X (Ben, 18 Nov): a person's no clears the card too, and a changed mind never leaves both");
  {
    const s = memStore();
    await applyCheck({ item_key: KEY, thread_id: "c", checked: true, denied: true }, "kate@spartancrew.co.uk", s.store);
    ok(s.rows.size === 1 && [...s.rows.values()][0].mark === "denied", "one 'denied' row");
    ok(project(new Map(), [...s.rows.values()], null, NOW, new Map(), [...fromStates([state], new Map(), NOW)]).cards[0]?.green === true, "and the card is cleared");
    await applyCheck({ item_key: KEY, thread_id: "c", checked: true }, "kate@spartancrew.co.uk", s.store);
    ok(s.rows.size === 1 && [...s.rows.values()][0].mark === "checked", "pressing the check after the X leaves only the check");
    await applyCheck({ item_key: KEY, thread_id: "c", checked: false }, "kate@spartancrew.co.uk", s.store);
    ok(s.rows.size === 0, "undo leaves neither");
    ok((await applyCheck({ item_key: KEY, thread_id: "c", checked: true, denied: "yes" }, "k", s.store)).status === 400, "denied must be a boolean when given");
  }

  console.log("\n[1b] the tick carries the signer's display name; the email stays the audit identity");
  {
    const s = memStore();
    await applyCheck({ item_key: KEY, thread_id: "c", checked: true }, "benjamintmikus@gmail.com", s.store, "Ben Mikus");
    const row = [...s.rows.values()][0];
    ok(row.by === "benjamintmikus@gmail.com" && (row.evidence as { name?: string })?.name === "Ben Mikus", "by is the email, evidence.name the display name");
    const route = readFileSync("app/api/feed/check/route.ts", "utf8");
    ok(/caller\.name/.test(route), "the route passes the session's name");
  }

  console.log("\n[2] undo removes the tick and leaves the verifier's evidence");
  {
    const s = memStore();
    await s.store.addMark({ item_key: KEY, thread_id: "c", mark: "staff-edit", by: null, evidence: { text: "crew 2 → 1" } });
    await applyCheck({ item_key: KEY, thread_id: "c", checked: true }, "kate", s.store);
    await applyCheck({ item_key: KEY, thread_id: "c", checked: false }, "kate", s.store);
    ok(s.rows.size === 1 && [...s.rows.values()][0].mark === "staff-edit", "the staff edit survives the undo");
    const t = memStore();
    await applyCheck({ item_key: KEY, thread_id: "c", checked: true }, "kate", t.store);
    await applyCheck({ item_key: KEY, thread_id: "c", checked: false }, "kate", t.store);
    ok(t.rows.size === 0 && project(new Map(), [], null, NOW, new Map(), [...fromStates([state], new Map(), NOW)]).cards[0]?.green === false, "a tick alone, undone, leaves the card open");
  }

  console.log("\n[3] what it refuses");
  {
    const s = memStore();
    const reply = await applyCheck({ item_key: "reply:c:2026-10-01T09:00:00Z", thread_id: "c", checked: true }, "kate", s.store);
    ok(reply.status === 400, "a reply cannot be ticked");
    ok((await applyCheck({ item_key: KEY, thread_id: "c" }, "kate", s.store)).status === 400, "checked must be said, not assumed");
    ok((await applyCheck(null, "kate", s.store)).status === 400, "no body");
    ok(s.calls.length === 0, "and nothing was written for any of them");
  }

  console.log("\n[4] the route authorises before it reads the body, and touches only the tick");
  {
    const src = readFileSync("app/api/feed/check/route.ts", "utf8");
    const post = src.slice(src.indexOf("export async function POST"));
    ok(post.indexOf("authorizeAction") >= 0 && post.indexOf("authorizeAction") < post.indexOf("request.json"), "authorizeAction first");
    ok(/status: 401/.test(post), "refuses with 401");
    ok(/import \{ addMark, logPress, removeCheck \} from "..\/..\/..\/lib\/feed\/marksDb"/.test(src) && !/conversation_state|onsinch|gmail/i.test(src), "imports only the tick's two writes and the press log");
    const db = readFileSync("app/lib/feed/marksDb.ts", "utf8");
    ok(/DELETE FROM feed_marks WHERE item_key = \$\{item_key\} AND mark IN \('checked', 'denied'\)/.test(db) && (db.match(/DELETE FROM/g) ?? []).length === 1, "the only delete is of a person's check or X");
  }

  console.log("\n[P] every press is logged for learning, undo included, with the card as it was (Ben, 20 Nov)");
  {
    const s2 = memStore();
    const card = { kind: "needs-updated", label: "Order Needs Updated", ask: "Add 6 crew on Tue 24 and Fri 27 Nov.", check: null, pen: "todo" };
    await applyCheck({ item_key: KEY, thread_id: "c", checked: true, card }, "kate@spartancrew.co.uk", s2.store);
    await applyCheck({ item_key: KEY, thread_id: "c", checked: false, card }, "kate@spartancrew.co.uk", s2.store);
    await applyCheck({ item_key: KEY, thread_id: "c", checked: true, denied: true, card }, "jenny@spartancrew.co.uk", s2.store);
    ok(s2.presses.map((p) => p.press).join() === "confirm,undo,false_flag", "confirm, undo and false flag are each logged, in order", s2.presses.map((p) => p.press).join());
    ok(s2.presses.every((p) => p.item_key === KEY && p.card?.ask === card.ask) && s2.presses[2].by === "jenny@spartancrew.co.uk", "each with the card as it was and who pressed it");
    ok([...s2.rows.values()].map((m) => m.mark).join() === "denied", "the marks still hold only the current state: the log is beside them, not instead");
    const big = await applyCheck({ item_key: KEY, thread_id: "c", checked: true, card: { ask: "x".repeat(5000) } }, "kate@spartancrew.co.uk", s2.store);
    ok(big.status === 200 && s2.presses[3].card === null, "an oversized card is dropped from the log, never the press");
    const failing = memStore(); failing.store.logPress = async () => { throw new Error("log down"); };
    const r = await applyCheck({ item_key: KEY, thread_id: "c", checked: true }, "kate@spartancrew.co.uk", failing.store);
    ok(r.status === 200 && [...failing.rows.values()].some((m) => m.mark === "checked"), "a failed log never blocks the press");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
