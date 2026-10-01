// ============================================================================
// A FAKE ONSINCH TENANT, MUTABLE, WITH A CALL LOG AND FAULT INJECTION.
// ----------------------------------------------------------------------------
// WHY THIS AND NOT A STUB EXECUTOR. The audit's question is what the ENGINE does
// end to end, and a stub `Executor` answers a different one: it replaces
// createOrderWithPlace, amendOrderInPlace, replaceProvisionalOrder and the whole
// OnsinchClient with a promise that resolves. Everything those files decide —
// whether a company is created, whether a block is appended or patched, whether a
// rebuild refuses — is then decided by the fixture rather than measured.
//
// So the seam is moved down to the only place the real system has one: `Transport`,
// the (method, path, body) function at the bottom of onsinch.ts. Above it runs
// production code, unmodified, including deps.ts's own `executor()`. Below it is
// this file, which holds rows instead of calling a server.
//
// WHAT IT IS FAITHFUL TO, and each of these was read off the live probes recorded
// in onsinch.ts / reconcile.ts rather than invented:
//
//   - every write is an ARRAY, even for one item; PATCH answers 204 with no body
//   - `POST /orders` answers `{ data: [{ id }] }` and NOTHING else — no number, no
//     nested Job id, no slot-team ids. Both numbers cost a second read.
//   - an order created through the API logs ONE childless `order_created_via_api`
//     audit row, so `slotTeamsForOrder` returns no teams for it. An order raised in
//     the UI logs `order_create` plus one `common_create` per SlotTeam, and its
//     teams ARE readable. That asymmetry is the whole reason the amendment path has
//     two routes, so the fake has to reproduce it or the audit tests one route twice.
//   - an unstaffed block is invisible: `/attendance` returns a row per assigned SEAT,
//     so a block nobody is on produces nothing at all.
//   - `Job.min_beginning`/`max_end` are NOT recomputed when blocks change. Measured
//     on reference order #16317, 2026-09-29 (ticket S-0018). `windowRecomputes` flips
//     it so the audit can measure what that invariant is worth either way.
//   - `PATCH /slotTeams` with `size: 0` is a 400; there is no delete.
//   - pagination is `{ count, pageCount, nextPage }` where nextPage is a BOOLEAN.
//
// WHAT IT IS DELIBERATELY NOT. It does not model OnSinch's validation beyond the
// rules above, so a body this accepts is not proof the real tenant would. Every
// claim in the report that rests on "OnSinch accepted it" is marked as such.
// ============================================================================
import type { Transport } from "../app/lib/engine/onsinch";

export interface CompanyRow {
  id: number;
  name: string;
  invoice_name?: string;
  Client?: Array<{ id: number; email: string; name: string }>;
}
export interface PlaceRow {
  id: number;
  name?: string;
  address?: string;
  city?: string;
  zip?: string;
  country?: string;
  lat?: number;
  lng?: number;
  active?: boolean;
  alias?: string;
}
export interface TeamRow {
  id: number;
  order_id: number;
  job_id: number;
  name: string;
  profession_id: number;
  beginning: string;
  end: string;
  size: number;
  place_id: number;
  description?: string;
}
export interface OrderRow {
  id: number;
  number: string;
  name: string;
  company_id: number;
  user_id: number;
  request_approval?: string;
  specification?: string;
  intern_name?: string;
  order_manager_id?: number;
  created: string;
  /** `provisional`/`quote` are read off a live order by orderPreflight; never written. */
  provisional?: boolean;
  quote?: boolean;
  status?: string;
  job: { id: number; name: string; pricelist_category_id: number; min_beginning?: string; max_end?: string };
  /** Raised through the API by this engine (childless audit row) or by hand in the UI. */
  origin: "api" | "ui";
}
export interface AttendanceRow {
  id: number;
  order_id: number;
  slotteam_id: number;
  slotlocation_id: number;
}
interface AuditRow {
  id: number;
  action: string;
  data: string;
}

