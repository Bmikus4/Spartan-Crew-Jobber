// ============================================================================
// Is `not-a-job` hiding real bookings? A falsifier that needs no labels.
// ----------------------------------------------------------------------------
// 256 of the 638 live threads — 40% of everything the engine sees — end as
// `not-a-job`, and nothing measures whether that is right. OnSinch holds no opinion
// about whether a thread was a job, and a corpus labelled by a model and scored by a
// model is a mirror. So classification has never had a number.
//
// It does not need one to be falsified. A `not-a-job` is the SILENT error: a wrong
// `new-job` announces itself when an order appears, while a wrong `not-a-job` is a
// booking nobody knows was missed. And there is an objective question that catches it:
//
//   this thread was called not-a-job; does its client have an order in OnSinch
//   on a date the thread itself names?
//
// That cannot prove the classification correct — a client can have an order on a day
// for reasons this thread knows nothing about — but a hit is a thread worth reading,
// and the RATE of hits against its control is a floor under the error rate.
//
// THE CONTROL IS THE WHOLE INSTRUMENT, and here more than anywhere. A busy client has
// orders on most working days, so "the client has an order that day" will fire by
// chance. Two controls run alongside:
//
//   DERANGED CLIENT  the same dates asked of a different client. Measures how much of
//                    the hit rate is "somebody has an order that day".
//   SHIFTED DATES    the same client asked about the same dates one year earlier.
//                    Measures how much is "this client is always busy".
//
// If the real rate does not clear both, this instrument has found nothing and says so
// rather than printing a number.
//
//   npx tsx study/najFalsifier.ts
// ============================================================================
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { loadEnv, ROOT_DIR, onsinchBase } from "../scripts/_env.mjs";

loadEnv();

interface Msg { from: string; to: string[]; date_iso: string; subject: string; body: string; is_from_spartan: boolean }
interface Row {
  thread_id: string; subject: string; last_date: string; senders: string[];
  messages: Msg[];
  engine: { classification?: string; company_id?: number | null; status?: string } | null;
}

