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
import type { PlaceCandidate } from "./types.js";
import type { OnsinchOrderBody } from "./format.js";

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
}