export interface Fault {
  /** Which calls this applies to. */
  match: (method: string, path: string) => boolean;
  /** How many matching calls to affect. Default 1. */
  times?: number;
  /** `status` answers with a code; `throw` is a dropped connection or a timeout. */
  mode: "status" | "throw";
  status?: number;
  data?: unknown;
  message?: string;
  /** Apply the write anyway, then answer with the fault — the "it landed, the answer was lost" case. */
  applyAnyway?: boolean;
}

export interface TenantOptions {
  /** Does the job window follow its blocks? Measured FALSE on the live tenant. */
  windowRecomputes?: boolean;
  /**
   * DOES A STANDALONE `POST /slotTeams` LEAVE A `common_create` AUDIT ROW?
   *
   * NOBODY HAS PROBED THIS, and the answer decides whether a lost POST response
   * duplicates a crew block. `slotTeamsForOrder` is the only way a block's id is ever
   * read back; if an appended block leaves a row, a retry finds it and pairs to it, and
   * if it does not, the retry appends a second one.
   *
   * What IS measured (onsinch.ts §12, deps.ts) is the ORDER create: one childless
   * `order_created_via_api` row and no per-child rows. That says nothing about this call.
   *
   * Default false — the pessimistic reading — and the audit reports the finding under
   * BOTH settings rather than picking one and calling it measured.
   */
  auditsAppendedBlocks?: boolean;
}

export class FakeTenant {
  companies: CompanyRow[] = [];
  places: PlaceRow[] = [];
  users: Array<{ id: number; email: string; name: string }> = [];
  orders: OrderRow[] = [];
  teams: TeamRow[] = [];
  attendance: AttendanceRow[] = [];
  audits: AuditRow[] = [];

  calls: Array<{ method: string; path: string; body?: unknown }> = [];
  faults: Fault[] = [];

  private seq = { company: 500, place: 8000, order: 15000, job: 20000, team: 40000, audit: 1, attend: 90000, user: 2000, rnumber: 10500 };
  private readonly opts: TenantOptions;

  constructor(opts: TenantOptions = {}) {
    this.opts = { windowRecomputes: false, auditsAppendedBlocks: false, ...opts };
  }

  // -- fixtures --------------------------------------------------------------

  addCompany(name: string, clients: Array<{ email: string; name?: string }> = [], over: Partial<CompanyRow> = {}): CompanyRow {
    const row: CompanyRow = {
      id: ++this.seq.company,
      name,
      invoice_name: name,
      Client: clients.map((c) => ({ id: ++this.seq.user, email: c.email, name: c.name ?? "Contact" })),
      ...over,
    };
    this.companies.push(row);
    return row;
  }

  addPlace(p: Partial<PlaceRow> & { name: string }): PlaceRow {
    const row: PlaceRow = { id: ++this.seq.place, country: "GB", active: true, ...p };
    this.places.push(row);
    return row;
  }

