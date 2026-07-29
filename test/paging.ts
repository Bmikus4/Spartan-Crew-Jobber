// ============================================================================
// The whole-list pager. This is the code that made the deployed engine die.
// ----------------------------------------------------------------------------
// /places is 69 pages at ~500ms and /companies another 8 at ~1s: over 42 SECONDS
// of paging, sequentially, before the engine reached the model. The Vercel
// function ceiling is 60s, so /api/n8n-inbound returned 504 with no error line -
// it was not failing, it was still paging. Page count is known after page 1, so
// the remaining pages go out concurrently.
//
// What must not regress: every row is still returned, in page order, with a
// bounded number of requests in flight, and the boolean `nextPage` trap stays
// avoided (pagination.nextPage is a BOOLEAN in this API, not a page number - it
// once caused an infinite re-pull).
//
//   npx tsx test/paging.ts
// ============================================================================
import { OnsinchClient, __resetListCache, type Transport } from "../app/lib/engine/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** A fake OnSinch that reports PAGES pages and records concurrency. */
function fakeApi(PAGES: number, rowsPerPage = 100, delayMs = 5) {
  let inFlight = 0;
  let peak = 0;
  const pagesFetched: number[] = [];
  const t: Transport = async (_method, path) => {
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
    pagesFetched.push(page);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, delayMs));
    inFlight--;
    return {
      status: 200,
      data: {
        // ids are globally unique and ascending, so order is checkable
        data: Array.from({ length: rowsPerPage }, (_, i) => ({ id: (page - 1) * rowsPerPage + i + 1, name: `row ${(page - 1) * rowsPerPage + i + 1}` })),
        pagination: { pageCount: PAGES, nextPage: page < PAGES }, // nextPage is a BOOLEAN
      },
    };
  };
  return { t, peak: () => peak, pagesFetched };
}

async function main() {
  console.log("\n[1] a 69-page list (the real /places size)");
  {
    __resetListCache();
    const api = fakeApi(69);
    const rows = await new OnsinchClient(api.t).allPlaces();
    ok(rows.length === 6900, "every row returned", `${rows.length}`);
    ok(new Set(api.pagesFetched).size === 69, "every page fetched exactly once", `${new Set(api.pagesFetched).size} distinct of ${api.pagesFetched.length} requests`);
    ok(api.pagesFetched.length === 69, "no page fetched twice", `${api.pagesFetched.length} requests`);
    ok((rows as any[])[0].id === 1 && (rows as any[])[6899].id === 6900, "page order preserved despite concurrency", `${(rows as any[])[0].id}..${(rows as any[])[6899].id}`);
    ok(api.peak() > 1, "pages actually overlapped (this is the fix)", `peak in flight ${api.peak()}`);
    ok(api.peak() <= 8, "and stayed within the concurrency cap", `peak in flight ${api.peak()}`);
  }

  console.log("\n[2] concurrency is a real speed-up, not just parallel-looking");
  {
    // 40 pages x 50ms: sequential would be >= 2000ms, concurrent ~8 batches.
    __resetListCache();
    const api = fakeApi(40, 10, 50);
    const t0 = Date.now();
    await new OnsinchClient(api.t).allPlaces();
    const took = Date.now() - t0;
    ok(took < 1200, "40 pages of 50ms finished well under the 2000ms a sequential walk needs", `${took}ms`);
  }

  console.log("\n[3] the degenerate cases");
  {
    __resetListCache();
    const one = fakeApi(1);
    const rows = await new OnsinchClient(one.t).allPlaces();
    ok(rows.length === 100, "single page returns its rows", `${rows.length}`);
    ok(one.pagesFetched.length === 1, "and makes exactly one request", `${one.pagesFetched.length}`);
  }
  {
    // pageCount missing entirely -> must not loop, must not throw
    __resetListCache();
    const t: Transport = async () => ({ status: 200, data: { data: [{ id: 1 }], pagination: {} } });
    const rows = await new OnsinchClient(t).allPlaces();
    ok(rows.length === 1, "no pageCount -> treated as one page, no infinite loop", `${rows.length}`);
  }
  {
    // an empty first page
    __resetListCache();
    const t: Transport = async () => ({ status: 200, data: { data: [], pagination: { pageCount: 9 } } });
    const rows = await new OnsinchClient(t).allPlaces();
    ok(rows.length === 0, "empty first page -> nothing, and no further requests");
  }
  {
    // pageCount lies high and later pages come back empty: still terminates,
    // and empties must not become holes in the output.
    __resetListCache();
    const t: Transport = async (_m, path) => {
      const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
      return { status: 200, data: { data: page <= 3 ? [{ id: page }] : [], pagination: { pageCount: 10 } } };
    };
    const rows = await new OnsinchClient(t).allPlaces();
    ok(rows.length === 3, "short list behind an overstated pageCount", `${rows.length}`);
    ok((rows as any[]).map((r) => r.id).join(",") === "1,2,3", "still in page order", (rows as any[]).map((r) => r.id).join(","));
  }

  console.log("\n[4] the cache still holds (a warm lambda must not re-page)");
  {
    __resetListCache();
    const api = fakeApi(5);
    const c = new OnsinchClient(api.t);
    await c.allCompanies();
    const firstCount = api.pagesFetched.length;
    await c.allCompanies();
    ok(api.pagesFetched.length === firstCount, "second call served from cache", `${api.pagesFetched.length} requests total`);
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
