// Gmail labels from the TV's cards (Ben, 10-15): four exclusive order labels, Needs Follow Up
// beside them, and nothing at all once a card is ticked or seen resolved.
//
// Offline.  npx tsx test/threadLabels.ts
import { labelsFor, changes, ORDER_LABELS, FOLLOW_UP } from "../app/lib/mail/threadLabels";
import type { FeedCard, FeedItem } from "../app/lib/feed/project";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const item = (kind: FeedItem["kind"], green = false): FeedItem => ({ item_key: `${kind}:x`, kind, status: "", at: 0, green: green ? { mark: "checked", by: null, evidence: null, at: 0 } : null } as FeedItem);
const card = (thread_id: string, items: FeedItem[], over: Partial<FeedCard> = {}): FeedCard => ({ thread_id, items, green: items.every((i) => !!i.green), follow_up: false, r_number: null, ...over } as unknown as FeedCard);

ok(labelsFor(card("a", [item("created-check")])).order === "Order Created", "an order the bot created and nobody has ticked: Order Created");
ok(labelsFor(card("b", [item("needs-updated"), item("created-check")])).order === "Order Needs Updated", "a need outranks a success on the same thread");
ok(labelsFor(card("c", [item("needs-created", true)])).order === null, "ticked: no label at all (Ben: confirmed orders lose all their tags)");
ok(labelsFor(card("d", [item("needs-reply")], { follow_up: true })).order === null && labelsFor(card("d", [item("needs-reply")], { follow_up: true })).follow_up, "a question waiting a day: Needs Follow Up only");

const all = [...ORDER_LABELS, FOLLOW_UP];
const now = [labelsFor(card("a", [item("created-check")])), labelsFor(card("e", [item("needs-created")], { follow_up: true }))];
const first = changes(now, new Map());
ok(first.length === 2 && first[0].add.join() === "Order Created" && first[0].remove.length === all.length - 1, "first sight: the one label on, every other of ours off", first[0]);
ok(first[1].add.join() === `Order Needs Created,${FOLLOW_UP}`, "follow-up rides beside the order label", first[1].add);
const steady = changes(now, new Map([["a", { order: "Order Created", follow_up: false }], ["e", { order: "Order Needs Created", follow_up: true }]]));
ok(steady.length === 0, "nothing changed: nothing is sent to Gmail");
const gone = changes([labelsFor(card("e", [item("needs-created")], { follow_up: true }))], new Map([["a", { order: "Order Created", follow_up: false }], ["e", { order: "Order Needs Created", follow_up: true }]]));
ok(gone.length === 1 && gone[0].thread_id === "a" && gone[0].add.length === 0 && gone[0].remove.length === all.length, "a thread that left the TV loses every label of ours", gone);
ok(new Set(ORDER_LABELS).size === 4 && !ORDER_LABELS.includes(FOLLOW_UP as any), "four order labels, and follow-up is not one of them (CLAUDE.md)");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