  /**
   * An order raised BY HAND in the OnSinch UI: its slot teams are readable through the
   * audit log, which is what separates it from one this engine posted.
   */
  addHandRaisedOrder(o: {
    company_id: number;
    name: string;
    blocks: Array<{ name?: string; size: number; profession_id?: number; place_id: number; beginning: string; end: string }>;
    pricelist_category_id?: number;
    specification?: string;
    intern_name?: string;
    created?: string;
  }): OrderRow {
    const id = ++this.seq.order;
    const job_id = ++this.seq.job;
    const row: OrderRow = {
      id,
      number: String(++this.seq.rnumber),
      name: o.name,
      company_id: o.company_id,
      user_id: 2257,
      created: o.created ?? new Date().toISOString(),
      specification: o.specification,
      intern_name: o.intern_name,
      job: { id: job_id, name: o.name, pricelist_category_id: o.pricelist_category_id ?? 315 },
      origin: "ui",
    };
    this.orders.push(row);
    const made: TeamRow[] = [];
    for (const b of o.blocks) {
      const t: TeamRow = {
        id: ++this.seq.team,
        order_id: id,
        job_id,
        name: b.name ?? "General",
        profession_id: b.profession_id ?? 1,
        beginning: b.beginning,
        end: b.end,
        size: b.size,
        place_id: b.place_id,
      };
      this.teams.push(t);
      made.push(t);
    }
    this.recomputeWindow(id, true);
    // The UI audit trail: one order_create plus one common_create per block.
    this.audits.push({
      id: ++this.seq.audit,
      action: "order_create",
      data: JSON.stringify({
        id,
        name: row.name,
        data: { path: `Order:${id}\\/Job:${job_id}`, number: row.number },
        created: { SlotTeam: made.length },
      }),
    });
    for (const t of made) {
      this.audits.push({
        id: ++this.seq.audit,
        action: "common_create",
        model: "SlotTeam",
        data: JSON.stringify({
          id: t.id,
          name: t.name,
          model: "SlotTeam",
          data: { path: `Order:${id}\\/Job:${job_id}\\/SlotTeam:${t.id}` },
        }),
      } as AuditRow);
    }
    return row;
  }

  /** Put crew on a block, which is the only thing that makes it readable back. */
  staff(order_id: number, slotteam_id: number, people = 1): void {
    for (let i = 0; i < people; i++) {
      this.attendance.push({
        id: ++this.seq.attend,
        order_id,
        slotteam_id,
        // A SlotLocation id, NOT a place id — a different id space (reconcile.ts).
        slotlocation_id: 16000 + (slotteam_id % 1000),
      });
    }
  }

  teamsOf(order_id: number): TeamRow[] {
    return this.teams.filter((t) => t.order_id === order_id);
  }
  order(id: number): OrderRow | undefined {
    return this.orders.find((o) => o.id === id);
  }
  /** Every crew seat this tenant holds for a client, however many orders it took. */
  crewFor(company_id: number): number {
    return this.orders
      .filter((o) => o.company_id === company_id)
      .flatMap((o) => this.teamsOf(o.id))
      .reduce((n, t) => n + t.size, 0);
  }

  countCalls(re: RegExp, method?: string): number {
    return this.calls.filter((c) => re.test(c.path) && (!method || c.method === method)).length;
  }

  // -- internals -------------------------------------------------------------

  private recomputeWindow(order_id: number, force = false): void {
    if (!force && !this.opts.windowRecomputes) return;
    const o = this.order(order_id);
    if (!o) return;
    const ts = this.teamsOf(order_id);
    if (!ts.length) return;
    const b = ts.map((t) => t.beginning).sort();
    const e = ts.map((t) => t.end).sort();
    o.job.min_beginning = b[0];
    o.job.max_end = e[e.length - 1];
  }

  private page<T>(rows: T[], q: URLSearchParams): { status: number; data: unknown } {
    const limit = Math.max(1, Number(q.get("limit")) || 100);
    const page = Math.max(1, Number(q.get("page")) || 1);
    const pageCount = Math.max(1, Math.ceil(rows.length / limit));
    const slice = rows.slice((page - 1) * limit, page * limit);
    return {
      status: 200,
      data: { data: slice, pagination: { count: rows.length, pageCount, nextPage: page < pageCount } },
    };
  }

