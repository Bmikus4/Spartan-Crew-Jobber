// ============================================================================
// onsinch — typed client for the OnSinch Public API.
// Faithful to Spartan-Crew-Onsinch-API-Reference.md:
//   - auth header is literally `Authorization: apikey <KEY>` (NOT Bearer)
//   - every write is an ARRAY, even for one item
//   - PATCH returns 204 with no body (don't .json() it)
//   - filters: ?<field>[<op>]=<value> ; nested: Company__name= ; embed: ?with=
//   - always filter/paginate reads
// The transport is injectable so the compiler can be tested offline.
// ============================================================================
import type { PlaceCandidate } from "./types";
import type { OnsinchOrderBody, OnsinchSlotTeamBody } from "./format";

export type Transport = (
  method: string,
  path: string,
  body?: unknown
) => Promise<{ status: number; data: any }>;

export interface OnsinchConfig {
  baseUrl: string; // e.g. https://spartancrew.onsinch.com/api/v1
  apiKey: string;
}

/** Real fetch transport. `apikey ` prefix is mandatory. */
export function httpTransport(cfg: OnsinchConfig): Transport {
  // A call with no deadline is the worst failure mode we have: the serverless
  // invocation dies at 60s having logged nothing, and because the n8n workflow
  // strips the Gmail label before the engine is reached, that email is simply
  // gone. Better to fail one request loudly and fast.
  const TIMEOUT_MS = Number(process.env.ONSINCH_TIMEOUT_MS || 12_000);
  /**
   * ONSINCH 500s UNDER CONCURRENT LOAD, AND A 500 USED TO LOSE THE BOOKING.
   *
   * Measured 2026-08-25 on TEST 515. 106 cases at concurrency 4: `POST /orders` returned
   * 500 fifteen times out of 86 creates — 17%. The same cases at concurrency 1: 25 of 25
   * succeeded, zero 500s. C012, C015, C019, C024 and C028 each failed in the first run
   * and passed in the second with a byte-identical payload, so it is not the body.
   *
   * No factor separated the failures — sizes 2 to 40, every venue, one to three blocks —
   * and the largest orders in the run (16 blocks, 218 crew) all succeeded. It is load.
   *
   * There was no retry anywhere in this client, so each 500 was a silently lost booking:
   * the thread went to `error` and nothing reached OnSinch. A burst of enquiries arriving
   * together is exactly when this fires and exactly when it costs most.
   *
   * ONLY IDEMPOTENT-ON-FAILURE CALLS ARE RETRIED. A 500 means the server did not tell us
   * what it did, so a retried POST could double-create. Two facts make it safe here:
   * `POST /orders` now carries an EMPTY SlotTeam array (id custody), so a duplicate would
   * be an empty order rather than a duplicate booking; and every duplicate is visible to
   * the caller's ledger. `POST /slotTeams` is NOT retried — it is the one non-idempotent
   * call in the engine (see amendOrder.ts) and a retry there appends a second crew block.
   *
   * The budget is deliberately small. The whole pipeline runs inside n8n's 60s ceiling
   * and this transport already has a 12s per-request timeout, so two retries at 400ms and
   * 1200ms is the most that fits without turning a slow failure into a timeout — which is
   * the worse failure, because the email's Gmail label is already gone by then.
   */
  const RETRY_BACKOFF_MS = [400, 1200];
  const retriable = (method: string, path: string, status: number) =>
    status >= 500 && status !== 501 && !(method === "POST" && path.startsWith("/slotTeams"));

  const once = async (method: string, path: string, body: unknown) => {
    let res: Response;
    try {
      res = await fetch(cfg.baseUrl + path, {
        method,
        headers: {
          Authorization: `apikey ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
      throw new Error(`OnSinch ${method} ${path} ${timedOut ? `timed out after ${TIMEOUT_MS}ms` : `failed: ${(err as Error)?.message}`}`);
    }
    // PATCH -> 204 no body
    if (res.status === 204) return { status: 204, data: null };
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };

  return async (method, path, body) => {
    let last = await once(method, path, body);
    for (const wait of RETRY_BACKOFF_MS) {
      if (!retriable(method, path, last.status)) return last;
      await new Promise((r) => setTimeout(r, wait));
      last = await once(method, path, body);
    }
    return last;
  };
}

// Warm-lambda cache for the big whole-list pulls (companies/places). A full
// places pull is ~68 pages; without this we'd repeat it on every email. Short
// TTL so newly-created entities show up quickly.
const _listCache = new Map<string, { t: number; v: any[] }>();
const LIST_TTL_MS = 5 * 60 * 1000;
/**
 * Drop the warm-lambda list cache. Test-only: the cache is module-global and
 * keyed by list name, so without this every case after the first in test/paging.ts
 * silently asserts against the first case's rows.
 */
export function __resetListCache(): void {
  _listCache.clear();
}

async function listAllCached(key: string, fetchAll: () => Promise<any[]>): Promise<any[]> {
  const c = _listCache.get(key);
  if (c && Date.now() - c.t < LIST_TTL_MS) return c.v;
  const v = await fetchAll();
  _listCache.set(key, { t: Date.now(), v });
  return v;
}

/**
 * Put a just-created record into the warm list, so the very next lookup in this
 * process finds it instead of the stale pull it was created against.
 *
 * Ben, 2026-08-09, on creating companies and venues: "You must make sure that in
 * cases where a location must be created or a company must be created, that they
 * will be found the NEXT time that name is used."
 *
 * Without this the cache holds a 5-minute-old list that predates the create, so two
 * enquiries from the same new client inside five minutes each miss, each create, and
 * the tenant gains a duplicate company — the exact failure the whole-list exact-match
 * dedup exists to prevent. This is the same-process half of that guarantee; the
 * durable half is the alias store, which survives a cold lambda.
 *
 * A no-op when nothing has been pulled yet: with no cached list there is nothing
 * stale to correct, and the next pull reads the record from OnSinch anyway.
 */
function cacheAppend(key: string, record: unknown): void {
  const c = _listCache.get(key);
  if (!c) return;
  c.v = [...c.v, record];
}

function qs(filters: Record<string, string | number>): string {
  const parts = Object.entries(filters).map(
    ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
  );
  return parts.length ? "?" + parts.join("&") : "";
}

export class OnsinchClient {
  constructor(private t: Transport) {}

  /** Token health check — GET /users/profile. */
  async profile() {
    return this.t("GET", "/users/profile");
  }

  async searchCompanies(filters: Record<string, string | number>) {
    const r = await this.t("GET", "/companies" + qs(filters));
    return (r.data?.data ?? []) as any[];
  }

  async searchPlaces(filters: Record<string, string | number>) {
    const r = await this.t("GET", "/places" + qs(filters));
    return (r.data?.data ?? []) as PlaceCandidate[];
  }

  /** POST /places — must include country (only required field). */
  async createPlace(place: Partial<PlaceCandidate> & { country: string }) {
    const r = await this.t("POST", "/places", [place]);
    const created = r.data?.data?.[0] as PlaceCandidate;
    // Findable immediately, not in five minutes when the cache expires.
    if (created?.id) cacheAppend("places", { ...place, ...created });
    return created;
  }

  async searchUsers(filters: Record<string, string | number>) {
    const r = await this.t("GET", "/users" + qs(filters));
    return (r.data?.data ?? []) as any[];
  }

  async getOrders(filters: Record<string, string | number>) {
    const r = await this.t("GET", "/orders" + qs({ ...filters, with: "Job" }));
    return (r.data?.data ?? []) as any[];
  }

  /**
   * POST /orders — array body, expect 201 `{ data: [{ id }] }`.
   *
   * `number` IS OPTIONAL AND IN PRACTICE ABSENT. Probed live 2026-08-19: the response
   * body is `{"id":13744}` and nothing else, while a GET on that same id returns
   * `number: "10638"`. The R number is assigned at creation and is simply not handed
   * back, so anything that wants it has to read the order again — which is what the
   * identifier read-back after a create is for. Typed as present, it silently wrote
   * `undefined` into the one field a human searches OnSinch on.
   */
  async createOrder(body: OnsinchOrderBody[]) {
    const r = await this.t("POST", "/orders", body);
    if (r.status !== 201)
      throw new Error(
        `createOrder ${r.status}: ${JSON.stringify(r.data?.validationErrors ?? r.data)}`
      );
    return r.data.data[0] as { id: number; number?: string };
  }

  /**
   * One order, by id, with its Job. Used before a destructive write to check what is
   * actually there rather than trusting our own stored copy of it — the stored copy is
   * what we wrote weeks ago, and a human may have approved, edited or already deleted
   * the order since.
   */
  async orderById(id: number) {
    const rows = await this.getOrders({ id });
    return (rows.find((o) => Number(o?.id) === Number(id)) ?? null) as
      | (Record<string, unknown> & { id: number; provisional?: boolean; quote?: boolean; company_id?: number; status?: string })
      | null;
  }

  /**
   * How many crew are signed on to an order — the number of Attendance rows hanging
   * off its slots.
   *
   * THE GATE THAT WAS MISSING. `provisional` was the only thing standing between an
   * amendment and a destructive rebuild, on the reasoning that a draft is nobody's
   * booking yet. It is not: measured on the live tenant 2026-08-19, 18 of the 40 most
   * recent provisional orders already had crew assigned, one of them 94 people. A
   * rebuild detaches every one of them — the replacement's slots are new and empty —
   * so the crew think they are working and the job thinks it is unstaffed.
   *
   * There is no `order_id` filter on Attendance, so the Order relation is joined and
   * filtered through: `?with=Order&Order__id=`. Probed live; this is also the only
   * route by which an order's slot team ids are readable at all.
   */
  async attendanceCount(order_id: number): Promise<number> {
    const r = await this.t("GET", "/attendance" + qs({ limit: 1, with: "Order", Order__id: order_id }));
    const n = r.data?.pagination?.count;
    return Number.isFinite(Number(n)) ? Number(n) : 0;
  }

  /**
   * How many crew are signed on to EACH slot team, not just the order.
   *
   * The order-level count is enough to refuse a rebuild; it is not enough to amend one.
   * The one write in this API nobody has tested is shrinking a team that already has
   * crew on it, and a per-order count cannot tell a shrink of the empty block from a
   * shrink of the staffed one. `?with=SlotTeam` puts the team on every attendance row,
   * so the same read that gates the rebuild also says which team each person is on.
   *
   * Pages, because an order with 94 people on it exists and page 1 would have quietly
   * reported the first 100 of them as the whole truth.
   */
  async attendanceByTeam(order_id: number): Promise<Map<number, number>> {
    const rows = await this.listAll("/attendance", { with: "SlotTeam,Order", Order__id: order_id });
    const out = new Map<number, number>();
    for (const r of rows) {
      const st = Array.isArray(r?.SlotTeam) ? r.SlotTeam[0] : r?.SlotTeam;
      const id = Number(st?.id);
      if (!Number.isInteger(id)) continue;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }

  /**
   * EVERY SLOT TEAM ID ON AN ORDER, READ BACK. This one call is what makes amending an
   * order possible at all, and it took until 2026-08-23 to find.
   *
   * `POST /orders` returns the order id and nothing else — not the nested job's id, not
   * its slot teams' — and there is no `GET /slotTeams`. So a team created inside a create
   * could never be addressed again, and `PATCH /slotTeams`, which works and accepts every
   * field the engine sets, had nothing to aim at. That is the whole reason a crew change
   * had to delete the order and post it again.
   *
   * The audit log has it. Every create writes rows carrying the full ancestry path:
   *
   *   common_create | SlotTeam  {"id":"35499","name":"General",
   *                              "data":{"path":"Order:13784\/Job:14064\/SlotTeam:35499"}}
   *
   * Verified live against orders from three different months, raised both by this engine
   * (`creator: null`) and by hand in the UI (`creator: <user id>`), back to the tenant's
   * first order in 2023.
   *
   * THREE PROPERTIES OF THE QUERY, each of which cost a probe:
   *
   *  - `data[cont]` is a 400. `data[like]` with `%…%` is the operator that works.
   *  - The path is stored with ESCAPED slashes (`Order:13784\/Job:…`), so a LIKE pattern
   *    containing `/` matches nothing at all — and answers 200 with an empty list, which
   *    reads exactly like "this order has no teams". Filter on the order id alone and
   *    parse the path here.
   *  - `%Order:138%` also matches orders 1380 and 13800, so every row is re-checked
   *    against the order id after it comes back. The filter narrows; it does not decide.
   *
   * Returns creation order — the order the teams were nested in the create — because that
   * is the correspondence the amendment relies on. See amendOrder.ts.
   */
  async slotTeamsForOrder(order_id: number): Promise<{
    job_id?: number;
    order_number?: string;
    teams: Array<{ id: number; name: string }>;
    /** What `order_create` said it made. Absent on an order raised in the UI. */
    created_count?: number;
  }> {
    const id = Number(order_id);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error(`slotTeamsForOrder: ${order_id} is not an order id`);
    const rows = await this.listAll("/timelineAudits", { "data[like]": `%Order:${id}%` });
    const teams: Array<{ id: number; name: string }> = [];
    const seen = new Set<number>();
    let job_id: number | undefined;
    let order_number: string | undefined;
    let created_count: number | undefined;
    // Audit ids ascend with time, so creation order is id order. Sorted explicitly: the
    // pages come back concurrently, and the whole value of this read is the ORDER.
    for (const row of [...rows].sort((a, b) => Number(a?.id) - Number(b?.id))) {
      let payload: any;
      try {
        payload = typeof row?.data === "string" ? JSON.parse(row.data) : row?.data;
      } catch {
        continue; // one unreadable audit row is not a reason to report no teams
      }
      const path = String(payload?.data?.path ?? "").replace(/\\\//g, "/");
      const owner = /^Order:(\d+)(?:\/|$)/.exec(path);
      if (!owner || Number(owner[1]) !== id) continue; // the LIKE filter's false matches
      const job = /\/Job:(\d+)/.exec(path);
      if (job) job_id = Number(job[1]);
      if (row.action === "order_create") {
        // The R number is inside `data`, alongside the path — NOT at the top of the
        // payload, where `id` and `name` are. Read from the wrong level it is silently
        // undefined, which reads as "this order has no R number".
        if (payload?.data?.number != null) order_number = String(payload.data.number);
        if (Number.isInteger(payload?.created?.SlotTeam)) created_count = Number(payload.created.SlotTeam);
      }
      /**
       * Only a SlotTeam's OWN create row counts. A Slot's path also names its team
       * (`…/SlotTeam:35499/Slot:51890`), so matching on the path alone reports a team
       * once per person it holds — and the count is what the amendment checks its
       * correspondence against.
       */
      if (row.action !== "common_create" || payload?.model !== "SlotTeam") continue;
      const own = /\/SlotTeam:(\d+)$/.exec(path);
      if (!own) continue;
      const teamId = Number(payload.id ?? own[1]);
      if (!Number.isInteger(teamId) || seen.has(teamId)) continue;
      seen.add(teamId);
      teams.push({ id: teamId, name: String(payload.name ?? "") });
    }
    return { job_id, order_number, teams, created_count };
  }

  /**
   * POST /slotTeams — add a team to an existing job. Returns the id, which is the only
   * route by which a team's id is known at the moment it is created.
   *
   * Sent ONE AT A TIME on purpose. The array form is accepted, but a create that 400s on
   * the third team says nothing about the first two, and this runs against an order that
   * already exists: a partial add has to be knowable rather than inferred, because the
   * caller has to persist each id before sending the next. See amendOrder.ts.
   */
  async createSlotTeam(body: OnsinchSlotTeamBody): Promise<{ id: number }> {
    const r = await this.t("POST", "/slotTeams", [body]);
    if (r.status !== 201)
      throw new Error(
        `createSlotTeam ${r.status}: ${JSON.stringify(r.data?.validationErrors ?? r.data)}`
      );
    const id = Number(r.data?.data?.[0]?.id);
    if (!Number.isInteger(id))
      throw new Error(`createSlotTeam: OnSinch returned no id for "${body.name}" — ${JSON.stringify(r.data)}`);
    return { id };
  }

  /**
   * PATCH /slotTeams — 204, no body. Editable: size, beginning, end, profession_id,
   * place_id, name, description, admin_note, client_note, crewboss_description, hidden,
   * applicant_size, featured, request_approval.
   *
   * `size: 0` is refused (`400 "At least one staff member for the shift is needed"`) and
   * there is no delete, so a team's floor is 1 and dropping a block cannot be expressed
   * here at all. Refused before sending rather than after: the 400 arrives once the
   * earlier patches in the same array have already landed, which is a half-applied
   * amendment nobody asked for.
   */
  async patchSlotTeams(patches: Array<{ id: number } & Record<string, unknown>>) {
    if (!patches.length) return true;
    for (const p of patches) {
      if (!Number.isInteger(Number(p.id)) || Number(p.id) <= 0)
        throw new Error(`patchSlotTeams: ${JSON.stringify(p)} carries no slot team id`);
      if (p.size !== undefined && (!Number.isInteger(Number(p.size)) || Number(p.size) < 1))
        throw new Error(
          `patchSlotTeams: size ${String(p.size)} on team ${p.id} — OnSinch's floor is 1 and there is no delete`
        );
    }
    const r = await this.t("PATCH", "/slotTeams", patches);
    if (r.status !== 204 && r.status !== 200)
      throw new Error(`patchSlotTeams ${r.status}: ${JSON.stringify(r.data?.validationErrors ?? r.data)}`);
    return true;
  }

  /**
   * PATCH /jobs — 204, no body. `pricelist_category_id` is the only rate handle the
   * API exposes, so this is the sole route by which a wrong rate card on an existing
   * order can be corrected at all. Verified live: 197 -> 311, read back.
   *
   * DELIBERATELY UNCALLED. On an order that already exists the rate card in OnSinch is
   * the one being invoiced against and ours is inferred from the enquiry text, so the
   * engine writing it would replace a fact with a guess — silently, since a 204 says
   * nothing about what the field held before. It exists so a human correcting a known
   * mistake has a route; giving the pipeline that route is a separate decision.
   */
  async patchJob(patches: Array<{ id: number } & Record<string, unknown>>) {
    if (!patches.length) return true;
    for (const p of patches) {
      if (!Number.isInteger(Number(p.id)) || Number(p.id) <= 0)
        throw new Error(`patchJob: ${JSON.stringify(p)} carries no job id`);
      if (Object.keys(p).length < 2)
        throw new Error(`patchJob: job ${p.id} carries no fields to change`);
    }
    const r = await this.t("PATCH", "/jobs", patches);
    if (r.status !== 204 && r.status !== 200)
      throw new Error(`patchJob ${r.status}: ${JSON.stringify(r.data?.validationErrors ?? r.data)}`);
    return true;
  }

  /**
   * DELETE /orders — array of ids at the tag root. Deleting an order cascades to its
   * job and slot teams, which is what makes replace-by-recreate viable at all.
   *
   * The signature takes ids and nothing else on purpose: there is no filter form here,
   * so no call site can accidentally express "delete the orders matching X" and be one
   * typo away from emptying a tenant. An empty array is refused rather than sent, since
   * what an empty DELETE body means to this API is not documented and not worth finding
   * out on production data.
   */
  async deleteOrders(ids: number[]) {
    const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!clean.length) throw new Error("deleteOrders called with no valid ids — refusing to send");
    if (clean.length !== ids.length) throw new Error(`deleteOrders got a non-id in ${JSON.stringify(ids)} — refusing to send`);
    const r = await this.t("DELETE", "/orders", clean);
    if (r.status !== 200 && r.status !== 204)
      throw new Error(`deleteOrders ${r.status}: ${JSON.stringify(r.data)}`);
    return true;
  }

  /**
   * DELETE /places — ids only, by the same rule as deleteOrders.
   *
   * Exists for ONE caller: the corpus harness, undoing the venues its own run
   * provisioned. The engine itself never deletes a place, and it must not start —
   * a venue row is shared by every order that ever pointed at it, and there is no
   * way to know from here which of those still matter.
   */
  async deletePlaces(ids: number[]) {
    const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!clean.length) throw new Error("deletePlaces called with no valid ids — refusing to send");
    if (clean.length !== ids.length) throw new Error(`deletePlaces got a non-id in ${JSON.stringify(ids)} — refusing to send`);
    const r = await this.t("DELETE", "/places", clean);
    if (r.status !== 200 && r.status !== 204)
      throw new Error(`deletePlaces ${r.status}: ${JSON.stringify(r.data)}`);
    return true;
  }

  /** PATCH /orders — array w/ id, returns 204 no body. */
  async patchOrder(patch: Array<{ id: number } & Record<string, unknown>>) {
    const r = await this.t("PATCH", "/orders", patch);
    if (r.status !== 204 && r.status !== 200)
      throw new Error(`patchOrder ${r.status}: ${JSON.stringify(r.data)}`);
    return true;
  }

  // --- Tool 2: pull-all + create (search is limited/non-fuzzy, so we page the
  // whole list and exact-match client-side; then create when genuinely new) ---

  /**
   * Page through every record of a list endpoint. NOTE: OnSinch's
   * `pagination.nextPage` is a BOOLEAN, not a page number — we drive the loop
   * off the integer `pageCount` (this exact bug caused an infinite re-pull in
   * the rate study).
   */
  private async listAll(
    path: string,
    filters: Record<string, string | number> = {}
  ): Promise<any[]> {
    const get = async (page: number) => {
      const r = await this.t("GET", path + qs({ ...filters, limit: 100, page }));
      return { data: (r.data?.data ?? []) as any[], pagination: r.data?.pagination ?? {} };
    };

    // Page 1 tells us how many there are.
    const first = await get(1);
    const pageCount = Number.isInteger(first.pagination.pageCount) ? first.pagination.pageCount : 1;
    if (!first.data.length || pageCount <= 1) return first.data;

    // The rest go out CONCURRENTLY. Sequentially, /places is 69 pages at ~500ms
    // = ~35s, and /companies another ~8s: over 42s of paging before the engine
    // has even called the model. That is what made /api/n8n-inbound die at
    // exactly 60s with no error line - it was not failing, it was still paging.
    // Page count is known after page 1, so there is no reason to walk them.
    // Capped so a 69-page pull cannot open 69 sockets at once against a client's
    // production OnSinch.
    const CONCURRENCY = 8;
    const rest: any[][] = new Array(pageCount - 1);
    let next = 2;
    const worker = async () => {
      for (;;) {
        const page = next++;
        if (page > pageCount) return;
        rest[page - 2] = (await get(page)).data;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pageCount - 1) }, worker));

    // Reassembled in page order: the resolver's exact-match is order-independent,
    // but anything that reads "the first match" must not depend on which socket
    // came back first.
    return first.data.concat(...rest.map((p) => p ?? []));
  }

  /**
   * All companies, WITH their contacts. ~763 today. Cached (warm lambda).
   *
   * `with=Client` is free: the same 8 pages, 3.3 seconds measured against the live
   * tenant, and it brings back the 1,274 contact addresses that let a sender's
   * email domain identify the client. Without it the resolver can only compare a
   * company name read out of prose, which is the one thing about an email that can
   * be phrased differently every time.
   */
  async allCompanies() {
    return listAllCached("companies", () => this.listAll("/companies", { with: "Client" }));
  }

  /** All places (for exact-match dedup). ~6.8k today. Cached — a full pull is
   * ~68 pages, far too slow to repeat per email. */
  async allPlaces() {
    return listAllCached("places", () => this.listAll("/places")) as Promise<PlaceCandidate[]>;
  }

  /** A company's Client contacts (the valid user_ids for its orders). */
  async companyClients(company_id: number): Promise<any[]> {
    const r = await this.t("GET", "/companies" + qs({ id: company_id, with: "Client" }));
    return (r.data?.data?.[0]?.Client ?? []) as any[];
  }

  /** A company's existing orders (with Job) — the order-dedup source. */
  async companyOrdersWithJob(company_id: number) {
    return this.listAll("/orders", { company_id, with: "Job" });
  }

  /** POST /companies — array body, 201 { data:[{id}] }. name is the min field. */
  /**
   * CREATING A COMPANY NEEDS SIX FIELDS, AND THIS SENT ONE.
   *
   * `POST /companies` answers
   * `400 {"0":["Missing required properties: address, city, zip, country, email_invoice,
   * status"]}` to a body carrying only a name — which is all this ever sent. So creating
   * a client has never worked, on any code path, since the method was written.
   *
   * It stayed invisible because a brand-new company always had an assumed rate card, an
   * assumed rate card always held the booking, and a held booking never reached the
   * write. Removing that hold on 2026-08-27 made the call happen for the first time, and
   * two live test enquiries died on it — "Spectra Events Ltd." and "Innovate UK Events",
   * both otherwise correct.
   *
   * THE DEFAULTS ARE FILLED HERE rather than at the call site, so no future caller can
   * reintroduce a company OnSinch will refuse. A caller that knows better overrides them.
   *
   * Established without creating anything, by sending the full field set with a
   * deliberately invalid `status`: the error moved from "Missing required properties" to
   * "status: Incorrect type", which proves the rest of the payload was accepted. A
   * company cannot be deleted through this API, so a probe that created one would have
   * been permanent.
   *
   * WHAT THE BLANKS MEAN. An enquiry gives a client's NAME and rarely their registered
   * address, so address/city/zip go out empty — accepted, and honest. Inventing a
   * placeholder address would put fiction on an invoice. `country` is GB because Spartan
   * books UK crew, `status: 1` is active, and `email_invoice` is the sender's own address
   * when the caller supplies it, which is the one field here that is real information.
   */
  async createCompany(company: { name: string } & Record<string, unknown>) {
    const body = {
      address: "",
      city: "",
      zip: "",
      country: "GB",
      email_invoice: "",
      status: 1,
      ...company,
    };
    const r = await this.t("POST", "/companies", [body]);
    if (r.status !== 201)
      throw new Error(
        `createCompany ${r.status}: ${JSON.stringify(r.data?.validationErrors ?? r.data)}`
      );
    const created = r.data.data[0] as { id: number; name?: string };
    // Findable immediately: the list this company was judged absent from was pulled
    // before it existed, and would otherwise say so for another five minutes.
    if (created?.id) cacheAppend("companies", { ...company, ...created });
    return created;
  }
}
