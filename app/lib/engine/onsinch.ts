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
  return async (method, path, body) => {
    const res = await fetch(cfg.baseUrl + path, {
      method,
      headers: {
        Authorization: `apikey ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
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
async function listAllCached(key: string, fetchAll: () => Promise<any[]>): Promise<any[]> {
  const c = _listCache.get(key);
  if (c && Date.now() - c.t < LIST_TTL_MS) return c.v;
  const v = await fetchAll();
  _listCache.set(key, { t: Date.now(), v });
  return v;
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
    return r.data?.data?.[0] as PlaceCandidate;
  }

  async searchUsers(filters: Record<string, string | number>) {
    const r = await this.t("GET", "/users" + qs(filters));
    return (r.data?.data ?? []) as any[];
  }

  async getOrders(filters: Record<string, string | number>) {
    const r = await this.t("GET", "/orders" + qs({ ...filters, with: "Job" }));
    return (r.data?.data ?? []) as any[];
  }

  /** POST /orders — array body, expect 201 { data:[{id,number,...}] }. */
  async createOrder(body: OnsinchOrderBody[]) {
    const r = await this.t("POST", "/orders", body);
    if (r.status !== 201)
      throw new Error(
        `createOrder ${r.status}: ${JSON.stringify(r.data?.validationErrors ?? r.data)}`
      );
    return r.data.data[0] as { id: number; number: string };
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
    const out: any[] = [];
    let page = 1;
    let pageCount = 1;
    for (;;) {
      const r = await this.t("GET", path + qs({ ...filters, limit: 100, page }));
      const data = (r.data?.data ?? []) as any[];
      out.push(...data);
      const pg = r.data?.pagination ?? {};
      pageCount = Number.isInteger(pg.pageCount) ? pg.pageCount : pageCount;
      if (!data.length || page >= pageCount) break;
      page++;
    }
    return out;
  }

  /** All companies (for exact-match dedup). ~756 today. Cached (warm lambda). */
  async allCompanies() {
    return listAllCached("companies", () => this.listAll("/companies"));
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
    return r.data.data[0] as { id: number; name?: string };
  }
}