  private num(q: URLSearchParams, ...keys: string[]): number | null {
    for (const k of keys) {
      const v = q.get(k);
      if (v !== null && v !== "" && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  }

  private fault(method: string, path: string): Fault | null {
    for (const f of this.faults) {
      if ((f.times ?? 1) <= 0) continue;
      if (!f.match(method, path)) continue;
      f.times = (f.times ?? 1) - 1;
      return f;
    }
    return null;
  }

  /** The seam. Hand this to `new OnsinchClient(tenant.transport)`. */
  transport: Transport = async (method, path, body) => {
    this.calls.push({ method, path, body });
    const f = this.fault(method, path);
    if (f && !f.applyAnyway) {
      if (f.mode === "throw") throw new Error(f.message ?? `OnSinch ${method} ${path} timed out`);
      return { status: f.status ?? 500, data: f.data ?? null };
    }
    const answer = this.handle(method, path, body);
    if (f && f.applyAnyway) {
      if (f.mode === "throw") throw new Error(f.message ?? `OnSinch ${method} ${path} timed out`);
      return { status: f.status ?? 500, data: f.data ?? null };
    }
    return answer;
  };

  private handle(method: string, rawPath: string, body: unknown): { status: number; data: any } {
    const [base, query = ""] = rawPath.split("?");
    const q = new URLSearchParams(query);

    if (base === "/users/profile") return { status: 200, data: { data: [{ id: 2257, email: "ben@samuraisolutions.co.uk" }] } };

    // ---- companies ---------------------------------------------------------
    if (base === "/companies" && method === "GET") {
      const wantClient = (q.get("with") ?? "").includes("Client");
      const id = this.num(q, "id", "id[eq]");
      let rows = this.companies;
      if (id !== null) rows = rows.filter((c) => c.id === id);
      const name = q.get("name[eq]");
      if (name) rows = rows.filter((c) => c.name === name);
      return this.page(
        rows.map((c) => (wantClient ? c : { ...c, Client: undefined })),
        q
      );
    }
    if (base === "/companies" && method === "POST") {
      const b = (body as any[])?.[0] ?? {};
      if (!String(b.name ?? "").trim()) return { status: 400, data: { validationErrors: { name: ["Fill in name"] } } };
      for (const k of ["address", "city", "zip", "country", "email_invoice"]) {
        if (!String(b[k] ?? "").trim()) return { status: 400, data: { "0": [`Missing required properties: ${k}`] } };
      }
      const row: CompanyRow = { id: ++this.seq.company, name: String(b.name), invoice_name: String(b.name), Client: [] };
      this.companies.push(row);
      return { status: 201, data: { data: [{ id: row.id, name: row.name }] } };
    }

    // ---- places ------------------------------------------------------------
    if (base === "/places" && method === "GET") {
      const id = this.num(q, "id", "id[eq]");
      let rows = this.places;
      if (id !== null) rows = rows.filter((p) => p.id === id);
      return this.page(rows, q);
    }
    if (base === "/places" && method === "POST") {
      const b = (body as any[])?.[0] ?? {};
      if (!String(b.name ?? "").trim()) return { status: 400, data: { validationErrors: { name: ["Fill in name"] } } };
      const row: PlaceRow = { id: ++this.seq.place, active: true, ...b };
      this.places.push(row);
      return { status: 201, data: { data: [row] } };
    }
    if (base === "/places" && method === "PATCH") {
      for (const p of (body as any[]) ?? []) {
        const row = this.places.find((x) => x.id === Number(p.id));
        if (row) Object.assign(row, p);
      }
      return { status: 204, data: null };
    }

    // ---- users -------------------------------------------------------------
    if (base === "/users" && method === "GET") return this.page(this.users, q);

    // ---- orders ------------------------------------------------------------
    if (base === "/orders" && method === "GET") {
      const wantJob = (q.get("with") ?? "").includes("Job");
      let rows = this.orders;
      const id = this.num(q, "id", "id[eq]");
      if (id !== null) rows = rows.filter((o) => o.id === id);
      const co = this.num(q, "company_id", "company_id[eq]");
      if (co !== null) rows = rows.filter((o) => o.company_id === co);
      const name = q.get("name[eq]");
      if (name !== null) rows = rows.filter((o) => o.name === name);
      return this.page(
        rows.map((o) => {
          const { job, origin, ...rest } = o;
          return { ...rest, happening: job.min_beginning, ...(wantJob ? { Job: [job] } : {}) };
        }),
        q
      );
    }
    if (base === "/orders" && method === "POST") {
      const b = (body as any[])?.[0] ?? {};
      const teams = (b.SlotTeam ?? []) as any[];
      if (!teams.length) return { status: 400, data: { validationErrors: { SlotTeam: ["Please fill the SlotTeam for this Order"] } } };
      for (const t of teams) {
        if (String(t.name ?? "").length > 80)
          return { status: 400, data: { "0": { SlotTeam: { "0": { name: ["Name is too long, maximum is 80 characters."] } } } } };
        if (!Number.isInteger(Number(t.place_id)) || Number(t.place_id) <= 0)
          return { status: 400, data: { validationErrors: { SlotTeam: ["place_id is required"] } } };
        if (!Number.isInteger(Number(t.size)) || Number(t.size) < 1)
          return { status: 400, data: { validationErrors: { SlotTeam: ["At least one staff member for the shift is needed"] } } };
      }
      if (String(b.Job?.name ?? "").length > 80)
        return { status: 400, data: { "0": { Job: { name: ["Name is too long, maximum is 80 characters."] } } } };
      if (!Number.isInteger(Number(b.company_id)) || Number(b.company_id) <= 0)
        return { status: 400, data: { validationErrors: { company_id: ["Fill in company"] } } };
      if (!this.companies.some((c) => c.id === Number(b.company_id)))
        return { status: 400, data: { validationErrors: { company_id: ["No such company"] } } };

      const id = ++this.seq.order;
      const job_id = ++this.seq.job;
      const row: OrderRow = {
        id,
        number: String(++this.seq.rnumber),
        name: String(b.name ?? ""),
        company_id: Number(b.company_id),
        user_id: Number(b.user_id),
        request_approval: b.request_approval ? "1" : undefined,
        specification: b.specification,
        intern_name: b.intern_name,
        order_manager_id: b.order_manager_id,
        created: new Date().toISOString(),
        provisional: false,
        quote: false,
        job: { id: job_id, name: String(b.Job?.name ?? ""), pricelist_category_id: Number(b.Job?.pricelist_category_id ?? 0) },
        origin: "api",
      };
      this.orders.push(row);
      for (const t of teams) {
        this.teams.push({
          id: ++this.seq.team,
          order_id: id,
          job_id,
          name: String(t.name ?? ""),
          profession_id: Number(t.profession_id ?? 1),
          beginning: String(t.beginning),
          end: String(t.end),
          size: Number(t.size),
          place_id: Number(t.place_id),
          description: t.description,
        });
      }
      this.recomputeWindow(id, true); // the window IS set at create; it is changes it ignores
      // ONE childless row. This is what makes slotTeamsForOrder empty for engine orders.
      this.audits.push({
        id: ++this.seq.audit,
        action: "order_created_via_api",
        data: JSON.stringify({ id, created: { Order: 1, Job: 1, SlotTeam: teams.length, Slot: teams.length } }),
      });
      // `{"id":13744}` and nothing else — no number, no Job id.
      return { status: 201, data: { data: [{ id }] } };
    }
    if (base === "/orders" && method === "PATCH") {
      for (const p of (body as any[]) ?? []) {
        const o = this.order(Number(p.id));
        if (!o) return { status: 404, data: null };
        for (const [k, v] of Object.entries(p)) {
          if (k === "id") continue;
          // OnSinch stores specification through a rich-text field.
          (o as any)[k] = k === "specification" ? `<p>${String(v).replace(/&/g, "&amp;").replace(/>/g, "&gt;")}</p>\n` : v;
        }
      }
      return { status: 204, data: null };
    }
    if (base === "/orders" && method === "DELETE") {
      const ids = (body as number[]) ?? [];
      for (const id of ids) {
        this.orders = this.orders.filter((o) => o.id !== Number(id));
        this.teams = this.teams.filter((t) => t.order_id !== Number(id));
        this.attendance = this.attendance.filter((a) => a.order_id !== Number(id));
      }
      return { status: 200, data: null };
    }

    // ---- slot teams --------------------------------------------------------
    if (base === "/slotTeams" && method === "POST") {
      const b = (body as any[])?.[0] ?? {};
      const job_id = Number(b.job_id);
      const owner = this.orders.find((o) => o.job.id === job_id);
      if (!owner) return { status: 400, data: { validationErrors: { job_id: ["No such job"] } } };
      if (String(b.name ?? "").length > 80)
        return { status: 400, data: { "0": { name: ["Name is too long, maximum is 80 characters."] } } };
      const t: TeamRow = {
        id: ++this.seq.team,
        order_id: owner.id,
        job_id,
        name: String(b.name ?? ""),
        profession_id: Number(b.profession_id ?? 1),
        beginning: String(b.beginning),
        end: String(b.end),
        size: Number(b.size),
        place_id: Number(b.place_id),
        description: b.description,
      };
      this.teams.push(t);
      this.recomputeWindow(owner.id);
      if (this.opts.auditsAppendedBlocks) {
        this.audits.push({
          id: ++this.seq.audit,
          action: "common_create",
          data: JSON.stringify({
            id: t.id,
            name: t.name,
            model: "SlotTeam",
            data: { path: `Order:${owner.id}\\/Job:${job_id}\\/SlotTeam:${t.id}` },
          }),
        });
      }
      return { status: 201, data: { data: [{ id: t.id }] } };
    }
    if (base === "/slotTeams" && method === "PATCH") {
      for (const p of (body as any[]) ?? []) {
        const t = this.teams.find((x) => x.id === Number(p.id));
        if (!t) return { status: 404, data: { validationErrors: { id: ["No such slot team"] } } };
        if (p.size !== undefined && Number(p.size) < 1)
          return { status: 400, data: { validationErrors: { size: ["At least one staff member for the shift is needed"] } } };
        Object.assign(t, p);
        this.recomputeWindow(t.order_id);
      }
      return { status: 204, data: null };
    }

    // ---- jobs --------------------------------------------------------------
    if (base === "/jobs" && method === "PATCH") {
      for (const p of (body as any[]) ?? []) {
        const o = this.orders.find((x) => x.job.id === Number(p.id));
        if (o) Object.assign(o.job, p);
      }
      return { status: 204, data: null };
    }

    // ---- attendance --------------------------------------------------------
    if (base === "/attendance" && method === "GET") {
      const order_id = this.num(q, "Order__id");
      const rows = this.attendance.filter((a) => order_id === null || a.order_id === order_id);
      const teamOf = (id: number) => this.teams.find((t) => t.id === id);
      return this.page(
        rows.map((a) => {
          const t = teamOf(a.slotteam_id);
          return {
            id: a.id,
            Order: [{ id: a.order_id }],
            SlotTeam: [{ id: a.slotteam_id, name: t?.name ?? "" }],
            Slot: [
              {
                slotteam_id: a.slotteam_id,
                size: t?.size,
                profession_id: t?.profession_id,
                slotlocation_id: a.slotlocation_id,
                // Echoed in UTC, as the live tenant does — the audit's own BST trap.
                beginning: t ? new Date(Date.parse(t.beginning)).toISOString() : undefined,
                end: t ? new Date(Date.parse(t.end)).toISOString() : undefined,
              },
            ],
          };
        }),
        q
      );
    }

    // ---- audit log ---------------------------------------------------------
    if (base === "/timelineAudits" && method === "GET") {
      let rows: AuditRow[] = this.audits;
      const action = q.get("action");
      if (action) rows = rows.filter((r) => r.action === action);
      const like = q.get("data[like]");
      if (like) {
        const needle = like.replace(/%/g, "");
        rows = rows.filter((r) => r.data.includes(needle));
      }
      return this.page(rows, q);
    }

    return { status: 200, data: { data: [], pagination: { count: 0, pageCount: 0, nextPage: false } } };
  }
}
