// Create parity: does the rebuild create orders the way the old engine did, apart from how?
//
//   npx tsx --env-file=.env.local scripts/create-ab.mts --read
//     Every order the old engine created (order_records, id_source api_response) against what the
//     rebuild would have filled in for it at that moment (contact, rate card, order manager, name)
//     and against what staff kept on it since. Read-only.
//   npx tsx --env-file=.env.local scripts/create-ab.mts --write [6]
//     That many of those orders, moved forward 1 year and onto TEST - Eventz (515), are created
//     twice: by the old engine's writer (buildOrderBody -> POST /orders) and by the rebuild's
//     (runOp: API create, then the builder in the browser). Both are read back and compared:
//     what they book must be identical; every other difference is listed. Both are then deleted.
import { neon } from "@neondatabase/serverless";
import { httpTransport, OnsinchClient } from "../app/lib/engine/onsinch";
import { buildOrderBody } from "../app/lib/engine/format";
import { clientDefaults, ORDER_MANAGER_ID } from "../app/lib/v2/bot/apiCreate";
import { runOp, readOrder } from "../app/lib/v2/bot/run";
import { opFromV1, contentOfV1, contentOfOp, contentOfOrder, layoutOf, retime, type V1Shape } from "../app/lib/v2/bot/parity";
import { utcToLondon } from "../app/lib/v2/bot/ops";

const sql = neon((process.env.DATABASE_URL || "").trim());
const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
const client = new OnsinchClient(t);
const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);
const TEST = 515;
const norm = (s: unknown) => String(s ?? "").replace(/^[\s*^#]+/, "").replace(/\s+/g, " ").trim().toLowerCase();
const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((a / b) * 100)}%)` : "0/0");

const records = (await sql`SELECT order_id, order_number, company_id, sender_email, created_at, shape_sent FROM order_records
  WHERE id_source = 'api_response' AND shape_sent IS NOT NULL ORDER BY created_at`) as any[];

if (process.argv.includes("--read")) {
  const companies = new Map((await client.allCompanies()).map((c: any) => [Number(c.id), String(c.name ?? "").trim()]));
  const places = new Map<number, string>();
  const placeName = async (id: number) => {
    if (!places.has(id)) places.set(id, String(rowsOf(await t("GET", `/places?id[eq]=${id}`))[0]?.name ?? "").trim());
    return places.get(id)!;
  };
  // What staff ended up with for each booking: the engine's order if it survived, else the order
  // staff built in its place (same client, made by a person within 10 days after, on a day the
  // engine's order booked). Staff deleted and retyped nearly all of them, so this is the truth.
  const floor = Math.min(...records.map((r) => Number(r.order_id))) - 300;
  const byCompany = new Map<number, any[]>();
  const ordersOf = async (c: number) => {
    if (!byCompany.has(c)) {
      const out: any[] = [];
      for (let page = 1; page <= 5; page++) { const rows = rowsOf(await t("GET", `/orders?company_id[eq]=${c}&id[gte]=${floor}&with=Job__SlotTeam__Slot__SlotLocation&limit=100&page=${page}`)); out.push(...rows); if (rows.length < 100) break; }
      byCompany.set(c, out);
    }
    return byCompany.get(c)!;
  };
  const days = (o: any) => new Set(contentOfOrder(o).map((x) => utcToLondon(x.split("|")[0]).date));
  const tally = { n: 0, kept: 0, survived: 0, retyped: 0, v1Contact: 0, v2Contact: 0, v1Card: 0, v2Card: 0, cardsDiffer: 0, v1Name: 0, v2Name: 0, sameContent: 0, chiefInside: 0, chiefAlone: 0, chiefFlag: 0, chiefs: 0, hidden: 0, slots: 0 };
  const cardRows: string[] = [], nameRows: string[] = [];
  for (const r of records) {
    const s = r.shape_sent as V1Shape;
    tally.n++;
    const v1Days = new Set(s.slot_teams.map((x) => utcToLondon(new Date(x.beginning).toISOString()).date));
    const all = await ordersOf(Number(s.company_id));
    const self = all.find((o) => Number(o.id) === Number(r.order_id));
    const created = Date.parse(r.created_at);
    const replacement = all
      .filter((o) => Number(o.creator) !== 2257 && Date.parse(o.created) >= created - 36e5 && Date.parse(o.created) <= created + 10 * 864e5 && [...days(o)].some((d) => v1Days.has(d)))
      .sort((x, y) => Date.parse(x.created) - Date.parse(y.created))[0];
    const now = self ?? replacement;
    if (!now) continue;
    tally.kept++;
    if (self) tally.survived++; else tally.retyped++;
    const v2 = await clientDefaults(Number(s.company_id), String(r.sender_email ?? ""), Number(r.order_id));
    const venue = await placeName(Number(s.slot_teams[0]?.place_id));
    const v2Name = `${companies.get(Number(s.company_id)) ?? ""}${s.intern_name ? ` - ${s.intern_name}` : ""} @ ${venue}`.slice(0, 80);
    const card = Number(([] as any[]).concat(now.Job ?? [])[0]?.pricelist_category_id);
    if (String(now.user_id) === String(s.user_id)) tally.v1Contact++;
    if (String(now.user_id) === v2.user_id) tally.v2Contact++;
    if (card === Number(s.pricelist_category_id)) tally.v1Card++;
    if (card === v2.card) tally.v2Card++;
    if (Number(s.pricelist_category_id) !== v2.card) { tally.cardsDiffer++; cardRows.push(`R${r.order_number} ${companies.get(Number(s.company_id))}: old ${s.pricelist_category_id} (${(s as any).rate_card_source}), new ${v2.card} (${v2.card_from}), staff ${card} on R${now.number}`); }
    if (norm(now.name) === norm(s.name)) tally.v1Name++;
    if (norm(now.name) === norm(v2Name)) tally.v2Name++;
    if (nameRows.length < 12) nameRows.push(`staff "${now.name}" | old "${s.name}" | new "${v2Name}"`);
    if (contentOfOrder(now).join(" ") === contentOfV1(s).join(" ")) tally.sameContent++;
    const l = layoutOf(now);
    tally.chiefInside += l.chief_inside; tally.chiefAlone += l.chief_alone; tally.chiefFlag += l.chief_role_flag; tally.chiefs += l.chief_inside + l.chief_alone;
    tally.hidden += l.hidden; tally.slots += l.slots;
  }
  console.log(`
