// ============================================================================
// What OnSinch's zone-less audit times mean, measured on a local copy.
// ----------------------------------------------------------------------------
// The audit timeline writes a Slot's old and new beginning/end as "2026-10-23 07:00:00", with no zone;
// the API writes the same slot as "2026-10-23T07:00:00+00:00". For every slot whose beginning or end
// was audited, the LAST audited value is compared with the API's value in the order copy, read once
// as UTC and once as London wall time. Only British Summer Time separates the two readings (in GMT
// they are the same instant), so the BST row is the evidence. The 10-22 copy: 1,810 of 1,813 BST
// values equal the API's when read as UTC, 0 when read as London; the 3 others are off by -5, +1 and
// -4 hours, a later edit the Slot diffs do not carry, and fit neither reading.
// Local copies only (.tmp-data/gold); nothing is read from OnSinch or the database.
// node scripts/onsinch-zone-evidence.cjs [goldDir]
// ============================================================================
const path = require("path");
const dir = path.resolve(process.argv[2] || ".tmp-data/gold");
const timeline = require(path.join(dir, "timeline.json"));
const orders = require(path.join(dir, "orders.json"));

const slots = new Map(), offsets = new Map();
for (const o of orders) for (const j of [].concat(o.Job || [])) for (const t of [].concat(j.SlotTeam || [])) for (const s of [].concat(t.Slot || [])) {
  slots.set(String(s.id), s);
  for (const v of [s.beginning, s.end]) if (v) offsets.set(v.slice(19) || "(none)", (offsets.get(v.slice(19) || "(none)") || 0) + 1);
}
const last = new Map();
for (const r of timeline) {
  if (r.action !== "common_change" || !/"Slot"/.test(r.data)) continue;
  let d; try { d = JSON.parse(r.data); } catch { continue; }
  const ch = d && d.diffChanges && d.diffChanges.Slot; if (!ch) continue;
  for (const f of ["beginning", "end"]) {
    if (!ch[f] || typeof ch[f].new !== "string") continue;
    const k = `${d.id}|${f}`, prev = last.get(k);
    if (!prev || prev.created < r.created) last.set(k, { created: r.created, v: ch[f].new });
  }
}
const londonOffsetHours = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ms) / 36e5);
};
const tally = { BST: { n: 0, asUtc: 0, asLondon: 0, neither: 0 }, GMT: { n: 0, asUtc: 0, asLondon: 0, neither: 0 } };
const neither = [];
for (const [k, a] of last) {
  const [id, f] = k.split("|"), s = slots.get(id); if (!s || !s[f]) continue;
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(a.v)) continue;
  const api = new Date(s[f]).getTime(), utc = new Date(a.v.replace(" ", "T") + "Z").getTime();
  const off = londonOffsetHours(utc), london = utc - off * 36e5, b = tally[off === 1 ? "BST" : "GMT"];
  b.n++;
  if (api === utc) b.asUtc++; else if (api === london) b.asLondon++; else { b.neither++; neither.push(`${k}: off by ${(api - utc) / 36e5} h`); }
}
console.log("API slot time offsets:", JSON.stringify([...offsets]));
console.log("last audited value vs the API's (GMT cannot tell UTC from London):", JSON.stringify(tally));
if (neither.length) console.log("fit neither:", neither.join("; "));
