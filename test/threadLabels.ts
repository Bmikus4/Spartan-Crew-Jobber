// Gmail labels from the TV's cards (Ben, 10-15): exclusive order labels, nothing once a card is ticked or seen
// resolved. Worn since 19 Nov: Order Needs Updated, and Order Needs Created while its Settings toggle is on (applied
// by serve.ts before this). Needs Follow Up was removed (19 Nov).
//
// Offline.  npx tsx test/threadLabels.ts
import { labelsFor, changes, labelsRefusedAlarm, ORDER_LABELS, SHOWN_LABELS } from "../app/lib/mail/threadLabels";
import { fingerprint } from "../app/lib/errorReport";
import type { FeedCard, FeedItem } from "../app/lib/feed/project";
import { readFileSync } from "node:fs";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const item = (kind: FeedItem["kind"], green = false): FeedItem => ({ item_key: `${kind}:x`, kind, status: "", at: 0, green: green ? { mark: "checked", by: null, evidence: null, at: 0 } : null } as FeedItem);
const card = (thread_id: string, items: FeedItem[], over: Partial<FeedCard> = {}): FeedCard => ({ thread_id, items, green: items.every((i) => !!i.green), r_number: null, ...over } as unknown as FeedCard);

ok([...SHOWN_LABELS].sort().join() === "Order Needs Created,Order Needs Updated", "Gmail is given Needs Updated and Needs Created, nothing else");
ok(labelsFor(card("b", [item("needs-updated"), item("created-check")])).order === "Order Needs Updated", "a need to update wears Order Needs Updated");
ok(labelsFor(card("f", [item("needs-created")])).order === "Order Needs Created", "a need to create wears Order Needs Created");
ok(labelsFor(card("h", [item("needs-created"), item("needs-updated")])).order === "Order Needs Created", "a thread needing both wears one label, the create first, as the TV leads with it");
ok(labelsFor(card("a", [item("created-check")])).order === null && labelsFor(card("u", [item("updated-check")])).order === null, "the bot's own Order Created and Order Updated are not worn (O53)");
ok(labelsFor(card("c", [item("needs-updated", true)])).order === null, "ticked: no label at all (Ben: confirmed orders lose all their tags)");
ok(!("follow_up" in labelsFor(card("g", [item("needs-updated")]))), "no follow-up axis: Needs Follow Up was removed (19 Nov)");

const all = [...ORDER_LABELS];
const tl = (thread_id: string, order: (typeof ORDER_LABELS)[number] | null) => ({ thread_id, order, r_number: null });
const now = [tl("a", "Order Needs Updated"), tl("e", null)];
const first = changes(now, new Map());
ok(first.length === 2 && first[0].add.join() === "Order Needs Updated" && first[0].remove.length === all.length - 1, "first sight: the one label on, every other of ours off", first[0]);
ok(first[1].add.length === 0 && first[1].remove.length === all.length, "a thread given no label has every label of ours taken off", first[1]);
const steady = changes(now, new Map([["a", { order: "Order Needs Updated" }], ["e", { order: null }]]));
ok(steady.length === 0, "nothing changed: nothing is sent to Gmail");
const gone = changes([tl("e", null)], new Map([["a", { order: "Order Created" }], ["e", { order: null }]]));
ok(gone.length === 1 && gone[0].thread_id === "a" && gone[0].add.length === 0 && gone[0].remove.length === all.length, "a thread that left the TV loses every label of ours", gone);
// The route forgets a thread Gmail refused, so the next minute sends it again (10-16: 9 of 29
// refused on the first live run). Pinned in the source: the route talks to the database.
const route = readFileSync("app/api/bot/labels/route.ts", "utf8");
ok(/body\.mode === "failed"/.test(route) && /DELETE FROM thread_labels WHERE thread_id = ANY/.test(route), "a refused thread is forgotten and resent next minute");
const n8n = readFileSync("scripts/_labelNodes.mjs", "utf8");
ok(/batchSize: 5/.test(n8n) && /"Label thread": \{ main: \[\[to\("Refused threads"\)\]\] \}/.test(n8n), "n8n writes 5 threads at a time and reports the refused ones");
ok(new Set(ORDER_LABELS).size === 4, "four order labels (CLAUDE.md)");

// One broken credential is one error_reports row: 3-17 Nov it was 34, one per refused count.
const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const a5 = labelsRefusedAlarm(ids(5)), a37 = labelsRefusedAlarm(ids(37));
ok(labelsRefusedAlarm(ids(4)) === null, "under the line: a thread's own trouble, no alarm");
ok(!!a5 && !!a37 && fingerprint("bot/labels", a5.what) === fingerprint("bot/labels", a37.what), "5 refused and 37 refused are the same alarm", [a5, a37]);
ok(!!a37 && a37.detail.startsWith("37 threads refused"), "the count is kept, in the detail", a37);
ok(/const alarm = labelsRefusedAlarm\(failed\)/.test(route) && /\.\.\.alarm/.test(route), "the route raises exactly that alarm");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
