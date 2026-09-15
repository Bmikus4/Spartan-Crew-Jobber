// ============================================================================
// Which order-write path actually fires, by month.
// ----------------------------------------------------------------------------
// Every write the pipeline attempts appends to `order_action_log` on the state, so
// this is the ledger of what the engine really did — as against what the test suite
// says it does. The kinds are: create, patch, amend, replace, amend-refused,
// replace-refused. `patch` is PATCH /orders and carries TOP-LEVEL FIELDS ONLY (a PO,
// a specification line); it never moves crew or times. So a month whose column shows
// patches but no amends and no replaces is a month in which not one crew change
// reached OnSinch, however healthy the create count looks.
//
// Read-only.  node scripts/order-action-ledger.mjs
// ============================================================================
import { sql } from './_q.mjs';

const rows = await sql`select thread_id, state from conversation_state`;
const byMonth = {}, kinds = new Set(), failText = {};
let states = 0, withOrder = 0;

for (const r of rows) {
  const s = typeof r.state === 'string' ? JSON.parse(r.state) : (r.state ?? {});
  states++;
  if (s.onsinch_order_id) withOrder++;
  for (const a of s.order_action_log ?? []) {
    const m = a.ts ? new Date(a.ts).toISOString().slice(0, 7) : 'unknown';
    const k = `${a.kind}${a.ok ? '' : '!'}`;
    kinds.add(k);
    byMonth[m] ??= {};
    byMonth[m][k] = (byMonth[m][k] ?? 0) + 1;
    if (!a.ok && a.error) {
      // Collapse the ids so the shapes cluster instead of scattering one per order.
      const key = String(a.error).replace(/#?\d{4,}/g, '#N').slice(0, 90);
      failText[key] = (failText[key] ?? 0) + 1;
    }
  }
}

const cols = [...kinds].sort();
console.log(`states ${states}, carrying an order id ${withOrder}\n`);
console.log('MONTH    ' + cols.map((c) => c.padStart(16)).join(''));
for (const [m, t] of Object.entries(byMonth).sort()) {
  console.log(m.padEnd(9) + cols.map((c) => String(t[c] ?? '.').padStart(16)).join(''));
}
console.log('\n(a trailing ! means the action was recorded as failed)');

console.log('\nFAILURE SHAPES');
for (const [k, v] of Object.entries(failText).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(v).padStart(3)}  ${k}`);
}

// The note that means a crew change reached a human instead of the tenant.
const byHand = await sql`
  select count(*)::int c from tickets where notes::text ilike '%applied by hand on OnSinch%'`;
console.log(`\ntickets telling a human to apply crew and times by hand: ${byHand[0].c}`);
