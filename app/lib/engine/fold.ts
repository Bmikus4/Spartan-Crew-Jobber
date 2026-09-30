// ============================================================================
// fold — a job's state as a pure fold over immutable change facts (design §14-16).
// ----------------------------------------------------------------------------
// Step 6, offline half: the fold and its validation. The extractor that PRODUCES
// change-sets from live mail is the other half and needs live traffic or an approved
// small paid run to validate; nothing here calls a model.
//
// The rule that matters: a block a message does not mention is UNCHANGED. mergeFacts
// replaces `requests` wholesale, so "make the derig 6" on a three-block job dropped the
// other two (characterisation A1: 12 crew became 8). Here a change names the block it
// changes, by ref, and nothing else moves. Removal is its own operation and needs the
// client's own words (A2).
// ============================================================================

export type Authority = "client_requested" | "client_confirmed" | "spartan_stated" | "ops_live" | "engine_default" | "inferred" | "migrated";

export type BlockField = "day" | "start" | "end" | "size" | "task" | "profession" | "place_id";
export type OrderField = "place_id" | "po" | "reference" | "summary";

export type FactOp =
  | { op: "set"; ref: string; field: BlockField | OrderField; value: string | number; quote?: string }
  | { op: "clear"; ref: string; field: BlockField | OrderField; quote: string }
  | { op: "add_block"; ref: string; block: Partial<Record<BlockField, string | number>>; quote?: string }
  | { op: "remove_block"; ref: string; quote: string }
  | { op: "cancel"; quote: string }
  | { op: "confirm"; ref: string; field: BlockField | OrderField; quote?: string };

export interface ChangeSet {
  /** The message (or `onsinch:<audit id>`, or `rule:<name>`) the facts came from. */
  source: string;
  /** Source time, ISO: the fold's total order is (at, source). */
  at: string;
  authority: Authority;
  ops: FactOp[];
  /** The sender's own words, for quote checks. Absent for ops_live and rules. */
  own_text?: string;
}

export interface Value { value: string | number; authority: Authority; source: string; at: string; supersedes?: Value }

export interface JobState {
  order: Partial<Record<OrderField, Value>>;
  blocks: Map<string, { fields: Partial<Record<BlockField, Value>>; removed?: Value }>;
  cancellation?: Value;
  /** Every op refused, and why: unknown ref, missing quote, impossible value, no authority to write. */
  rejected: Array<{ source: string; op: FactOp["op"]; ref?: string; why: string }>;
}

/** Ops-owned fields: ops_live wins; the engine sets them only at create (§15). */
const OPS_OWNED = new Set<string>(["task", "profession"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function impossible(field: string, v: unknown): string | null {
  if (field === "size" && !(Number.isInteger(v) && Number(v) >= 1)) return `size ${String(v)} is not a crew size`;
  if ((field === "start" || field === "end") && !TIME.test(String(v))) return `time ${String(v)} is out of range`;
  if (field === "day" && !DAY.test(String(v))) return `day ${String(v)} is not a date`;
  return null;
}

/** May a value of this authority replace the current one on this field? */
function wins(field: string, next: Authority, cur?: Value): boolean {
  if (next === "inferred" || next === "spartan_stated") return false; // records, never values
  if (!cur) return true;
  if (next === "engine_default") return false; // a default only fills a blank
  if (OPS_OWNED.has(field) && cur.authority === "ops_live" && next !== "ops_live") return false;
  return true; // the latest in source time among client and ops values
}

export function fold(changeSets: ChangeSet[]): JobState {
  const state: JobState = { order: {}, blocks: new Map(), rejected: [] };
  const ordered = [...changeSets].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.source.localeCompare(b.source));

  for (const cs of ordered) {
    const own = cs.own_text !== undefined ? norm(cs.own_text) : undefined;
    const quoted = (q?: string) => own === undefined || (!!q && own.includes(norm(q)));
    const reject = (op: FactOp, why: string) => state.rejected.push({ source: cs.source, op: op.op, ref: "ref" in op ? op.ref : undefined, why });
    const put = (slot: Partial<Record<string, Value>>, field: string, value: string | number) => {
      const cur = slot[field];
      if (!wins(field, cs.authority, cur)) return false;
      slot[field] = { value, authority: cs.authority, source: cs.source, at: cs.at, ...(cur ? { supersedes: cur } : {}) };
      return true;
    };

    for (const op of cs.ops) {
      if (op.op === "cancel") {
        if (!quoted(op.quote)) { reject(op, "a cancellation needs the client's own words"); continue; }
        state.cancellation = { value: op.quote, authority: cs.authority, source: cs.source, at: cs.at };
        continue;
      }
      if (op.op === "add_block") {
        if (state.blocks.has(op.ref)) { reject(op, `block ${op.ref} already exists`); continue; }
        const bad = Object.entries(op.block).map(([f, v]) => impossible(f, v)).find(Boolean);
        if (bad) { reject(op, bad); continue; }
        if (cs.authority === "inferred" || cs.authority === "spartan_stated") { reject(op, `${cs.authority} cannot add a block`); continue; }
        const b = { fields: {} as Partial<Record<BlockField, Value>> };
        for (const [f, v] of Object.entries(op.block)) if (v !== undefined) b.fields[f as BlockField] = { value: v, authority: cs.authority, source: cs.source, at: cs.at };
        state.blocks.set(op.ref, b);
        continue;
      }
      const target = op.ref === "order" ? undefined : state.blocks.get(op.ref);
      if (op.ref !== "order" && !target) { reject(op, `unknown block ${op.ref}`); continue; }
      if (op.op === "remove_block") {
        if (!quoted(op.quote)) { reject(op, "a removal needs the client's own words"); continue; }
        target!.removed = { value: 1, authority: cs.authority, source: cs.source, at: cs.at };
        continue;
      }
      if (op.op === "confirm") {
        const slot = (target ? target.fields : state.order) as Partial<Record<string, Value>>;
        const cur = slot[op.field];
        if (cur && cs.authority.startsWith("client")) slot[op.field] = { ...cur, authority: "client_confirmed", source: cs.source, at: cs.at, supersedes: cur };
        continue;
      }
      if (op.op === "clear" && !quoted(op.quote)) { reject(op, "clearing a value needs the client's own words"); continue; }
      if (op.op === "set") {
        const bad = impossible(op.field, op.value);
        if (bad) { reject(op, bad); continue; }
        if (cs.authority.startsWith("client") && op.quote !== undefined && !quoted(op.quote)) { reject(op, "quote not in the sender's own text"); continue; }
      }
      const slot = (target ? target.fields : state.order) as Partial<Record<string, Value>>;
      if (op.op === "clear") { delete slot[op.field]; continue; }
      if (!put(slot, op.field, op.value) && (cs.authority === "inferred" || cs.authority === "spartan_stated")) {
        reject(op, `${cs.authority} does not set a value`);
      }
    }
  }
  return state;
}

/** Crew per live block, for comparing a fold with today's desired order. */
export function liveBlocks(s: JobState): Array<{ ref: string; day?: string; start?: string; end?: string; size?: number }> {
  return [...s.blocks.entries()]
    .filter(([, b]) => !b.removed)
    .map(([ref, b]) => ({
      ref,
      day: b.fields.day?.value as string | undefined,
      start: b.fields.start?.value as string | undefined,
      end: b.fields.end?.value as string | undefined,
      size: b.fields.size?.value as number | undefined,
    }));
}
