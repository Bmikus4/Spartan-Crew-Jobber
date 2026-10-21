// The production TV as it stands, read-only (the verifier and the feed's memory are off, so
// nothing is written). `npx tsx --env-file=.env.local harness/sim/tv-snap.mts [out.json]`
import { writeFileSync } from "node:fs";
import { liveFeedDeps } from "../../app/lib/feed/live";
import { serveFeed } from "../../app/lib/feed/serve";
const out = process.argv[2] ?? ".tmp-data/sim/tv_production.json";
const r = await serveFeed({ ...liveFeedDeps(), verify: undefined, remember: undefined, jobs: undefined }, Date.now());
const slim = (c: any) => ({ thread_id: c.thread_id, kinds: c.items.map((i: any) => i.kind), green: c.green, r: c.r_number, j: c.j_number, company: c.company, subject: c.subject, note: c.note, dates: c.dates, order_id: c.order_id, at: c.at, follow_up: c.follow_up });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), counts: r.body.counts, items: (r.body.items as any[]).map(slim), all: (r.all ?? []).map(slim) }));
console.log("saved", (r.body.items as any[]).length, "needs-action cards,", (r.all ?? []).length, "cards in all (the labels' set)");
