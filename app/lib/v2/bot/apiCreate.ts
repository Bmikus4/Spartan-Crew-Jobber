// ============================================================================
// A new order, created where ops confirm it: Orders To Confirm.
// ----------------------------------------------------------------------------
// ONLY AN API CREATE WITH request_approval REACHES ORDERS TO CONFIRM (measured 10-13 on TEST
// R11533-R11535). The staff wizard's PUBLISH JOB files the order under Opened orders, and its
// GraphQL input rejects a requestApproval field outright; the To Confirm list
// (/admin/orders/toApprove) stayed at 0 for both. The old engine measured the same lever on
// 09-29 (#16315 with request_approval false never appeared).
//
// The API gives each shift ONE position, of the shift's profession, so the order is made with
// each shift's plain crew, and every other position (the crew chief inside the shift, a
// carpenter, an AV tech) is added afterwards through the builder, as staff shape it: a chief
// in his own block was what made ops re-type all 86 of the old engine's orders.
//
// Filled from what OnSinch already knows, never left blank:
//   client contact  the sender when they are a contact of the company, else the contact on the
//                   client's most recent staff-made order, else the company's first contact
//   rate card       the card on the client's most recent staff-made order, else 355: the card
//                   staff gave 16 of the last 18 brand-new clients (companies 852-872, measured
//                   10-15; 341 before 09-16). Only staff's orders count, so a card the bot ever
//                   got wrong can never be copied onto the next order.
//   positions       hidden from workers, as on 634 of the last 785 staff orders
//   order manager   Samurai AI (2257) on every order, as the old engine stamped it (Ben,
//                   2026-08-25: "fill it, leave the contact alone"), so staff can tell an
//                   automation-built order from theirs at a glance. The rebuild dropped it
//                   until the create parity harness (scripts/create-ab.mts) caught it on 10-15.
// ============================================================================
import { httpTransport, OnsinchClient } from "../../engine/onsinch";
import { shiftWindow, type Op } from "./ops";

type CreateOp = Extract<Op, { kind: "create_order" }>;
const HOUSE_CARD = 355;
export const ORDER_MANAGER_ID = Number(process.env.SPARTAN_ORDER_MANAGER_ID || 2257);
const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);

export type ApiCreated = { order_id: number; number: string; client_user_id: string; contact_from: string; card: number; card_from: string };

function api() {
  const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
  return { t, client: new OnsinchClient(t) };
}

/** The contact and rate card a new order for this client gets, and where each came from. */
/** `beforeId` asks the same question as it stood before that order existed (the parity harness's replay). */
export async function clientDefaults(companyId: number, senderEmail: string, beforeId?: number): Promise<{ user_id: string; contact_from: string; card: number; card_from: string }> {
  const { t } = api();
  const company = rowsOf(await t("GET", `/companies?id[eq]=${companyId}&with=Client`))[0];
  const contacts = ([] as any[]).concat(company?.Client ?? []).filter((c) => c && !c.deleted);
  // /orders lists newest first by default, and `sort=-id` turns that into OLDEST first: with it
  // here every bot order on 10-13/14 took the client's oldest card (Event Concept 42 where staff
  // use 354, EMS 97 where staff use 323), caught by scripts/create-ab.mts on 10-15.
  const latest = rowsOf(await t("GET", `/orders?company_id[eq]=${companyId}${beforeId ? `&id[lt]=${beforeId}` : ""}&with=Job&limit=20`))
    .filter((o) => Number(o.creator) !== ORDER_MANAGER_ID)
    .sort((a, b) => Number(b.id) - Number(a.id));
  const sender = contacts.find((c) => String(c.email ?? "").trim().toLowerCase() === senderEmail.trim().toLowerCase());
  const lastUser = latest.map((o) => String(o.user_id)).find((u) => contacts.some((c) => String(c.id) === u));
  const user_id = sender ? String(sender.id) : lastUser ?? (contacts[0] ? String(contacts[0].id) : "");
  const contact_from = sender ? "sender" : lastUser ? "the client's last order" : contacts[0] ? "the company's first contact" : "none";
  const lastCard = latest.map((o) => Number(([] as any[]).concat(o.Job ?? [])[0]?.pricelist_category_id)).find((n) => n > 0);
  return { user_id, contact_from, card: lastCard ?? HOUSE_CARD, card_from: lastCard ? "the client's last order" : "house card" };
}

