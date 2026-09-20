// ============================================================================
// WHICH ORDERS STAND ON A VENUE — the question August's protocol said could not
// be asked from here.
//
// Its refusal reads: "a venue row is shared by every order that ever pointed at
// it, and there is no way to know from here which of those still matter." There
// is a way; it costs a full order pull. This is the counter, and the shape of the
// data is the whole risk.
//
// `with=Job` returns Job as an ARRAY. An implementation that reads
// `order.Job.place_id` sees undefined on every order in the tenant, returns an
// empty map, and that map reads as "nothing is referenced anywhere" — which would
// licence deleting the entire pool. So the array walk is pinned here, not trusted.
//
// Run: npx tsx test/venueReferenceScan.ts
// ============================================================================
import { scanReferences } from "../scripts/venue-sweep";

let fails = 0;
const ok = (c: boolean, label: string) => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`);
};

const ORDERS = [
  { id: 1, place_id: 49, Job: [{ id: 11, SlotTeam: [{ id: 101, place_id: 49 }, { id: 102, place_id: 57 }] }] },
  { id: 2, place_id: 57, Job: [{ id: 12, SlotTeam: [{ id: 103, slotlocation_id: 226 }] }] },
  { id: 3, place_id: null, Job: [] },
];

const refs = scanReferences(ORDERS);
ok(refs.get(49) === 2, "49 counted from both the order and its slot team");
ok(refs.get(57) === 2, "57 counted from a slot team and an order");
ok(refs.get(226) === 1, "slotlocation_id counts as a reference");
ok(refs.get(999) === undefined, "an unreferenced place has no entry");
ok(refs.size === 3, "no phantom entries from the null place_id");

// The failure that matters: Job read as an object rather than an array.
const asObject = [{ id: 4, place_id: null, Job: { id: 13, SlotTeam: [{ id: 104, place_id: 888 }] } }];
ok(scanReferences(asObject as never).size === 0, "a non-array Job yields nothing rather than throwing");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
