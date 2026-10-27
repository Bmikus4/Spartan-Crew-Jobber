// ============================================================================
// Prompt 0 (ADDENDUM §7): how often each finding happens, over the last 30 days. Counts only: no
// address, name, subject or body is printed. READ ONLY on both sides: every query runs in a READ ONLY
// transaction (_readonly.mts proves it first), and OnSinch is only read (GET).
//
//   npx tsx --env-file=.env.local scripts/ops-truth.mts --from <30 days ago> --out <file>
//   npx tsx --env-file=.env.local scripts/size-findings.mts [--truth <that file>]
//
// Without --truth the F8/F9 "staff acted after" count is skipped. The period is the 30 days to now.
// ============================================================================
import { readFileSync } from "node:fs";
import { readOnlySql, proveReadOnly } from "./_readonly.mts";
import { httpTransport, OnsinchClient } from "../app/lib/onsinch/onsinch";
import { readRows } from "../app/lib/v2/read";
import { codeOfReason } from "../app/lib/v2/reasons";

const BOT = 2257;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ro = readOnlySql();
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
const out: Record<string, unknown> = { read_only: (await proveReadOnly(ro)).slice(0, 50) };
const since = new Date(Date.now() - 30 * 86_400_000);
out.period = { since: since.toISOString(), until: new Date().toISOString() };
const recent = await ro`SELECT message_id, thread_id, kind, decision, interpretation, from_address, company_id FROM v2_decisions
  WHERE created_at > ${since.toISOString()} AND coalesce(code_version, '') <> 'local'`;
const codeOf = (d: any) => d?.code ?? codeOfReason(String(d?.reason ?? d?.reasons?.[0] ?? ""));

// Every decision by kind and by the code stamped on it, or derived from its reason before codes were stamped.
const codes: Record<string, Record<string, number>> = {};
for (const r of recent) { codes[r.kind] ??= {}; codes[r.kind][codeOf(r.decision)] = (codes[r.kind][codeOf(r.decision)] ?? 0) + 1; }
out.decisions = { total: recent.length, codes: Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort((a, b) => b[1] - a[1]))])) };

// The reader: the model and prompt each stored reading names. Vercel's env cannot be read from here.
out.models = await ro`SELECT interpretation->'meta'->>'model' AS model, interpretation->'meta'->>'prompt_id' AS prompt, count(*)::int AS n,
  min(created_at)::date::text AS first, max(created_at)::date::text AS last FROM v2_decisions
  WHERE created_at > ${since.toISOString()} AND interpretation->'meta' IS NOT NULL GROUP BY 1, 2 ORDER BY 5 DESC`;

// F2: threads with two or more handoffs; of those, threads no order was ever linked to (job_links).
out.f2 = (await ro`WITH h AS (SELECT thread_id FROM v2_decisions WHERE kind = 'handoff' AND created_at > ${since.toISOString()}
    AND coalesce(code_version, '') <> 'local' GROUP BY 1 HAVING count(*) >= 2)
  SELECT count(*)::int AS threads_2plus_handoffs,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM job_links j WHERE j.thread_id = h.thread_id AND j.order_id IS NOT NULL))::int AS of_which_no_order_linked FROM h`)[0];

// F8/F9: "already booked" and "already as asked", and how many of those emails staff acted on afterwards (ops-truth).
const covered = recent.filter((r) => r.kind === "none" && ["none_already_booked", "none_already_as_asked"].includes(codeOf(r.decision)));
const truthFile = arg("--truth");
const truth = truthFile ? new Map((JSON.parse(readFileSync(truthFile, "utf8")) as any[]).map((x) => [x.id, x])) : null;
out.f8_f9 = { covered: covered.length, staff_acted_after: truth ? covered.filter((r) => (truth.get(r.message_id)?.staff ?? []).length > 0).length : "run ops-truth and pass --truth" };

// F17: the ledger's claim to last update, in seconds.
out.f17 = (await ro`SELECT count(*)::int AS rows, count(*) FILTER (WHERE extract(epoch FROM updated_at - created_at) > 180)::int AS over_180s,
  round(max(extract(epoch FROM updated_at - created_at)))::int AS max_s,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM updated_at - created_at)))::int AS median_s
  FROM bot_ledger WHERE created_at > ${since.toISOString()} AND status <> 'running'`)[0];

// F18: what the substring filter sets aside that a whole-domain or mailbox-name rule would not.
const old = /spartancrew\.co\.uk|no-?reply|mailer-daemon|postmaster|onsinch|sinch\.cz/i;
const notClient = (a: string) => {
  const m = /([^<\s@]+)@([^>\s]+)/.exec(a.toLowerCase());
  return !!m && (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)$/.test(m[1]) || /(^|\.)(spartancrew\.co\.uk|onsinch\.(com|cz|co\.uk)|sinch\.cz)$/.test(m[2]));
};
const setAside = recent.filter((r) => r.kind === "none" && codeOf(r.decision) === "none_not_client");
out.f18 = { not_a_client: setAside.length, old_substring_only: setAside.filter((r) => old.test(String(r.from_address)) && !notClient(String(r.from_address))).length };

