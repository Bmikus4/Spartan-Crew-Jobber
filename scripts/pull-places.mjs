// Pull the whole /places list to .tmp-data/places.json so the venue-duplication
// work can be measured offline. A full pull is ~69 pages; every later pass reads
// the file instead of the tenant.
//
// Run: node scripts/pull-places.mjs [--refresh]
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./_env.mjs";

loadEnv();

const OUT = path.join(".tmp-data", "places.json");
const BASE = process.env.ONSINCH_BASE_URL;
const KEY = process.env.ONSINCH_API_KEY;
if (!BASE || !KEY) throw new Error("ONSINCH_BASE_URL / ONSINCH_API_KEY missing");

if (fs.existsSync(OUT) && !process.argv.includes("--refresh")) {
  const n = JSON.parse(fs.readFileSync(OUT, "utf8")).length;
  console.log(`${OUT} already holds ${n} places — pass --refresh to re-pull`);
  process.exit(0);
}

const get = async (page) => {
  const res = await fetch(`${BASE}/places?limit=100&page=${page}`, {
    headers: { Authorization: `apikey ${KEY}` },
  });
  if (!res.ok) throw new Error(`GET /places page ${page} -> ${res.status}`);
  const j = await res.json();
  return { data: j?.data ?? [], pageCount: Number(j?.pagination?.pageCount) || 1 };
};

const first = await get(1);
const all = [...first.data];
const CONCURRENCY = 8;
let next = 2;
const worker = async () => {
  for (;;) {
    const page = next++;
    if (page > first.pageCount) return;
    const r = await get(page);
    all.push(...r.data);
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

fs.mkdirSync(".tmp-data", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
console.log(`${all.length} places over ${first.pageCount} pages -> ${OUT}`);
