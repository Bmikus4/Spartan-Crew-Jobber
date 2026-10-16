// A link moved off an order stays moved. Until 10-15 the minute backfill re-added a link to every
// order the bot had verified unless that exact thread+order row existed, so a link the sweep had
// moved to staff's rebuild came back pointing at the dead order, was held, and showed on the TV
// as "Order not found in OnSinch" (9 of 11 held links). Both halves are pinned in the source:
// links.ts and live.ts talk to the database, which this suite does not run.
//
// Offline.  npx tsx test/linksNoResurrect.ts
import { readFileSync } from "node:fs";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const links = readFileSync("app/lib/v2/links.ts", "utf8");
const backfill = links.slice(links.indexOf("export async function backfillLinks"), links.indexOf("export type SweepReport"));
ok(/SELECT 1 FROM job_links WHERE thread_id = \$\{r\.thread_id\}`/.test(backfill), "backfill adds a link only to a thread that has none");
ok(!/WHERE thread_id = \$\{r\.thread_id\} AND order_id/.test(backfill), "and never by the thread+order pair, which resurrects a moved link");

const live = readFileSync("app/lib/feed/live.ts", "utf8");
const held = live.slice(live.indexOf("async function held"), live.indexOf("export function liveFeedDeps"));
ok(/NOT EXISTS \(SELECT 1 FROM job_links o WHERE o\.thread_id = l\.thread_id AND o\.state IN \('linked', 'relinked'\)\)/.test(held), "a held link is no TV card while its thread has a live one");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
