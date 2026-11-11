// ============================================================================
// The promotion ladder's stage-1 apparatus (DECISIONS O34, decisions/2026-11-11-bot-write-promotion-ladder.md):
// per-class enable flags with a daily cap, the gate inside runOp that no caller can route around, and the
// minute sync's three auto-rollback checks (a mismatch ledger row, a staff reversal within 72h, a write-path
// error report). Re-entry after a rollback is a person's, never the code's.
// npx tsx --require ./test/fixtures/pg.ts test/botLadder.ts
// ============================================================================
import { sql, fault } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { getSettings, saveSettings, coerceSettings } from "../app/lib/settingsDb";
import { ladderGate, ladderCheck } from "../app/lib/v2/bot/ladder";
import { runOp } from "../app/lib/v2/bot/run";
import { ledgerIntent, ledgerSet } from "../app/lib/v2/bot/db";
import { opKey, BOT_USER, type Op } from "../app/lib/v2/bot/ops";
import { handleSettingsPost, SWITCHES, type SettingsIO } from "../app/lib/routes/settings";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const LADDER = /enabled write class|promotion ladder/;
const noClasses = () => saveSettings({ bot_write_classes: {} });
const enable = (kinds: Record<string, { since: string; cap: number | null }>) => saveSettings({ bot_write_classes: kinds });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
let seq = 9_000_000;
const timelineRow = async (r: { creator: number | null; created: string; model: string; model_id: string; field: string; old: unknown; nu: unknown }) => {
  await sql`INSERT INTO onsinch_timeline (id, action, creator, created, model, model_id, data) VALUES (
    ${++seq}, 'common_change', ${r.creator}, ${r.created}, ${r.model}, ${r.model_id},
    ${JSON.stringify({ model: r.model, id: r.model_id, diffChanges: { [r.model]: { [r.field]: { old: r.old, new: r.nu }, modified: { old: "x", new: "y" } } } })}::jsonb)`;
};
type Report = { route: string; where: string; what: string };
const recordReports = () => { const got: Report[] = []; return { got, report: (a: Report) => { got.push(a); return Promise.resolve(false); } }; };

