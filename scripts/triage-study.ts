// ============================================================================
// What would a filter catch, and what is the cheapest signal that catches it?
// ----------------------------------------------------------------------------
// NO MODEL CALLS. The mailbox is about to deliver everything rather than only what a
// Gmail label selected, so the filtering that used to happen upstream has to happen
// here. This measures which signals are worth building, in order of leverage, over the
// corpus (5,835 threads) and over what has actually arrived (inbound_raw).
//
// The question is not "can a model tell a newsletter from a booking" — it can. It is
// "what can be decided for FREE before a model is paid to read it", because at $0.0189
// an email the filter IS the cost model.
//
//   npx tsx scripts/triage-study.ts
//   npx tsx scripts/triage-study.ts --json
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { readCorpus } from "./_corpus.mjs";
import { readFileSync } from "node:fs";
import { isMachineSender, isAutoReply, isFromSpartan } from "../app/lib/engine/normalize";
import { triage } from "../app/lib/engine/triage";

const AS_JSON = process.argv.includes("--json");
const say = (...a: unknown[]) => { if (!AS_JSON) console.log(...a); };
const pct = (n: number, d: number) => (d ? (100 * n / d).toFixed(1) + "%" : "n/a");

const env = readFileSync(process.cwd() + "/.env.local", "utf8");
const g = (k: string) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^"|"$/g, "");
const sql = neon(g("DATABASE_URL")!);

interface Msg { from?: string; subject?: string; body?: string; is_from_spartan?: boolean }

// The right signal for bulk mail is the List-Unsubscribe HEADER. The n8n payload does
// not forward headers, so this measures the fallback — how visible bulk mail is from the
// body alone — which is how you price "forward the headers" against "guess from content".
const BULK_BODY = /unsubscribe|manage (your )?preferences|view (this|it) in (your )?browser|you are receiving this|update your email preferences/i;