const PATH = join(ROOT_DIR, "data", "testset", "threads.jsonl");
if (!existsSync(PATH)) throw new Error(`no test set at ${PATH} — run: npx tsx scripts/build-testset.ts`);
const rows: Row[] = readFileSync(PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// Dates a thread NAMES, read out of its own text.
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH_RE = Object.keys(MONTHS).join("|");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Explicit dates only. No relative language ("next Tuesday"), no bare ordinals ("the
 * 28th") — both need the sent date and a rule, and a wrong guess here manufactures a
 * hit against a client who is merely busy. Under-reading is the safe direction: it
 * shrinks the denominator, which the output states, rather than inventing findings.
 */
function datesIn(text: string, sentYear: number): string[] {
  const out = new Set<string>();
  const t = String(text ?? "");

  // 2026-08-14
  for (const m of t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);

  // 14/08/2026 and 14/08 — day first, which is how UK clients write and how this
  // tenant's mail reads. A US-format thread would be misread; none was seen.
  for (const m of t.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g)) {
    const d = Number(m[1]), mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : sentYear;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2024 && y <= 2030) {
      out.add(iso(new Date(Date.UTC(y, mo - 1, d))));
    }
  }

  // 14 August / 14th Aug / August 14
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})[a-z]*\\.?\\s*(20\\d{2})?`, "gi"))) {
    const d = Number(m[1]); const mo = MONTHS[m[2].toLowerCase()];
    const y = m[3] ? Number(m[3]) : sentYear;
    if (d >= 1 && d <= 31 && mo !== undefined) out.add(iso(new Date(Date.UTC(y, mo, d))));
  }
  for (const m of t.matchAll(new RegExp(`\\b(${MONTH_RE})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})?`, "gi"))) {
    const mo = MONTHS[m[1].toLowerCase()]; const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : sentYear;
    if (d >= 1 && d <= 31 && mo !== undefined) out.add(iso(new Date(Date.UTC(y, mo, d))));
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Sender domain -> company, LEARNED FROM THE ENGINE'S OWN SUCCESSFUL RESOLUTIONS.
// A not-a-job thread has no company_id because the engine never tried to resolve one,
// so the mapping has to come from somewhere else. The threads that DID resolve carry
// exactly that: a sender and the company the engine put them on. Free, and grounded in
// this tenant's real correspondence rather than in a guess about domain names.
// ---------------------------------------------------------------------------
const FREEMAIL = new Set(["gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "me.com", "aol.com"]);
const domainOf = (s: string) => String(s ?? "").split("@")[1]?.toLowerCase().trim() ?? "";

const domainToCompany = new Map<string, number>();
const domainConflicts = new Set<string>();
for (const r of rows) {
  const cid = Number(r.engine?.company_id);
  if (!Number.isFinite(cid)) continue;
  for (const s of r.senders ?? []) {
    const d = domainOf(s);
    // A free-mail domain belongs to everybody, so mapping it to one company would put
    // every gmail thread on whichever client happened to be seen first.
    if (!d || FREEMAIL.has(d) || d.endsWith("spartancrew.co.uk")) continue;
    const seen = domainToCompany.get(d);
    if (seen === undefined) domainToCompany.set(d, cid);
    else if (seen !== cid) domainConflicts.add(d);
  }
}
for (const d of domainConflicts) domainToCompany.delete(d);

// ---------------------------------------------------------------------------
// Every day every company has an order on. One pull, cached.
// ---------------------------------------------------------------------------
const CACHE = join(ROOT_DIR, ".tmp-data", "orders-with-job.json");
async function allOrders(): Promise<any[]> {
  if (existsSync(CACHE)) {
    const age = Date.now() - new Date(JSON.parse(readFileSync(CACHE, "utf8")).at ?? 0).getTime();
    if (age < 12 * 3600_000) return JSON.parse(readFileSync(CACHE, "utf8")).orders;
  }
  const client = new OnsinchClient(httpTransport({ baseUrl: onsinchBase(), apiKey: (process.env.ONSINCH_API_KEY || "").trim() }));
  const out: any[] = [];
  for (let page = 1; page <= 200; page++) {
    const batch = await client.getOrders({ limit: 200, page });
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < 200) break;
  }
  mkdirSync(join(ROOT_DIR, ".tmp-data"), { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ at: new Date().toISOString(), orders: out }), "utf8");
  return out;
}

async function main() {
  const orders = await allOrders();
  // ?with=Job returns an ARRAY, and order.Job.min_beginning is undefined on every order
  // in this tenant — a cross-check once scored 0/105 AND 0/28 on its own control because
  // of it. Min/max across the array is the only correct read.
  const dayIndex = new Map<number, Set<string>>();
  let spanned = 0;
  for (const o of orders) {
    const jobs = Array.isArray(o.Job) ? o.Job : (o.Job ? [o.Job] : []);
    const begins = jobs.map((j: any) => Date.parse(j?.min_beginning)).filter(Number.isFinite);
    const ends = jobs.map((j: any) => Date.parse(j?.max_end)).filter(Number.isFinite);
    if (!begins.length || !ends.length) continue;
    spanned++;
    const cid = Number(o.company_id);
    if (!Number.isFinite(cid)) continue;
    if (!dayIndex.has(cid)) dayIndex.set(cid, new Set());
    const set = dayIndex.get(cid)!;
    for (let d = Math.min(...begins); d <= Math.max(...ends); d += 86400_000) set.add(iso(new Date(d)));
  }

  console.log(`${orders.length} order(s) read; ${spanned} carry a readable job span; ${dayIndex.size} companies indexed.`);
  console.log(`domain -> company learned from the engine's own resolutions: ${domainToCompany.size} domain(s), ${domainConflicts.size} dropped for pointing at two clients.\n`);

  interface Case { thread_id: string; subject: string; company: number; dates: string[]; hit: string | null }

  /** Ask the question of an arbitrary population, so the same code answers for the
   *  suspects and for the positive control. */
  function ask(pop: Row[]): { asked: Case[]; noCompany: number; noDate: number } {
    const asked: Case[] = [];
    let noCompany = 0, noDate = 0;
    for (const r of pop) {
      const domains = [...new Set((r.senders ?? []).map(domainOf).filter(Boolean))];
      const cid = domains.map((d) => domainToCompany.get(d)).find((x) => x !== undefined);
      if (cid === undefined) { noCompany++; continue; }
      const year = Number(String(r.last_date ?? "").slice(0, 4)) || 2026;
      const text = (r.messages ?? []).map((m) => `${m.subject} ${m.body}`).join("\n");
      const dates = datesIn(text, year);
      if (!dates.length) { noDate++; continue; }
      const days = dayIndex.get(cid) ?? new Set<string>();
      asked.push({ thread_id: r.thread_id, subject: r.subject, company: cid, dates,
                   hit: dates.find((d) => days.has(d)) ?? null });
    }
    return { asked, noCompany, noDate };
  }

  // THE POSITIVE CONTROL, and without it the zero below means nothing. A threshold that
  // never fires and a threshold that fires correctly on nothing look identical from the
  // outside. So run the SAME question over threads the engine called new-job or update:
  // those have an order, on a date they name, by construction. If this scores near zero
  // too, the instrument is broken and the not-a-job result is an artefact of it.
  const jobbed = rows.filter((r) => r.engine?.classification === "new-job" || r.engine?.classification === "update");
  const ctrl = ask(jobbed);
  const ctrlHits = ctrl.asked.filter((a) => a.hit).length;
  const ctrlRate = ctrl.asked.length ? (100 * ctrlHits) / ctrl.asked.length : 0;
  console.log(`POSITIVE CONTROL — the same question asked of new-job and update threads,`);
  console.log(`which have an order on a date they name by construction:`);
  console.log(`  ${ctrlHits}/${ctrl.asked.length} hit  ${ctrlRate.toFixed(1)}%   (${jobbed.length} thread(s), ${ctrl.noCompany} no client, ${ctrl.noDate} no date)`);
  if (ctrlRate < 30) {
    console.log(`  >>> THE INSTRUMENT IS BROKEN. It cannot find orders that are definitely there,`);
    console.log(`      so everything below is an artefact of the instrument, not a finding about`);
    console.log(`      classification. Stop here.`);
  } else {
    console.log(`  The instrument finds what is there. A zero below is therefore a real zero.`);
  }
  console.log();

  const naj = rows.filter((r) => r.engine?.classification === "not-a-job");
  console.log(`${naj.length} thread(s) classified not-a-job.`);

  const asked: Case[] = [];
  let noCompany = 0, noDate = 0;
  for (const r of naj) {
    const domains = [...new Set((r.senders ?? []).map(domainOf).filter(Boolean))];
    const cid = domains.map((d) => domainToCompany.get(d)).find((x) => x !== undefined);
    if (cid === undefined) { noCompany++; continue; }
    const year = Number(String(r.last_date ?? "").slice(0, 4)) || 2026;
    const text = (r.messages ?? []).map((m) => `${m.subject} ${m.body}`).join("\n");
    const dates = datesIn(text, year);
    if (!dates.length) { noDate++; continue; }
    const days = dayIndex.get(cid) ?? new Set<string>();
    asked.push({ thread_id: r.thread_id, subject: r.subject, company: cid, dates,
                 hit: dates.find((d) => days.has(d)) ?? null });
  }

  console.log(`  ${noCompany} declined — the sender's domain maps to no known client`);
  console.log(`  ${noDate} declined — no explicit date anywhere in the thread`);
  console.log(`  ${asked.length} ASKABLE\n`);

  const hits = asked.filter((a) => a.hit);
  const rate = asked.length ? (100 * hits.length) / asked.length : 0;

  // CONTROL 1 — the same dates asked of a DIFFERENT client.
  const companies = [...dayIndex.keys()];
  let shamClient = 0;
  asked.forEach((a, i) => {
    const other = companies[(i * 7919 + 13) % companies.length];
    const days = dayIndex.get(other === a.company ? companies[(i + 1) % companies.length] : other) ?? new Set();
    if (a.dates.some((d) => days.has(d))) shamClient++;
  });
  // CONTROL 2 — the same client, the same dates, one year earlier.
  let shamDate = 0;
  for (const a of asked) {
    const days = dayIndex.get(a.company) ?? new Set<string>();
    const shifted = a.dates.map((d) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`);
    if (shifted.some((d) => days.has(d))) shamDate++;
  }
  const c1 = asked.length ? (100 * shamClient) / asked.length : 0;
  const c2 = asked.length ? (100 * shamDate) / asked.length : 0;

  console.log(`REAL              ${hits.length}/${asked.length}  ${rate.toFixed(1)}%  the client HAS an order on a date this thread names`);
  console.log(`control, other client   ${shamClient}/${asked.length}  ${c1.toFixed(1)}%`);
  console.log(`control, a year earlier ${shamDate}/${asked.length}  ${c2.toFixed(1)}%`);
  const margin = rate - Math.max(c1, c2);
  console.log(`margin over the stronger control: ${margin.toFixed(1)} points\n`);

  // Three different things can produce a low number and they must not print the same
  // verdict. The first draft of this file treated a real zero as "found nothing", which
  // is exactly backwards: with the positive control firing, zero is the strongest result
  // the instrument can return.
  if (ctrlRate < 30) {
    console.log(`>>> NO VERDICT. The positive control failed, so this number is about the`);
    console.log(`    instrument and not about classification.`);
  } else if (hits.length === 0) {
    // Rule of three: with 0 events in n trials the 95% upper bound is about 3/n.
    const bound = (300 / Math.max(asked.length, 1)).toFixed(1);
    console.log(`>>> NO FALSIFICATION FOUND, and the control says the instrument would have`);
    console.log(`    found one. Of ${asked.length} not-a-job threads whose client is known and which name`);
    console.log(`    an explicit date, NONE has that client booked on a date it names, while the`);
    console.log(`    same question finds the order ${ctrlRate.toFixed(0)}% of the time on threads that do have one.`);
    console.log(`    This is the first evidence classification has ever had, and it is in its`);
    console.log(`    favour. With 0 of ${asked.length}, the 95% upper bound on the miss rate over THIS`);
    console.log(`    population is about ${bound}% — a ceiling, not a score.`);
    console.log(`    WHAT IT DOES NOT COVER: the ${noCompany} threads whose sender maps to no known`);
    console.log(`    client and the ${noDate} that name no date. A missed booking from a brand-new`);
    console.log(`    client is exactly the case this cannot see, and it is not a rare shape.`);
  } else if (margin < 15) {
    console.log(`>>> NO SIGNAL. The hit rate is within ${margin.toFixed(1)} points of what chance produces, so a`);
    console.log(`    hit does not distinguish a missed booking from a busy client. Do not read`);
    console.log(`    the list below as misses.`);
  } else {
    console.log(`The margin clears both controls, so a hit is worth reading. Each of these is a`);
    console.log(`thread the engine called not-a-job where its client had work booked that day:`);
  }
  for (const h of hits.slice(0, 30)) {
    console.log(`  ${h.thread_id}  company ${h.company}  on ${h.hit}`);
    console.log(`     ${String(h.subject).slice(0, 84)}`);
  }
  if (hits.length > 30) console.log(`  … and ${hits.length - 30} more`);

  console.log(`\nWHAT A HIT IS AND IS NOT. It is not proof of a miss: a client can have an order`);
  console.log(`on a day for reasons this thread knows nothing about, and the commonest true`);
  console.log(`not-a-job — an invoice or a PO chase — NAMES the date of work already booked.`);
  console.log(`It is a shortlist, and it is the first evidence classification has ever had.`);
}

main();