// F23: decisions whose reading picked an R number, and of those, picks the email's own words do not hold.
const bodies = new Map((await ro`SELECT message_id, subject, body FROM thread_messages WHERE message_id = ANY(${recent.map((r) => r.message_id)})`).map((m) => [m.message_id, `${m.subject ?? ""}\n${m.body ?? ""}`]));
let picks = 0, notInWords = 0, written = 0;
for (const r of recent) {
  const reqs = r.interpretation?.extraction?.requests;
  const ps = (Array.isArray(reqs) ? reqs : []).map((q: any) => q?.order).filter((o: unknown) => typeof o === "string" && o.trim());
  if (!ps.length) continue;
  picks++;
  if (ps.some((p: string) => !(bodies.get(r.message_id) ?? "").includes(p.replace(/^R/i, "")))) { notInWords++; if (r.kind === "write") written++; }
}
out.f23 = { decisions_with_a_pick: picks, pick_not_in_the_emails_words: notInWords, of_which_written: written };

// F26: decisions with no reading; the system's own read failures.
out.f26 = { no_extraction: recent.filter((r) => !r.interpretation?.extraction).length,
  could_not_read: recent.filter((r) => String(r.decision?.reasons?.[0] ?? "").startsWith("the system could not read this email")).length };

// OnSinch: orders created in the period (F16) and companies (F13).
const stamp = since.toISOString().slice(0, 19);
const orders: any[] = [];
for (let page = 1; page <= 30; page++) {
  const rows = await readRows(t as any, `/orders?created[gte]=${encodeURIComponent(stamp)}&with=Job__SlotTeam__Slot__SlotLocation&limit=100&page=${page}`);
  orders.push(...rows);
  if (rows.length < 100) break;
}
const jobs = (o: any) => ([] as any[]).concat(o.Job ?? []);
const staffBuilt = orders.filter((o) => Number(o.creator) !== BOT);
out.f16 = { orders_created: orders.length, staff_built: staffBuilt.length, staff_built_multi_job: staffBuilt.filter((o) => jobs(o).length > 1).length,
  bot_built: orders.length - staffBuilt.length, bot_built_multi_job: orders.filter((o) => Number(o.creator) === BOT && jobs(o).length > 1).length };
const norm = (s: string) => String(s ?? "").toLowerCase().replace(/\b(ltd|limited|llp|plc|inc)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const companies = await new OnsinchClient(t).allCompanies();
const names = new Map<string, number>();
for (const c of companies) names.set(norm(c.name), (names.get(norm(c.name)) ?? 0) + 1);
const groups = [...names.values()].filter((n) => n > 1);
out.f13 = { companies: companies.length, same_name_groups: groups.length, companies_in_them: groups.reduce((a, b) => a + b, 0), note: "OnSinch's company record carries no creator" };

// F10: verified bot edits tied to a client email's plan, on orders with more than one venue, at a venue the email did not name.
const edits = await ro`SELECT l.op, d.interpretation->'grounded'->'requests' AS reqs FROM bot_ledger l
  LEFT JOIN LATERAL (SELECT interpretation FROM v2_decisions d WHERE jsonb_typeof(d.decision->'ops') = 'array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.decision->'ops') x WHERE x->>'source' = l.source) LIMIT 1) d ON true
  WHERE l.status = 'verified' AND l.kind <> 'create_order' AND l.created_at > ${since.toISOString()}`;
const words = (s: string) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "hall", "centre", "center", "london", "venue"].includes(w)));
const places = new Map<number, string>((await new OnsinchClient(t).allPlaces()).map((p: any) => [Number(p.id), String(p.name ?? "")]));
let tied = 0, multiVenue = 0, named = 0, elsewhere = 0;
for (const e of edits) {
  if (!e.reqs) continue;
  tied++;
  const o = (await readRows(t as any, `/orders?id[eq]=${Number(e.op?.order_id)}&status[gte]=-9&with=Job__SlotTeam__Slot__SlotLocation`))[0];
  const slots = o ? jobs(o).flatMap((j) => ([] as any[]).concat(j.SlotTeam ?? [])).flatMap((tm) => ([] as any[]).concat(tm.Slot ?? [])) : [];
  const placeOf = (s: any) => Number(([] as any[]).concat(s.SlotLocation ?? [])[0]?.place_id ?? 0);
  if (new Set(slots.map(placeOf).filter(Boolean)).size < 2) continue;
  multiVenue++;
  const venue = (e.reqs as any[]).map((r) => r?.venue?.value ?? r?.venue).find((v) => typeof v === "string" && v.trim());
  if (!venue) continue;
  named++;
  const at = places.get(placeOf(slots.find((s) => Number(s.id) === Number(e.op?.slot_id)) ?? {})) ?? "";
  if (![...words(venue)].some((w) => words(at).has(w))) elsewhere++;
}
out.f10 = { verified_bot_edits: edits.length, tied_to_a_client_email: tied, on_multi_venue_orders: multiVenue, email_named_a_venue: named, landed_at_another_venue: elsewhere };

console.log(JSON.stringify(out, null, 1));