/**
 * The position the API creates each shift with: its plain crew, else its first position that
 * is not a crew chief (a shift of carpenters alone). The rest is added by the builder.
 */
export function firstRow(s: CreateOp["shifts"][number]) {
  return s.positions.find((p) => p.profession_id === "1" && !p.role) ?? s.positions.find((p) => !p.role) ?? null;
}

/** The create body: each shift with its first position, every position hidden, approval asked. */
export function createBody(op: CreateOp, d: { user_id: string; card: number }): any[] {
  const teams = op.shifts.map((s, i) => {
    const row = firstRow(s);
    if (!row) throw new Error(`shift ${i}: only a crew chief, no position to make the shift with`);
    const w = shiftWindow(s.date, s.start, s.end);
    return { name: s.name, profession_id: Number(row.profession_id), beginning: w.beginning, end: w.end, size: row.size, place_id: Number(s.place_id), hidden: true, ...(s.description ? { description: s.description } : {}) };
  });
  return [{
    name: op.job_name, company_id: Number(op.company_id), user_id: Number(d.user_id), order_manager_id: ORDER_MANAGER_ID, request_approval: true,
    ...(op.po ? { intern_name: op.po } : {}), ...(op.specification ? { specification: op.specification } : {}),
    Job: { name: op.job_name, pricelist_category_id: d.card },
    SlotTeam: teams,
  }];
}

/** Ben's own account: the stand-in contact on an order whose client has none yet (09-29: intentional). */
const PLACEHOLDER_CONTACT = "2257";

export async function apiCreateOrder(op: CreateOp): Promise<ApiCreated> {
  const { client, t } = api();
  // A new client ("new:<name>"): found again first (a second email may have made it), else made.
  if (op.company_id.startsWith("new:")) {
    const name = op.company_id.slice(4).trim();
    const domain = op.client_email.split("@")[1]?.toLowerCase() ?? "";
    const existing = (await client.allCompanies().catch(() => [] as any[])).find((c: any) =>
      String(c.name ?? "").trim().toLowerCase() === name.toLowerCase() || ([] as any[]).concat(c.Client ?? []).some((u: any) => String(u.email ?? "").toLowerCase().endsWith("@" + domain) && domain && !/gmail|hotmail|outlook|yahoo|icloud|live\./.test(domain)));
    op.company_id = String(existing ? existing.id : (await client.createCompany({ name, email_invoice: op.client_email })).id);
  }
  const d = await clientDefaults(Number(op.company_id), op.client_email);
  if (!d.user_id) { d.user_id = PLACEHOLDER_CONTACT; d.contact_from = "Ben (stand-in: the client has no contact in OnSinch yet)"; }
  // A venue OnSinch does not hold ("new:<the words as written>") is added first, named as
  // written and with those words as its address, as ops add one.
  const made_places = new Map<string, string>();
  for (const s of op.shifts) {
    if (!s.place_id.startsWith("new:")) continue;
    if (!made_places.has(s.place_id)) {
      const words = s.place_id.slice(4);
      const p = await client.createPlace({ name: s.place_label || words.split(",")[0], address: words } as any);
      made_places.set(s.place_id, String((p as any).id));
    }
    s.place_id = made_places.get(s.place_id)!;
  }
  const made = await client.createOrder(createBody(op, d));
  const id = Number((made as any).id);
  const number = (made as any).number ?? rowsOf(await t("GET", `/orders?id[eq]=${id}`))[0]?.number;
  return { order_id: id, number: String(number ?? ""), client_user_id: d.user_id, contact_from: d.contact_from, card: d.card, card_from: d.card_from };
}
