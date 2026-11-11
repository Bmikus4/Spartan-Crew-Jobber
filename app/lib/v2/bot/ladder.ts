// ============================================================================
// The promotion ladder's stage-1 apparatus (DECISIONS O34, decisions/2026-11-11-bot-write-promotion-ladder.md).
//
// bot_write_classes in Settings names the op kinds the bot may write live, each with the day it
// was enabled and a daily cap. ENABLING a class is a person's dated decision (a new file in
// decisions/); this module may only ever REMOVE one. Both master switches (SPARTAN_WRITES and
// bot_writes_enabled) still gate above the classes: a class with the masters off writes nothing.
//
//   ladderGate   runs inside runOp, so neither the decide path nor the resume path can route
//                around it. Refuses a live write whose class is not enabled, or whose class has
//                used its daily cap. Fails CLOSED: a settings or ledger read that fails is off.
//   ladderCheck  the minute sync's auto-rollback, pre-registered before anything turned on:
//                (a) a mismatch ledger row on an enabled class -> that class off;
//                (b) a staff edit reversing a bot edit on the same record within 72h -> class off;
//                (c) an error report from the write path -> every class off.
//                Each trip is written to settings_history and raised to the owner. Re-entry is
//                never automatic. Checks read nothing older than a class's `since`, so the three
//                historical create_order mismatches (14-15 Oct) can never trip a later enable.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { getSettings, saveSettings, settingsHistory } from "../../settingsDb";
import { reportError } from "../../errorReport";
import { BOT_USER, utcToLondon, type Op } from "./ops";

type Sql = NeonQueryFunction<false, false>;