Old-engine orders ${tally.n}; the order staff kept for the booking found for ${tally.kept} (${tally.survived} the engine's own, ${tally.retyped} retyped by staff)`);
  console.log(`Against what staff kept, what each version fills in:`);
  console.log(`  contact      old engine (always 2257) ${pct(tally.v1Contact, tally.kept)}; rebuild ${pct(tally.v2Contact, tally.kept)}`);
  console.log(`  rate card    old engine ${pct(tally.v1Card, tally.kept)}; rebuild ${pct(tally.v2Card, tally.kept)}; the two disagree on ${tally.cardsDiffer}`);
  console.log(`  name         old engine ${pct(tally.v1Name, tally.kept)}; rebuild ${pct(tally.v2Name, tally.kept)} (leading * ^ # and case ignored)`);
  console.log(`  crew chief   ${tally.chiefs} chiefs on staff's orders: inside the crew shift ${tally.chiefInside}, alone ${tally.chiefAlone}; with the crew-chief role ${tally.chiefFlag}`);
  console.log(`  hidden       ${pct(tally.hidden, tally.slots)} of staff's positions hidden from workers`);
  console.log(`  content      staff booked exactly what the engine's order held on ${pct(tally.sameContent, tally.kept)}`);
  if (process.argv.includes("--cards")) for (const c of cardRows) console.log("   ", c);
  if (process.argv.includes("--names")) for (const c of nameRows) console.log("   ", c);
}

