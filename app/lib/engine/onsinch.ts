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
import type { OnsinchOrderBody } from "./format";

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
  return async (method, path, body) => {
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
  async createCompany(company: { name: string } & Record<string, unknown>) {
    const r = await this.t("POST", "/companies", [company]);
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
