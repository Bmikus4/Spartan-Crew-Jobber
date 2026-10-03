// ============================================================================
// The live feed reads. It never changes how an order is processed.
// ----------------------------------------------------------------------------
// The office TV may write exactly one thing: its own records in feed_marks / feed_meta.
// It must never write OnSinch (those writes are real), never Gmail, and never
// conversation_state. [1] runs the feed and its verifier end to end against a fake
// OnSinch and counts the calls; [2] reads every feed source for a write it could make.
// Run: npx tsx test/feedReadsOnly.ts
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { serveFeed } from "../app/lib/feed/serve";
import { verify, __resetVerifyCache } from "../app/lib/feed/verify";
import type { Transport } from "../app/lib/engine/onsinch";
import type { ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const NOW = Date.parse("2026-10-05T12:00:00Z");
const H = 3_600_000;
const base = { subject: "s", participants: [], last_message_id: "m", last_processed_epoch: NOW, facts: { requests: [{ date: "2026-10-16" }] }, desired_order: null, priority: "medium", notes: [] };
const states = [
  { ...base, thread_id: "a", classification: "new-job", status: "ordered", onsinch_order_id: 16345, onsinch_order_number: "11312", onsinch_job_id: 13925, order_action_log: [{ ts: NOW - 5 * H, kind: "create", order_id: 16345, ok: true }] },
  { ...base, thread_id: "b", classification: "update", status: "error", onsinch_order_id: 16400, onsinch_order_number: "11400", order_action_log: [] },
  { ...base, thread_id: "n", classification: "new-job", status: "needs-info", company_id: 77, order_action_log: [] },
] as unknown as ConversationState[];

void (async () => {
  console.log("\n[1] a full refresh with verification makes GETs and nothing else");
  {
    __resetVerifyCache();
    const calls: string[] = [];
    const t: Transport = async (method, path) => {
      calls.push(method);
      if (path === "/users/profile") return { status: 200, data: { data: { id: 2257 } } };
      if (path.startsWith("/timelineAudits")) return { status: 200, data: { pagination: { pageCount: 1 }, data: [
        { id: 1, action: "common_change", creator: 1164, created: new Date(NOW - H).toISOString(), data: JSON.stringify({ id: "9", model: "Slot", diffChanges: { Slot: { size: { old: 2, new: 1 } } } }) },
      ] } };
      if (path.startsWith("/orders?id")) return { status: 200, data: { data: [{ id: 16345, Job: [{ id: 13925, SlotTeam: [{ id: 5, Slot: [{ id: 9 }] }] }] }] } };
      if (path.startsWith("/orders?company_id")) return { status: 200, data: { data: [{ id: 1, number: "11081", happening: "2026-10-16T08:00:00+01:00" }] } };
      return { status: 200, data: {} };
    };
    const own: string[] = [];
    const r = await serveFeed({
      states: async () => states,
      inbound: async () => ({ byThread: new Map(), latest: NOW }),
      marks: async () => [],
      replies: null,
      verify: (cards, now) => verify(cards, now, {
        transport: t,
        claim: async () => ({ timeline_last_id: null }),
        save: async () => { own.push("feed_meta"); },
        addMark: async () => { own.push("feed_marks"); },
      }),
    }, NOW);
    ok(r.status === 200, "served");
    ok(calls.length > 3, `the verifier did read OnSinch (${calls.length} calls)`);
    ok(calls.every((m) => m === "GET"), "every OnSinch call was a GET", [...new Set(calls)].join(","));
    ok(own.includes("feed_marks") && own.every((w) => w === "feed_marks" || w === "feed_meta"), "its only writes were its own records", own.join(","));
  }

  console.log("\n[2] no feed source can write anything of the engine's");
  {
    const files: string[] = [];
    for (const dir of ["app/lib/feed", "app/api/feed"]) (function walk(d: string) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(e)) files.push(p); } })(dir);
    files.push("app/components/LiveFeedScreen.tsx");
    ok(files.length >= 9, `${files.length} files read`, files.join(" "));
    for (const f of files) {
      let src = "";
      try { src = readFileSync(f, "utf8"); } catch { ok(false, `${f} exists`); continue; }
      // Code only: a comment explaining why the feed does NOT call flagBuiltIfNeeded is not a call.
      src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const sqlWrites = [...src.matchAll(/\b(?:INSERT\s+INTO|DELETE\s+FROM)\s+(\w+)|\bUPDATE\s+(\w+)\s+SET\b/gi)].map((m) => m[1] ?? m[2]).filter((t) => !/^(feed_marks|feed_meta)$/i.test(t));
      ok(sqlWrites.length === 0, `${f}: SQL writes only feed_marks/feed_meta`, sqlWrites.join(","));
      ok(!/stateDb|NeonStateStore|\.put\(|gmailWrite|lib\/deps|executor\(|flag(Manual|Built|Updated)IfNeeded/.test(src), `${f}: no state store, Gmail writer or engine executor`);
      ok(!/["'](POST|PATCH|PUT|DELETE)["']\s*,\s*["']\//.test(src), `${f}: no OnSinch write verb`);
      ok(!/new OnsinchClient\(\s*httpTransport/.test(src), `${f}: never a client over the raw transport`);
    }
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exitCode = fails ? 1 : 0;
})();
