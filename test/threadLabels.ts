// Gmail labels from the TV's cards (Ben, 10-15): four exclusive order labels, Needs Follow Up
// beside them, and nothing at all once a card is ticked or seen resolved.
//
// Offline.  npx tsx test/threadLabels.ts
import { labelsFor, changes, labelsRefusedAlarm, ORDER_LABELS, FOLLOW_UP, SHOWN_LABELS } from "../app/lib/mail/threadLabels";
import { fingerprint } from "../app/lib/errorReport";
import type { FeedCard, FeedItem } from "../app/lib/feed/project";
import { readFileSync } from "node:fs";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const item = (kind: FeedItem["kind"], green = false): FeedItem => ({ item_key: `${kind}:x`, kind, status: "", at: 0, green: green ? { mark: "checked", by: null, evidence: null, at: 0 } : null } as FeedItem);
const card = (thread_id: string, items: FeedItem[], over: Partial<FeedCard> = {}): FeedCard => ({ thread_id, items, green: items.every((i) => !!i.green), follow_up: false, r_number: null, ...over } as unknown as FeedCard);

// O53 (Ben, 19 Nov): "Only needs updated, in Gmail and the Dashboard", for now.
ok([...SHOWN_LABELS].join() === "Order Needs Updated", "Gmail is given one label only: Order Needs Updated");
ok(labelsFor(card("b", [item("needs-updated"), item("created-check")])).order === "Order Needs Updated", "a need to update wears Order Needs Updated");
ok(labelsFor(card("h", [item("needs-created"), item("needs-updated")])).order === "Order Needs Updated", "a thread needing a create and an update wears Needs Updated: the hidden label never hides the shown one");
const nc = labelsFor(card("f", [item("needs-created")], { follow_up: true }));
ok(nc.order === null && !nc.follow_up, "no Order Needs Created and no Needs Follow Up", nc);
const nu = labelsFor(card("g", [item("needs-updated")], { follow_up: true }));
ok(nu.order === "Order Needs Updated" && !nu.follow_up, "a need to update that also waits for a follow-up wears Needs Updated alone", nu);
ok(labelsFor(card("a", [item("created-check")])).order === null && labelsFor(card("u", [item("updated-check")])).order === null, "the bot's own Order Created and Order Updated are not worn either");
ok(labelsFor(card("c", [item("needs-updated", true)])).order === null, "ticked: no label at all (Ben: confirmed orders lose all their tags)");

const all = [...ORDER_LABELS, FOLLOW_UP];
const tl = (thread_id: string, order: (typeof ORDER_LABELS)[number] | null, follow_up = false) => ({ thread_id, order, follow_up, r_number: null });
const now = [tl("a", "Order Needs Updated"), tl("e", null)];
const first = changes(now, new Map());
ok(first.length === 2 && first[0].add.join() === "Order Needs Updated" && first[0].remove.length === all.length - 1, "first sight: the one label on, every other of ours off", first[0]);
ok(first[1].add.length === 0 && first[1].remove.length === all.length, "a thread given no label has every label of ours taken off", first[1]);
const steady = changes(now, new Map([["a", { order: "Order Needs Updated", follow_up: false }], ["e", { order: null, follow_up: false }]]));
ok(steady.length === 0, "nothing changed: nothing is sent to Gmail");
const before = changes([tl("e", null)], new Map([["e", { order: "Order Needs Created", follow_up: true }]]));
ok(before.length === 1 && !before[0].add.length && before[0].remove.includes("Order Needs Created") && before[0].remove.includes(FOLLOW_UP), "a thread wearing Needs Created and Needs Follow Up from before loses both at the next sync", before);
const gone = changes([tl("e", null)], new Map([["a", { order: "Order Created", follow_up: false }], ["e", { order: null, follow_up: false }]]));
ok(gone.length === 1 && gone[0].thread_id === "a" && gone[0].add.length === 0 && gone[0].remove.length === all.length, "a thread that left the TV loses every label of ours", gone);
// The route forgets a thread Gmail refused, so the next minute sends it again (10-16: 9 of 29
// refused on the first live run). Pinned in the source: the route talks to the database.
const route = readFileSync("app/api/bot/labels/route.ts", "utf8");
ok(/body\.mode === "failed"/.test(route) && /DELETE FROM thread_labels WHERE thread_id = ANY/.test(route), "a refused thread is forgotten and resent next minute");
const n8n = readFileSync("scripts/_labelNodes.mjs", "utf8");
ok(/batchSize: 5/.test(n8n) && /"Label thread": \{ main: \[\[to\("Refused threads"\)\]\] \}/.test(n8n), "n8n writes 5 threads at a time and reports the refused ones");
ok(new Set(ORDER_LABELS).size === 4 && !ORDER_LABELS.includes(FOLLOW_UP as any), "four order labels, and follow-up is not one of them (CLAUDE.md)");

// One broken credential is one error_reports row: 3-17 Nov it was 34, one per refused count.
const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const a5 = labelsRefusedAlarm(ids(5)), a37 = labelsRefusedAlarm(ids(37));
ok(labelsRefusedAlarm(ids(4)) === null, "under the line: a thread's own trouble, no alarm");
ok(!!a5 && !!a37 && fingerprint("bot/labels", a5.what) === fingerprint("bot/labels", a37.what), "5 refused and 37 refused are the same alarm", [a5, a37]);
ok(!!a37 && a37.detail.startsWith("37 threads refused"), "the count is kept, in the detail", a37);
ok(/const alarm = labelsRefusedAlarm\(failed\)/.test(route) && /\.\.\.alarm/.test(route), "the route raises exactly that alarm");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