let _sql: Sql | null = null;
function db(): Sql | null {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

export type LadderClass = { since: string; cap: number | null };

/** Refusals for a LIVE write of this kind; empty means the ladder lets it through. */
export async function ladderGate(kind: Op["kind"], sql: Sql | null = db()): Promise<string[]> {
  try {
    const entry = (((await getSettings(sql)).bot_write_classes ?? {}) as Record<string, LadderClass>)[kind];
    if (!entry) return [`${kind} is not an enabled write class (promotion ladder O34): planned, not written`];
    if (entry.cap === null || entry.cap === undefined || !sql) return [];
    // "2 writes/day" counts the ops that went live (the {live: true} mark runOp sets after this
    // gate), on the London calendar day; blocked ops sent nothing and bench ops are not live.
    const rows = (await sql`
      SELECT created_at FROM bot_ledger
      WHERE kind = ${kind} AND status <> 'blocked' AND detail->>'live' = 'true'
        AND created_at >= ${new Date(Date.now() - 26 * 3600_000).toISOString()}`) as { created_at: string }[];
    const today = utcToLondon(new Date().toISOString()).date;
    const n = rows.filter((r) => utcToLondon(new Date(r.created_at).toISOString()).date === today).length;
    return n >= entry.cap ? [`the daily cap for ${kind} is reached: ${n} of ${entry.cap} live today (O34 stage 1)`] : [];
  } catch (e) {
    return [`the ladder could not be read, so ${kind} stays off: ${String((e as Error)?.message ?? e).slice(0, 120)}`];
  }
}

/** Which enabled class a timeline diff field belongs to (run.ts AUDIT_FIELDS, inverted). */
const FIELD_CLASS: Record<string, Op["kind"]> = {
  size: "set_position_size", beginning: "set_position_times", end: "set_position_times",
  intern_name: "set_po", cancelled: "cancel_position",
};

/** Every reporter that lives on the write path. A new one must be added here or check (c) is blind to it. */
const WRITE_PATH_WHERES = ["bot/run", "v2/resume"];

export async function ladderCheck(sql: Sql, now: number, report: typeof reportError = reportError): Promise<{ classes: number; rollbacks: string[] }> {
  const before = ((await getSettings(sql)).bot_write_classes ?? {}) as Record<string, LadderClass>;
  const kinds = Object.keys(before);
  if (!kinds.length) return { classes: 0, rollbacks: [] };
  const sinceOf = (k: string) => Date.parse(before[k].since);
  const trips = new Map<string, string>(); // a kind, or "ALL" -> why it tripped

  // (c) an error report from the write path: every class off.
  const minSince = new Date(Math.min(...kinds.map(sinceOf))).toISOString();
  const reps = (await sql`
    SELECT where_at, what FROM error_reports
    WHERE where_at = ANY(${WRITE_PATH_WHERES}) AND last_seen_at >= ${minSince}`) as { where_at: string; what: string }[];
  if (reps.length) trips.set("ALL", `a write-path error report (${reps[0].where_at}: ${String(reps[0].what).slice(0, 120)})`);

  // (a) a mismatch ledger row on an enabled class, since it was enabled.
  const mm = (await sql`
    SELECT kind, op_key, updated_at FROM bot_ledger
    WHERE status = 'mismatch' AND kind = ANY(${kinds})`) as { kind: string; op_key: string; updated_at: string }[];
  for (const r of mm) if (Date.parse(r.updated_at) >= sinceOf(r.kind) && !trips.has(r.kind)) trips.set(r.kind, `a mismatch ledger row (${r.op_key})`);

  // (b) a staff edit reversing a bot edit on the same record within 72h: the staff row's new
  // value is the value the bot replaced. Both sides come from the stored timeline, so there is
  // no format conversion to get wrong; a follow-up edit to some third value is not a reversal.
  const h72 = 72 * 3600_000;
  const bots = (await sql`
    SELECT id, created, model, model_id, data FROM onsinch_timeline
    WHERE creator = ${BOT_USER} AND action = 'common_change' AND created >= ${new Date(now - h72).toISOString()}`) as
    { id: string; created: string; model: string; model_id: string; data: { diffChanges?: Record<string, Record<string, { old?: unknown; new?: unknown }>> } }[];
  for (const b of bots) {
    const diffs = b.data?.diffChanges?.[b.model] ?? {};
    for (const [field, v] of Object.entries(diffs)) {
      const kind = FIELD_CLASS[field];
      if (!kind || !before[kind] || trips.has(kind)) continue;
      const bAt = new Date(b.created).getTime();
      if (bAt < sinceOf(kind)) continue;
      const staff = (await sql`
        SELECT creator, created, data FROM onsinch_timeline
        WHERE action = 'common_change' AND model = ${b.model} AND model_id = ${b.model_id}
          AND creator IS NOT NULL AND creator <> ${BOT_USER}
          AND created > ${b.created} AND created <= ${new Date(bAt + h72).toISOString()}`) as
        { creator: number; created: string; data: { diffChanges?: Record<string, Record<string, { old?: unknown; new?: unknown }>> } }[];
      for (const s of staff) {
        const sv = s.data?.diffChanges?.[b.model]?.[field];
        if (sv && "new" in sv && String(sv.new) === String(v?.old))
          trips.set(kind, `staff ${s.creator} reversed the bot's ${b.model} ${b.model_id} ${field} within 72h (timeline ${b.id})`);
      }
    }
  }

  if (!trips.size) return { classes: kinds.length, rollbacks: [] };
  const off = trips.has("ALL") ? kinds : [...trips.keys()];
  const next = Object.fromEntries(Object.entries(before).filter(([k]) => !off.includes(k)));
  await saveSettings({ bot_write_classes: next }, sql);
  const rollbacks = [...trips.entries()].map(([k, why]) => `${k === "ALL" ? "every class" : k} off: ${why}`);
  await settingsHistory({ field: "bot_write_classes", from: before, to: next, actor: `ladder auto-rollback: ${rollbacks[0]}`.slice(0, 200), at: new Date(now).toISOString() }, sql);
  for (const line of rollbacks) await report({ route: "ladder-rollback", where: "bot/ladder", what: line.slice(0, 300) });
  return { classes: Object.keys(next).length, rollbacks };
}
