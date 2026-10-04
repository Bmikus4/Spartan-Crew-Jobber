// ============================================================================
// The TV's tick records who looked, and nothing else.
// ----------------------------------------------------------------------------
// It writes only feed_marks rows with mark 'checked', undoing it removes only the tick
// (never a staff edit the verifier found), and a reply cannot be ticked.
// Run: npx tsx test/feedCheck.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { applyCheck, type CheckStore } from "../app/lib/feed/check";
import { project, type FeedMark } from "../app/lib/feed/project";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NOW = Date.parse("2026-10-03T12:00:00Z");
// A need: what the engine made is green already, so only a need shows what a tick does.
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
  const store: CheckStore = {
    async addMark(m) { calls.push(`add:${m.mark}`); const k = `${m.item_key}|${m.mark}`; if (!rows.has(k)) rows.set(k, { ...m, at: NOW }); },
    async removeCheck(item_key) { calls.push("remove:checked"); rows.delete(`${item_key}|checked`); },
  };
  return { rows, calls, store };
}

void (async () => {
  console.log("\n[1] a tick records who, and only as a tick");
  {
    const s = memStore();
    const r = await applyCheck({ item_key: KEY, thread_id: "c", checked: true }, "kate@spartancrew.co.uk", s.store);
    ok(r.status === 200, "accepted");
    const row = [...s.rows.values()][0];
    ok(s.rows.size === 1 && row.mark === "checked" && row.by === "kate@spartancrew.co.uk", "one 'checked' row, by the signed-in person");
    ok(project([state], new Map(), [...s.rows.values()], null, NOW).cards[0]?.green === true, "and the card is green");
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
    ok(t.rows.size === 0 && project([state], new Map(), [], null, NOW).cards[0]?.green === false, "a tick alone, undone, leaves the card open");
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
    ok(/import \{ addMark, removeCheck \} from "..\/..\/..\/lib\/feed\/marksDb"/.test(src) && !/conversation_state|onsinch|gmail/i.test(src), "imports only the tick's two writes");
    const db = readFileSync("app/lib/feed/marksDb.ts", "utf8");
    ok(/DELETE FROM feed_marks WHERE item_key = \$\{item_key\} AND mark = 'checked'/.test(db), "the only delete is of a tick");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
