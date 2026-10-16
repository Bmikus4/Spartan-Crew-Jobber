// ============================================================================
// A fake OnSinch, seeded from the snapshot, that answers the queries the live path makes.
// ----------------------------------------------------------------------------
// Real data, in time: an order exists from the moment it was created (staff's real orders
// appear when staff really made them), a timeline row from the moment it was written. What
// cannot be replayed is staff's later edits to an order's shape: an order reads as it reads
// today from the moment it exists. The bot's writes land here (bot.ts) and are timelined under
// user 2257, as OnSinch logs a staff-screen save.
//
// Query semantics as measured on the real API: /orders newest first, /timelineAudits oldest
// first, `field[op]=v` with eq/lt/gt/gte/lte/like (like takes SQL %), nested filters through
// `__` (Job__id), {data, pagination:{page, pageCount, count, limit}}.
// ============================================================================
import { readFileSync } from "node:fs";
import { clock } from "./pg";

const load = (n: string) => JSON.parse(readFileSync(`.tmp-data/sim/${n}.json`, "utf8"));

export const store = {
  orders: new Map<number, any>(),
  companies: [] as any[],
  places: [] as any[],
  professions: [] as any[],
  timeline: [] as any[],
  deleted: new Set<number>(),
  nextOrder: 990000, nextNumber: 99000, nextJob: 990000, nextTeam: 990000, nextSlot: 9900000, nextAudit: 99000000,
};

export function seed(): void {
  for (const o of load("orders")) store.orders.set(Number(o.id), o);
  store.companies = load("companies");
  store.places = load("places");
  store.professions = load("professions");
  // Real ids x1000, so a simulated save can sit between two real rows as a whole number (the
  // verifier keeps its cursor in a bigint column).
  store.timeline = (load("timeline") as any[]).map((x) => ({ ...x, id: Number(x.id) * 1000 }));
}

const visible = (createdIso: string | undefined) => !createdIso || Date.parse(createdIso) <= clock.now();

function get(o: any, path: string[]): any[] {
  if (!path.length) return [o];
  const v = o?.[path[0]];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((x) => get(x, path.slice(1)));
}

function matches(o: any, key: string, value: string): boolean {
  const m = /^(.+?)\[(eq|lt|gt|gte|lte|like|in)\]$/.exec(key);
  const field = m ? m[1] : key, op = m ? m[2] : "eq";
  const vals = get(o, field.split("__"));
  // `data[like]` on the timeline is matched against the raw data string, slashes escaped as stored.
  return vals.some((v) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (op === "eq") return s === value;
    if (op === "in") return value.split(",").includes(s);
    if (op === "like") return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "is").test(s);
    const a = Number.isFinite(Number(s)) && Number.isFinite(Number(value)) ? Number(s) : Date.parse(s), b = Number.isFinite(Number(value)) ? Number(value) : Date.parse(value);
    return op === "lt" ? a < b : op === "gt" ? a > b : op === "gte" ? a >= b : a <= b;
  });
}

const RESERVED = new Set(["with", "limit", "page", "sort"]);
export const calls = new Map<string, number>();

function list(path: string, q: URLSearchParams): { status: number; data: any } {
  let rows: any[];
  if (path === "/orders") rows = [...store.orders.values()].filter((o) => !store.deleted.has(Number(o.id)) && visible(o.created)).sort((a, b) => Number(b.id) - Number(a.id));
  else if (path === "/companies") rows = store.companies;
  else if (path === "/places") rows = store.places;
  else if (path === "/professions") rows = store.professions;
  else if (path === "/timelineAudits") rows = store.timeline.filter((x) => visible(x.created)).sort((a, b) => Number(a.id) - Number(b.id));
  else if (path === "/attendance" || path === "/workers" || path === "/orderItems") rows = [];
  else return { status: 404, data: { message: `the simulator has no ${path}` } };
  // "Order__id" on attendance and other nested filters fall through to the generic matcher.
  for (const [k, v] of q) if (!RESERVED.has(k)) rows = rows.filter((o) => matches(o, k, v));
  const limit = Math.max(1, Math.min(500, Number(q.get("limit") || 20)));
  const page = Math.max(1, Number(q.get("page") || 1));
  const count = rows.length;
  return { status: 200, data: { data: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, count, pageCount: Math.max(1, Math.ceil(count / limit)) } } };
}

/** OnSinch's HTTP surface: (method, path with query, body) -> {status, data}. */
export async function onsinch(method: string, url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const u = new URL(url, "https://sim.onsinch/api/v1/");
  const path = u.pathname.replace(/^.*\/api\/v1/, "").replace(/\/$/, "");
  calls.set(`${method} ${path}`, (calls.get(`${method} ${path}`) ?? 0) + 1);
  if (path === "/users/profile") return { status: 200, data: { data: { id: 2257, name: "Samurai AI" } } };
  if (method === "GET") return list(path, u.searchParams);
  if (method === "DELETE" && path === "/orders") { for (const id of (body as number[]) ?? []) store.deleted.add(Number(id)); return { status: 204, data: null }; }
  if (method === "DELETE" && path === "/companies") return { status: 204, data: null };
  return { status: 405, data: { message: `the simulator does not take ${method} ${path}: writes go through the simulated bot` } };
}

// OnSinch numbers its timeline in time order, and the verifier skips every row at or below the
// newest id it has read. A simulated save numbered past the real ids (99,000,001) pushed that
// cursor beyond every staff edit still to come and hid them all (Light Motif R11662, 10-16).
// So a save takes the newest real id already written plus one (real ids are scaled by 1000 at
// seed): after what came before, before what comes next.
let lastBase = -1, frac = 0;
export function audit(action: string, model: string, id: number | string, diff: Record<string, Record<string, { old: unknown; new: unknown }>> | null): void {
  const base = store.timeline.reduce((m, x) => (!x.sim && Date.parse(x.created) <= clock.now() ? Math.max(m, Number(x.id)) : m), 0);
  frac = base === lastBase ? frac + 1 : 1; lastBase = base;
  store.timeline.push({ id: base + frac, sim: true, action, creator: 2257, created: clock.iso(), data: JSON.stringify({ id: String(id), model, ...(diff ? { diffChanges: diff } : {}) }) });
}