if (process.argv.includes("--write")) {
  const i = process.argv.indexOf("--write");
  const want = Number(process.argv[i + 1]) || 6;
  // One of each kind of booking, so every path through both writers is crossed.
  const kinds: [string, (s: V1Shape) => boolean][] = [
    ["one block of crew", (s) => s.slot_teams.length === 1 && s.slot_teams[0].profession_id === 1],
    ["crew and a chief in one window", (s) => s.slot_teams.length === 2 && s.slot_teams.some((x) => x.profession_id === 36) && new Set(s.slot_teams.map((x) => x.beginning)).size === 1],
    ["two windows, each with a chief", (s) => s.slot_teams.filter((x) => x.profession_id === 36).length >= 2],
    ["several days, crew only", (s) => new Set(s.slot_teams.map((x) => x.beginning.slice(0, 10))).size >= 2 && s.slot_teams.every((x) => x.profession_id === 1)],
    ["a trade beside crew", (s) => s.slot_teams.some((x) => ![1, 36].includes(x.profession_id)) && s.slot_teams.some((x) => x.profession_id === 1)],
    ["a PO on the order", (s) => !!s.intern_name && s.slot_teams.length <= 2],
    ["a trade alone", (s) => s.slot_teams.every((x) => ![1, 36].includes(x.profession_id))],
  ];
  const picked: { kind: string; r: any }[] = [];
  for (const [kind, f] of kinds) { const r = [...records].reverse().find((x) => f(x.shape_sent) && !picked.some((p) => p.r === x)); if (r) picked.push({ kind, r }); }
  const run = Date.now().toString(36);
  let failed = 0;
  const made: number[] = [];
  for (const { kind, r } of picked.slice(0, want)) {
    const s = r.shape_sent as V1Shape;
    console.log(`\n== ${kind}: old engine's R${r.order_number}, ${s.slot_teams.length} block(s)`);
    // The old engine's writer, exactly: its own serialiser, moved to TEST and a year on.
    const v1Shape = { ...s, company_id: TEST, slot_teams: s.slot_teams.map((x) => ({ ...x, ...retime(x.beginning, x.end, 1).window })) };
    const v1 = await client.createOrder(buildOrderBody(v1Shape as any)).catch((e: any) => ({ error: String(e?.message ?? e) })) as any;
    if (v1.error) { console.log(`  old writer FAILED: ${v1.error.slice(0, 200)}`); failed++; continue; }
    made.push(Number(v1.id));
    // The rebuild's writer, exactly: the live runOp, on the same booking.
    const op = opFromV1(s, { company_id: String(TEST), client_email: "accounts@spartancrew.co.uk", years: 1 });
    const expected = contentOfOp(op);
    if (expected.cannot) { console.log(`  rebuild CANNOT: ${expected.cannot}`); failed++; continue; }
    const res = await runOp(`harness-ab-${run}-${picked.indexOf(picked.find((p) => p.r === r)!)}`, op, { testOnly: true });
    const v2id = Number(res.detail?.order_id);
    if (v2id) made.push(v2id);
    console.log(`  rebuild run: ${res.status}${res.reasons.length ? ` (${res.reasons.join("; ").slice(0, 200)})` : ""}`);
    const a = await readOrder(Number(v1.id));
    const b = v2id ? await readOrder(v2id) : null;
    if (!a || !b) { console.log(`  read back FAILED: old ${!!a} new ${!!b}`); failed++; continue; }
    const want1 = contentOfV1(s, 1).join(" ");
    const ca = contentOfOrder(a).join(" "), cb = contentOfOrder(b).join(" ");
    const same = ca === cb && ca === want1;
    console.log(`  booked content: ${same ? "IDENTICAL" : "DIFFERENT"} (${contentOfOrder(a).length} positions)`);
    if (!same) { failed++; console.log(`    asked: ${want1}\n    old:   ${ca}\n    new:   ${cb}`); }
    const ja = ([] as any[]).concat(a.Job ?? [])[0] ?? {}, jb = ([] as any[]).concat(b.Job ?? [])[0] ?? {};
    const fields: [string, unknown, unknown][] = [
      ["company", a.company_id, b.company_id], ["order name", a.name, b.name], ["job name", ja.name, jb.name],
      ["specification", a.specification, b.specification], ["PO (intern_name)", a.intern_name, b.intern_name],
      ["Orders To Confirm (request_approval)", a.request_approval, b.request_approval], ["status", a.status, b.status],
      ["provisional", a.provisional, b.provisional], ["quote", a.quote, b.quote],
      ["order manager", a.order_manager_id, b.order_manager_id], ["contact", a.user_id, b.user_id], ["rate card", ja.pricelist_category_id, jb.pricelist_category_id],
    ];
    for (const [k, x, y] of fields) if (String(x ?? "") !== String(y ?? "")) console.log(`  differs  ${k}: old ${JSON.stringify(x)} | new ${JSON.stringify(y)}`);
    const la = layoutOf(a), lb = layoutOf(b);
    console.log(`  layout   old ${JSON.stringify(la)}\n           new ${JSON.stringify(lb)}`);
    // What must hold whatever else differs.
    if (Number(b.request_approval) !== 1) { failed++; console.log("  FAIL new order is not in Orders To Confirm"); }
    if (Number(b.order_manager_id) !== ORDER_MANAGER_ID) { failed++; console.log("  FAIL new order has no Samurai AI order manager"); }
    if (lb.concept) { failed++; console.log("  FAIL new order has draft (concept) positions"); }
    if (res.status !== "verified") { failed++; console.log("  FAIL the rebuild's own read-back did not verify"); }
  }
  // Both copies of every case go: TEST company, made by the automation, checked gone.
  for (const id of made) {
    const o = rowsOf(await t("GET", `/orders?id[eq]=${id}`))[0];
    if (!o || Number(o.company_id) !== TEST || Number(o.creator) !== 2257) continue;
    await client.deleteOrders([id]);
  }
  const left = (await Promise.all(made.map(async (id) => rowsOf(await t("GET", `/orders?id[eq]=${id}`))[0]))).filter(Boolean).length;
  console.log(`\n${picked.slice(0, want).length} cases, ${failed} failure(s); ${made.length} TEST orders made, ${left} left after clean-up`);
  if (failed || left) process.exitCode = 1;
}