(async () => {
  await ensureSchema(sql as any);
  process.env.ONSINCH_BASE_URL = "http://127.0.0.1:9"; // every real HTTP step fails fast: nothing here may reach a network

  console.log("\n[1] ladderGate: a class is off until the ladder names it, and off when the ladder cannot be read");
  {
    await noClasses();
    const stop = await ladderGate("set_position_size", sql as any);
    ok(stop.length === 1 && LADDER.test(stop[0]), "no classes enabled: refused, naming the ladder", stop);
    await enable({ set_position_size: { since: hoursAgo(1), cap: 2 } });
    ok((await ladderGate("set_position_size", sql as any)).length === 0, "the enabled class passes (the control)");
    ok((await ladderGate("set_position_times", sql as any)).some((x) => LADDER.test(x)), "another class stays refused");
    fault.when = (t) => /app_settings/.test(t);
    const closed = await ladderGate("set_position_size", sql as any);
    fault.when = null;
    ok(closed.length > 0, "a settings read that fails is OFF, never open", closed);
  }

  console.log("\n[2] ladderGate: the daily cap counts only live ops, and null is uncapped");
  {
    await enable({ set_position_size: { since: hoursAgo(1), cap: 2 } });
    const live = async (n: number, status = "verified") => {
      const op: Op = { kind: "set_position_size", order_id: 80_000 + n, slot_id: n, size: 3 };
      const k = opKey(`cap${n}`, op);
      await ledgerIntent(k, `cap${n}`, op.kind, op);
      await ledgerSet(k, status as never, { live: true });
    };
    await live(1); await live(2, "blocked");
    ok((await ladderGate("set_position_size", sql as any)).length === 0, "1 live write today, cap 2: allowed");
    await live(3);
    const capped = await ladderGate("set_position_size", sql as any);
    ok(capped.length === 1 && /cap/.test(capped[0]), "2 live writes today: the cap refuses the third", capped);
    // Bench rows carry no live mark and never count.
    const bench: Op = { kind: "set_position_size", order_id: 80_010, slot_id: 10, size: 3 };
    await ledgerIntent(opKey("capb", bench), "capb", bench.kind, bench);
    await enable({ set_position_size: { since: hoursAgo(1), cap: null } });
    ok((await ladderGate("set_position_size", sql as any)).length === 0, "cap null is uncapped (stage 2)");
  }

  console.log("\n[3] runOp: the gate sits inside the op runner, so no caller can route around it");
  {
    await noClasses();
    const op: Op = { kind: "set_position_size", order_id: 81_001, slot_id: 11, size: 4 };
    const r = await runOp("ladder3a", op, { testOnly: false });
    ok(r.status === "blocked" && LADDER.test(r.reasons.join(" ")), "a live write of a class the ladder has not enabled is blocked, before any network", r);
    const row = (await sql`SELECT status, detail FROM bot_ledger WHERE op_key = ${opKey("ladder3a", op)}`) as any[];
    ok(row[0]?.status === "blocked", "and the refusal is on the ledger", row[0]);
    await enable({ set_position_size: { since: hoursAgo(1), cap: null } });
    const r2 = await runOp("ladder3b", { ...op, order_id: 81_002 }, { testOnly: false });
    ok(r2.status === "blocked" && !LADDER.test(r2.reasons.join(" ")), "enabled, the same op passes the gate and fails only at the dead network (the control)", r2);
    const r3 = await runOp("ladder3c", { ...op, order_id: 81_003 }, { testOnly: true });
    ok(!LADDER.test(r3.reasons.join(" ")), "bench mode (TEST 515) is not the ladder's business", r3);
    await noClasses();
  }

  console.log("\n[4] ladderCheck (a): a mismatch ledger row on an enabled class turns that class off");
  {
    const op: Op = { kind: "set_position_size", order_id: 82_001, slot_id: 21, size: 5 };
    const k = opKey("ladder4", op);
    await ledgerIntent(k, "ladder4", op.kind, op);
    await ledgerSet(k, "mismatch", { readback: ["size reads 3"] });
    await enable({ set_position_size: { since: hoursAgo(1), cap: 2 }, set_position_times: { since: hoursAgo(1), cap: 2 } });
    const rr = recordReports();
    const out = await ladderCheck(sql as any, Date.now(), rr.report as never);
    const after = (await getSettings(sql as any)).bot_write_classes ?? {};
    ok(!("set_position_size" in after), "the mismatched class is off", after);
    ok("set_position_times" in after, "the clean class stays on", after);
    ok(out.rollbacks.length === 1 && /mismatch/.test(out.rollbacks[0]), "the sync step says why", out);
    ok(rr.got.some((g) => g.route === "ladder-rollback"), "and the owner is told", rr.got);
    const hist = (await sql`SELECT field, actor FROM settings_history WHERE field = 'bot_write_classes'`) as any[];
    ok(hist.length >= 1 && /ladder/.test(hist[hist.length - 1].actor), "the change is on the settings history with the trigger as actor", hist);
    // A mismatch from BEFORE the class was enabled (the three historical create_order rows) never trips it.
    await enable({ set_position_size: { since: new Date(Date.now() + 3600_000).toISOString(), cap: 2 } });
    const out2 = await ladderCheck(sql as any, Date.now(), rr.report as never);
    ok(("set_position_size" in ((await getSettings(sql as any)).bot_write_classes ?? {})) && out2.rollbacks.length === 0,
      "a mismatch older than the class's enable date is history, not a trigger", out2);
    await sql`DELETE FROM bot_ledger WHERE op_key = ${k}`; // or every later enable in this file trips on it
    await noClasses();
  }

  console.log("\n[5] ladderCheck (b): a staff edit reversing a bot edit on the same record within 72h turns the class off");
  {
    await enable({ set_position_size: { since: hoursAgo(50), cap: 2 } });
    // The bot set size 4 -> 6; staff put it back to 4 an hour later.
    await timelineRow({ creator: BOT_USER, created: hoursAgo(5), model: "Slot", model_id: "7001", field: "size", old: 4, nu: 6 });
    await timelineRow({ creator: 333, created: hoursAgo(4), model: "Slot", model_id: "7001", field: "size", old: 6, nu: 4 });
    const rr = recordReports();
    const out = await ladderCheck(sql as any, Date.now(), rr.report as never);
    ok(!("set_position_size" in ((await getSettings(sql as any)).bot_write_classes ?? {})), "reversed: the class is off");
    ok(out.rollbacks.some((x) => /revers/.test(x)) && rr.got.some((g) => /revers/i.test(g.what)), "named as a reversal", { out, got: rr.got });

    // Counters, each on its own record: a different value is a follow-up edit, not a reversal; a reversal
    // after 72h is the world moving on; another record is unrelated; staff before the bot is no sequence.
    await sql`DELETE FROM onsinch_timeline WHERE model_id = '7001'`; // the real reversal above must not re-trip here
    await enable({ set_position_size: { since: hoursAgo(90), cap: 2 } });
    await timelineRow({ creator: BOT_USER, created: hoursAgo(5), model: "Slot", model_id: "7002", field: "size", old: 4, nu: 6 });
    await timelineRow({ creator: 333, created: hoursAgo(4), model: "Slot", model_id: "7002", field: "size", old: 6, nu: 8 });
    await timelineRow({ creator: BOT_USER, created: hoursAgo(80), model: "Slot", model_id: "7003", field: "size", old: 4, nu: 6 });
    await timelineRow({ creator: 333, created: hoursAgo(2), model: "Slot", model_id: "7003", field: "size", old: 6, nu: 4 });
    await timelineRow({ creator: BOT_USER, created: hoursAgo(5), model: "Slot", model_id: "7004", field: "size", old: 4, nu: 6 });
    await timelineRow({ creator: 333, created: hoursAgo(4), model: "Slot", model_id: "7005", field: "size", old: 6, nu: 4 });
    await timelineRow({ creator: 333, created: hoursAgo(6), model: "Slot", model_id: "7006", field: "size", old: 6, nu: 4 });
    await timelineRow({ creator: BOT_USER, created: hoursAgo(5), model: "Slot", model_id: "7006", field: "size", old: 4, nu: 6 });
    const out2 = await ladderCheck(sql as any, Date.now(), rr.report as never);
    ok(out2.rollbacks.length === 0 && ("set_position_size" in ((await getSettings(sql as any)).bot_write_classes ?? {})),
      "a follow-up edit, an after-72h edit, another record, and staff-before-bot: none is a reversal", out2);
    await noClasses();
  }

  console.log("\n[6] ladderCheck (c): a write-path error report turns EVERY class off");
  {
    await enable({ set_position_size: { since: hoursAgo(1), cap: 2 }, set_position_times: { since: hoursAgo(1), cap: 2 } });
    await sql`INSERT INTO error_reports (fingerprint, where_at, what, last_seen_at) VALUES ('ladder6', 'bot/run', 'set_position_size: sent, outcome unknown', now())`;
    const rr = recordReports();
    const out = await ladderCheck(sql as any, Date.now(), rr.report as never);
    ok(Object.keys((await getSettings(sql as any)).bot_write_classes ?? {}).length === 0, "all classes off");
    ok(out.rollbacks.some((x) => /error report|write-path/.test(x)), "named as the write-path trigger", out);
    await sql`DELETE FROM error_reports WHERE fingerprint = 'ladder6'`;
    // An unrelated report (a label failure) is not the write path.
    await enable({ set_position_size: { since: hoursAgo(1), cap: 2 } });
    await sql`INSERT INTO error_reports (fingerprint, where_at, what, last_seen_at) VALUES ('ladder6b', 'mail/labels', 'labels refused', now())`;
    const out2 = await ladderCheck(sql as any, Date.now(), rr.report as never);
    ok(out2.rollbacks.length === 0, "an unrelated report trips nothing", out2);
    await sql`DELETE FROM error_reports WHERE fingerprint = 'ladder6b'`;
    await noClasses();
  }

  console.log("\n[7] ladderCheck with no classes enabled is a no-op");
  {
    await noClasses();
    const before = (await sql`SELECT count(*)::int AS n FROM settings_history`) as any[];
    const out = await ladderCheck(sql as any, Date.now());
    const after = (await sql`SELECT count(*)::int AS n FROM settings_history`) as any[];
    ok(out.classes === 0 && out.rollbacks.length === 0 && before[0].n === after[0].n, "nothing read as a trip, nothing written", out);
  }

  console.log("\n[8] runOp: an unknown outcome reports itself on the write path, which check (c) then reads");
  {
    await enable({ create_order: { since: hoursAgo(1), cap: null } });
    const op: Op = { kind: "create_order", company_id: "900", company_name: "c", client_email: "x@y.z", job_name: "j", shifts: [] };
    const r = await runOp("ladder8", op, { testOnly: false });
    ok(r.status === "unknown", "the dead network after the POST began is unknown, never retried", r);
    let reported: any[] = [];
    for (let i = 0; i < 20 && !reported.length; i++) {
      reported = (await sql`SELECT where_at, what FROM error_reports WHERE where_at = 'bot/run'`) as any[];
      if (!reported.length) await new Promise((d) => setTimeout(d, 100));
    }
    ok(reported.length === 1 && /unknown/.test(reported[0].what), "and error_reports carries it as the write path's own report", reported);
    await sql`DELETE FROM error_reports WHERE where_at = 'bot/run'`;
    await noClasses();
  }

  console.log("\n[9] the flags are a switch: whitelisted with validation, admin-only, on the history");
  {
    const good = coerceSettings({ bot_write_classes: { set_position_size: { since: "2026-11-18T08:00:00.000Z", cap: 2 } } });
    ok(!!good.bot_write_classes && good.bot_write_classes.set_position_size?.cap === 2, "a valid map passes the whitelist", good);
    ok(coerceSettings({ bot_write_classes: { not_a_kind: { since: "2026-11-18T08:00:00.000Z", cap: 2 } } }).bot_write_classes === undefined, "an unknown op kind drops the field: a typo must never half-enable");
    ok(coerceSettings({ bot_write_classes: { set_position_size: { since: "whenever", cap: 2 } } }).bot_write_classes === undefined, "an unparseable since drops the field");
    ok(coerceSettings({ bot_write_classes: { set_position_size: { since: "2026-11-18T08:00:00.000Z", cap: 0 } } }).bot_write_classes === undefined, "cap 0 is a confusion (off is removal), dropped");
    ok((SWITCHES as readonly string[]).includes("bot_write_classes"), "bot_write_classes is one of the guarded switches");
    const hist: any[] = [];
    const io: SettingsIO = {
      get: async () => ({ ...(await getSettings(sql as any)), bot_write_classes: {} }),
      save: async (n) => saveSettings(n, sql as any),
      history: async (c) => { hist.push(c); },
      report: (() => Promise.resolve(false)) as never,
    };
    const req = (body: unknown) => new Request("http://x/api/settings", { method: "POST", body: JSON.stringify(body) });
    const denied = await handleSettingsPost(req({ bot_write_classes: { set_position_size: { since: "2026-11-18T08:00:00.000Z", cap: 2 } } }), io, { actor: "staff", admin: false });
    ok(denied.status === 403, "a non-admin cannot enable a class", denied.status);
    const okd = await handleSettingsPost(req({ bot_write_classes: { set_position_size: { since: "2026-11-18T08:00:00.000Z", cap: 2 } } }), io, { actor: "owner", admin: true });
    ok(okd.status === 200 && hist.some((h) => h.field === "bot_write_classes"), "an admin can, and the change is recorded", { status: okd.status, hist });
    await noClasses();
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
