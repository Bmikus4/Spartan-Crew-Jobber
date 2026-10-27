// ============================================================================
// The one way the rebuild reads a list from OnSinch.
// ----------------------------------------------------------------------------
// Two facts about the API were known and written down, and still re-broken call site by call
// site, because each call built its own query and read its own answer:
//   a failed read is not an empty one   the transport hands back {status: 500, data: null}
//                                       rather than throwing, and reading rows off that turned
//                                       a blip into "no contacts" (the stand-in contact and the
//                                       house card on a real order) or "order gone" (a held link)
//   /orders lists newest first          and `sort=-id` reverses it: documented 09-02, then put
//                                       into the create path and the minute sync on 10-13, which
//                                       priced every new order on the client's oldest card
// So a list is read here or not at all; test/createParity.ts holds the rebuild to that.
// ============================================================================
import type { Transport } from "../onsinch/onsinch";

export const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);

export async function readRows(t: Transport, path: string): Promise<any[]> {
  if (/[?&]sort=/.test(path)) throw new Error(`refusing ${path.split("?")[0]} with sort=: /orders is newest first by default, and sort= has reversed it`);
  const r = await t("GET", path);
  if (r.status < 200 || r.status >= 300) throw new Error(`GET ${path.split("?")[0]} answered ${r.status}, so what it holds is unknown`);
  return rowsOf(r);
}

/** The same, with the answer's pagination, for the callers that page. */
export async function readPage(t: Transport, path: string): Promise<{ rows: any[]; pageCount: number; count: number }> {
  if (/[?&]sort=/.test(path)) throw new Error(`refusing ${path.split("?")[0]} with sort=`);
  const r = await t("GET", path);
  if (r.status < 200 || r.status >= 300) throw new Error(`GET ${path.split("?")[0]} answered ${r.status}, so what it holds is unknown`);
  return { rows: rowsOf(r), pageCount: Number(r?.data?.pagination?.pageCount) || 0, count: Number(r?.data?.pagination?.count) || 0 };
}