async function main() {
  const out: Record<string, unknown> = {};

  // ---------------------------------------------------------- sender concentration
  // The load-bearing question for a sender-first design: how much traffic comes from
  // addresses already seen? If it is most of it, identity decides more than content does.
  // Was a jsonb_array_elements aggregate over sweep_threads; the mail is on disk now, so
  // the same tally is one pass over the file. COUNT(DISTINCT thread_id) becomes a Set.
  const senderThreads = new Map<string, Set<string>>();
  for await (const row of readCorpus()) {
    for (const m of (row.payload?.messages ?? []) as Array<Record<string, unknown>>) {
      if (m?.is_from_spartan === true) continue;
      const addr = String(m?.from ?? "").toLowerCase();
      if (!addr) continue;
      if (!senderThreads.has(addr)) senderThreads.set(addr, new Set());
      senderThreads.get(addr)!.add(row.thread_id);
    }
  }
  const senders = [...senderThreads].map(([addr, s]) => ({ addr, threads: s.size }));

  const human = senders.filter((s) => !isMachineSender(s.addr) && !isFromSpartan(s.addr));
  const totalAppear = human.reduce((n, s) => n + s.threads, 0);
  const repeat = human.filter((s) => s.threads > 1);
  const repeatAppear = repeat.reduce((n, s) => n + s.threads, 0);
  const ranked = [...human].sort((a, b) => b.threads - a.threads);
  let acc = 0, sendersFor80 = 0;
  for (const s of ranked) { acc += s.threads; sendersFor80++; if (acc >= totalAppear * 0.8) break; }

  out.senders = {
    distinctHuman: human.length, threadAppearances: totalAppear,
    repeatSenders: repeat.length, repeatShare: totalAppear ? repeatAppear / totalAppear : 0,
    sendersCovering80pct: sendersFor80,
  };
  say(`\n=== SENDER CONCENTRATION (the case for deciding by identity) ===`);
  say(`distinct human senders        ${human.length}`);
  say(`repeat senders (2+ threads)   ${repeat.length} — carrying ${pct(repeatAppear, totalAppear)} of all thread-appearances`);
  say(`senders covering 80% of mail  ${sendersFor80}   <- a ledger this size decides most traffic for free`);

  // --------------------------------------------------- what today's free rules catch
  const tally = { total: 0, spartanOwn: 0, machineSender: 0, autoReply: 0, empty: 0, remaining: 0, bulkBody: 0 };
  const unmatched = new Map<string, number>();

  const tallyOne = (m: Msg) => {
    tally.total++;
    const from = String(m.from ?? "");
    if (!m.is_from_spartan && BULK_BODY.test(String(m.body ?? ""))) tally.bulkBody++;
    if (!from) { tally.empty++; return; }
    if (m.is_from_spartan || isFromSpartan(from)) { tally.spartanOwn++; return; }
    if (isMachineSender(from)) { tally.machineSender++; return; }
    if (isAutoReply(String(m.subject ?? ""), String(m.body ?? ""))) { tally.autoReply++; return; }
    tally.remaining++;
    // Group what nothing caught, so the next rule written is evidence-led rather than guessed.
    const sub = String(m.subject ?? "").trim().toLowerCase().replace(/^((re|fw|fwd)\s*:\s*)+/g, "").slice(0, 58);
    if (sub) unmatched.set(sub, (unmatched.get(sub) ?? 0) + 1);
  };


  // One pass over the on-disk corpus instead of paging jsonb_array_elements.
  {
    for await (const row of readCorpus()) {
      for (const m of (row.payload?.messages ?? []) as Msg[]) tallyOne(m || {});
      if (tally.total % 5000 < 30) say(`  … ${tally.total} messages scanned`);
    }
  }

  out.currentRules = tally;
  say(`\n=== WHAT THE EXISTING FREE RULES CATCH (${tally.total} messages) ===`);
  say(`Spartan's own mail       ${String(tally.spartanOwn).padStart(6)} = ${pct(tally.spartanOwn, tally.total)}`);
  say(`machine senders          ${String(tally.machineSender).padStart(6)} = ${pct(tally.machineSender, tally.total)}`);
  say(`auto-replies / bounces   ${String(tally.autoReply).padStart(6)} = ${pct(tally.autoReply, tally.total)}`);
  say(`empty sender             ${String(tally.empty).padStart(6)} = ${pct(tally.empty, tally.total)}`);
  say(`REACH THE MODEL          ${String(tally.remaining).padStart(6)} = ${pct(tally.remaining, tally.total)}`);
  say(`\nbulk-mail markers in the BODY: ${tally.bulkBody} = ${pct(tally.bulkBody, tally.total)}`);
  say(`  List-Unsubscribe is a HEADER and the payload forwards no headers, so the`);
  say(`  strongest bulk signal is currently invisible to the engine.`);

  // ------------------------------------------------ the real triage, tier by tier
  // Same corpus, run through the module that now ships, so the report quotes what the
  // code does rather than what the tiers were meant to do.
  const tiers = new Map<string, number>();
  let admitted = 0;
  // One pass over the on-disk corpus, in the same thread_id order the paged query used.
  {
    for await (const row of readCorpus()) {
      for (const m of ((row.payload?.messages ?? []) as Msg[])) {
        const t = await triage({
          from: String(m?.from ?? ""), subject: String(m?.subject ?? ""),
          body: String(m?.body ?? ""), is_from_spartan: m?.is_from_spartan,
        });
        tiers.set(t.tier, (tiers.get(t.tier) ?? 0) + 1);
        if (t.verdict === "admit") admitted++;
      }
    }
  }
  out.triageTiers = Object.fromEntries(tiers);
  out.triageAdmitted = admitted;
  say(`
=== THE SHIPPING TRIAGE, TIER BY TIER (${tally.total} messages, no headers in corpus) ===`);
  for (const [t, n] of [...tiers.entries()].sort((a, b) => b[1] - a[1])) {
    say(`  ${t.padEnd(18)} ${String(n).padStart(6)} = ${pct(n, tally.total)}`);
  }
  say(`  ${'ADMITTED (paid for)'.padEnd(18)} ${String(admitted).padStart(6)} = ${pct(admitted, tally.total)}`);
  const saved = tally.total - admitted;
  say(`  skipped for free    ${String(saved).padStart(6)} = ${pct(saved, tally.total)}  -> $${(saved * 0.0189).toFixed(2)} not spent at $0.0189/email`);

  const top = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  out.topUnmatched = top.map(([subject, n]) => ({ subject, n }));
  say(`\n=== COMMONEST SUBJECTS THAT REACH THE MODEL (deduped, top 25) ===`);
  for (const [s, n] of top) say(`  ${String(n).padStart(4)}  ${s}`);

  if (AS_JSON) console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
