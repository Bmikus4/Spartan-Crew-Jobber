// ============================================================================
// The generated business's language layer (harness/gen/language.ts, ADDENDUM §14.5): the forms clients write a
// day, a time, a length and a crew count in, weighted by counts of the production reader's quotes.
// ----------------------------------------------------------------------------
// Pinned: every form it writes reads back to the value it was written from through ground.ts's own parsers (a form
// the parsers cannot read would be a finding against the code, never a form to drop); a short date form is written
// only when it fits one day; every quote the perfect reader gives is in its email or its thread's earlier one; and
// the words come from their own stream, so a case's job is the same in plain and rich words.
// npx tsx test/genLanguage.ts
// ============================================================================
import { setLanguage, sayDay, sayTimes, sayCrew } from "../harness/gen/language";
import { generate } from "../harness/gen/cases";
import { parseDate, parseTime, parseDuration, parseCount, quoteIn } from "../app/lib/v2/interpret/ground";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const add = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

console.log("\n[1] every form reads back to its value");
{
  const bad: Record<string, string[]> = { date: [], time: [], length: [], crew: [] };
  let lengths = 0, ends = 0;
  for (let s = 0; s < 3000; s++) {
    setLanguage(s, true);
    const today = add("2026-11-02", s % 330), day = add(today, 1 + (s % 60));
    const dw = sayDay(day, today);
    if (parseDate(dw, `${today}T10:00:00Z`) !== day) bad.date.push(`${dw} (${today} -> ${day})`);
    const start = ["06:00", "07:30", "08:00", "09:15", "12:00", "13:45", "16:00", "22:00", "00:00"][s % 9];
    const t = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + [2, 3, 4, 5, 6, 8, 10, 12][s % 8] * 60) % 1440;
    const end = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    const tw = sayTimes(start, end);
    if (parseTime(tw.a) !== start) bad.time.push(tw.a);
    if (tw.b) { ends++; if (parseTime(tw.b) !== end) bad.time.push(tw.b); }
    if (tw.dur) { lengths++; if (parseDuration(tw.dur.q) !== tw.dur.mins) bad.length.push(tw.dur.q); }
    const n = 1 + (s % 14), cw = sayCrew(n);
    if (parseCount(cw) !== n) bad.crew.push(cw);
  }
  for (const k of Object.keys(bad)) ok(!bad[k].length, `every ${k} form reads back (3,000 draws)`, bad[k].slice(0, 5));
  ok(lengths > 800 && ends > 800, "a start and a length, and a start and an end, are both written (measured about half each)", { lengths, ends });
}

console.log("\n[2] a short date form only when it fits one day");
{
  // Sent Wed 3 Feb 2027: 11 Feb and 11 Mar 2027 are both Thursdays, so "Thursday 11th" would mean February.
  const forms = new Set<string>();
  for (let s = 0; s < 400; s++) { setLanguage(s, true); forms.add(sayDay("2027-03-11", "2027-02-03")); }
  ok(![...forms].some((f) => /^(Thursday|Thu) (the )?11th$/.test(f)), "no weekday and bare day for a day a month on when this month's fits", [...forms].filter((f) => !/Mar|\/0?3/.test(f)));
  forms.clear();
  for (let s = 0; s < 400; s++) { setLanguage(s, true); forms.add(sayDay("2026-12-25", "2026-11-28")); }
  ok(!forms.has("the 25th"), "no bare \"the 25th\" sent on the 28th: that is the recent 25th");
}

console.log("\n[3] every quote of the perfect reader is in the words it can read");
{
  const quotes = (x: any): string[] => Array.isArray(x) ? x.flatMap(quotes) : x && typeof x === "object" ? [...(typeof x.quote === "string" ? [x.quote] : []), ...Object.values(x).flatMap(quotes)] : [];
  const cases = generate("ABCDEFGHIJKLMNO".split(""), 6);
  const bad: string[] = [];
  for (const c of cases) c.emails.forEach((e, k) => {
    const thread = c.emails.slice(0, k + 1).map((x) => x.body).join("\n");
    for (const q of quotes(e.oracle)) if (!quoteIn(thread, q)) bad.push(`${c.id} ${q}`);
  });
  ok(!bad.length, `${cases.length} cases, every quote in its email or its thread`, bad.slice(0, 5));
}

console.log("\n[4] plain and rich words, the same jobs");
{
  const plain = generate(["A", "B", "E", "J"], 4, 7, undefined, false), rich = generate(["A", "B", "E", "J"], 4, 7, undefined, true);
  const job = (c: any) => JSON.stringify([c.orders, c.expect, c.looks.map((l: any) => [l.at, l.state, l.days])]);
  ok(plain.every((c, k) => job(c) === job(rich[k])), "every case's orders, expected answer and looks match");
  ok(plain.some((c, k) => c.emails[0].body !== rich[k].emails[0].body), "and the words differ");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
