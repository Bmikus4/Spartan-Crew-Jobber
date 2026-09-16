// ============================================================================
// THE HARNESS. One command, one number, and the same number twice on the same build.
// ----------------------------------------------------------------------------
// WHAT IT IS FOR. Run it before a change and after it, with a label each time, and
// the difference is the change's effect. Everything that could drift between the two
// runs is pinned: the 100 threads come from a seeded draw, the reference standard is
// reused rather than re-bought, and the engine leg sees only orders that existed
// before each thread began.
//
//   npx tsx study/harness.ts --selftest             the leak guards. FREE. Run first.
//   npx tsx study/harness.ts --label=before         full run, stored in data/study/before
//   npx tsx study/harness.ts --label=after
//   npx tsx study/harness.ts --label=X --fresh      re-buy the engine leg on an UNCHANGED build
//   npx tsx study/harness.ts --diff=before,after    what actually moved, thread by thread
//   npx tsx study/harness.ts --label=X --report     re-report a stored run, free
//
// WHY A HARNESS RATHER THAN A SCRIPT. The 2026-09-03 run's number went to .tmp-data,
// which is wiped, so six weeks later it could not be found and was nearly re-bought.
// A run that cannot be pointed at afterwards is an anecdote. --label is the whole
// feature: it puts the raw output somewhere permanent next to the build that produced it.
//
// THE NOISE FLOOR, MEASURED 2026-09-16 — read this before believing any before/after.
// Two runs of the SAME build (03826d0e9507), the engine leg re-bought both times:
//
//     after   77/99  = 77.8%        noise   79/100 = 79.0%
//
// THREE threads of 100 changed fault status with nothing whatsoever different, so the
// band on the headline is about +/- 1.2 points and a change smaller than that CANNOT be
// seen by one before/after pair, however real it is. Quote thread-level movement, not
// the headline, until the change is bigger than the band.
//
// Where the three came from matters more than the count. The engine's own answer — what
// it decided the thread WAS and whether it would book — differed on exactly ONE, and
// that one was an OpenRouter timeout, not a judgement. The other two were fact
// EXTRACTION moving underneath an unchanged verdict: "Quote - Forta Warehouse / Feb"
// went from four field faults to one and "UKLE25-2934" from one to none, both of them
// long many-block threads scored on dates, blocks and windows. Classification and
// bookable are steady; the block-level extraction on long threads is not, and that is
// where a variance-reduction effort belongs.
//
// THE THING THIS HARNESS IS DEFENDING AGAINST. Every previous accuracy number in this
// repo was eventually found to be the test handing the engine its own answer — a 98.7%
// self-match that was 45.9% on real queries; four corpus metrics measuring themselves;
// gates reading 100% because the scripted reasoner answered from the case's own truth;
// an amend stub that returned `declined: true` and scored the refusal against the
// engine. --selftest exists because that failure is not detectable by reading the
// number. It has to be attacked.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { engineBuildId } from "./buildid";

const ROOT = join(import.meta.dirname, "..");
const TMP = join(ROOT, ".tmp-data", "study");
const STORE = join(ROOT, "data", "study");
const FILES = ["real-engine.jsonl", "real-standard.jsonl", "real-settled.jsonl"];

const argv = process.argv.slice(2);
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const has = (n: string) => argv.includes(`--${n}`);

const jsonl = (p: string): any[] =>
  existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const byId = (rows: any[]) => new Map(rows.map((r) => [r.thread_id, r]));

function sh(args: string[], label: string): void {
  console.log(`\n$ npx tsx study/real.ts ${args.join(" ")}`);
  const r = spawnSync("npx", ["tsx", join(ROOT, "study", "real.ts"), ...args], { stdio: "inherit", shell: true, cwd: ROOT });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

// ---------------------------------------------------------------------------
// THE LEAK GUARDS
// ---------------------------------------------------------------------------
let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
};

/** A seeded derangement: every item paired with a DIFFERENT item. */
function deranged<T>(xs: T[], seed = 20260916): T[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out[0] === xs[0]) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

function selftest(): void {
  console.log("=".repeat(78));
  console.log("LEAK GUARDS — can the harness see the answer it is scoring?");
  console.log("=".repeat(78));

  const src = readFileSync(join(ROOT, "study", "real.ts"), "utf8");
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  console.log("\n[1] the engine leg runs the REAL reasoner, not the scripted one");
  // scriptedReasoner answers from the case's own truth object and never reads the mail.
  // It is the right control for the synthetic legs and fatal here: it would score the
  // generator, not the engine.
  ok(!/scriptedReasoner/.test(noComments), "study/real.ts never uses scriptedReasoner");
  ok(/createOpenRouterReasoner/.test(noComments), "it builds the production OpenRouter reasoner");

  console.log("\n[2] no stub returns a fixed verdict the engine is then scored on");
  // `amendOrderInPlace: async () => ({ declined: true })` cost six threads: the fixture
  // refused every amendment and the refusal was scored against the engine.
  ok(!/amendOrderInPlace:\s*async\s*\(\s*\)\s*=>\s*\(\{\s*declined:\s*true/.test(noComments),
     "amendOrderInPlace is not stubbed to always decline");
  ok(/amendOrderInPlace\(\s*\n?\s*onsinch/.test(noComments) || /amendOrderInPlace\(\s*onsinch/.test(noComments),
     "it calls the production amendOrderInPlace against the fixture transport");

  console.log("\n[3] the order fixture cannot serve an order from the thread's own future");
  // Serving today's orders would hand over the order a human raised IN RESPONSE to this
  // very mail. The engine would 'find' it and score a free link.
  ok(/created\s*\)\s*\)\s*;?\s*\n?\s*return Number\.isFinite\(at\) && at < cutoff/.test(noComments)
     || /at < cutoff/.test(noComments), "the /orders fixture filters on created < cutoff");
  ok(/const cutoff = Date\.parse\(t\.messages\[0\]/.test(noComments),
     "and the cutoff is the thread's FIRST message, not its last");

  const sample = existsSync(join(TMP, "real-sample.json"))
    ? JSON.parse(readFileSync(join(TMP, "real-sample.json"), "utf8")) : [];
  const cachePath = join(ROOT, ".tmp-data", "orders-with-job.json");
  if (sample.length && existsSync(cachePath)) {
    // The claim above is about the code. This is about the data: with the real cutoffs
    // and the real order cache, how many orders WOULD have leaked without that filter?
    // If the answer is zero the guard is untested, and a guard nothing exercises is a
    // guard that can rot without anybody noticing.
    const orders: any[] = JSON.parse(readFileSync(cachePath, "utf8")).orders ?? [];
    const byCompany = new Map<number, any[]>();
    for (const o of orders) {
      const c = Number(o.company_id);
      if (!Number.isFinite(c)) continue;
      (byCompany.get(c) ?? byCompany.set(c, []).get(c)!).push(o);
    }
    let wouldLeak = 0, served = 0;
    for (const t of sample) {
      const cutoff = Date.parse(t.messages?.[0]?.date_iso || t.first_date || "") || 0;
      for (const list of byCompany.values()) {
        for (const o of list) {
          const at = Date.parse(String(o.created ?? ""));
          if (!Number.isFinite(at)) continue;
          if (at < cutoff) served++; else wouldLeak++;
        }
      }
      break; // one thread is enough to prove both sides are non-empty
    }
    ok(served > 0, "the cutoff still serves real history (it is not filtering everything away)", `${served} order(s)`);
    ok(wouldLeak > 0, "and it is genuinely holding orders back (the guard is exercised)", `${wouldLeak} withheld`);
  } else {
    console.log("  SKIP  no sample or order cache on disk — run a labelled run first");
  }

  console.log("\n[4] the reference standard is independent of the engine's answer");
  ok(/STANDARD_SYSTEM, renderThread\(t\)/.test(noComments),
     "the standard is prompted with the THREAD only, never the engine's output");
  ok(!/STANDARD_SYSTEM[^)]*eng(ine)?\b/.test(noComments), "no engine field reaches the standard's prompt");

  console.log("\n[5] THE STRONGEST ONE — scoring against somebody else's answer must collapse");
  // If the engine agrees with a RANDOM other thread's reference reading about as often as
  // with its own, the metric is reading the shape of the corpus and not the engine.
  const eng = byId(jsonl(join(TMP, "real-engine.jsonl")));
  const std = byId(jsonl(join(TMP, "real-standard.jsonl")));
  const ids = [...eng.keys()].filter((id) => std.has(id));
  if (ids.length >= 20) {
    // The standard calls it `verdict`; the engine calls it `classification`. Reading the
    // wrong key on either side makes BOTH columns zero, which looks like a catastrophic
    // leak rather than a typo — this guard printed 0.0% against 0.0% and failed, which is
    // the right direction for a guard to be wrong in.
    const cls = (r: any) => String(r?.standard?.verdict ?? r?.classification ?? "");
    const real = ids.filter((id) => cls(eng.get(id)) === cls(std.get(id))).length;
    const shuffled = deranged(ids);
    const sham = ids.filter((id, i) => cls(eng.get(id)) === cls(std.get(shuffled[i]))).length;
    const rp = (100 * real) / ids.length, sp = (100 * sham) / ids.length;
    // NEITHER PERCENTAGE IS AN ACCURACY FIGURE. This compares two raw label strings
    // across two vocabularies that do not map one to one, so the left column is lower
    // than the engine deserves. Only the GAP is the evidence, and only that is asserted.
    console.log(`     engine vs its OWN reading      ${real}/${ids.length}  ${rp.toFixed(1)}%   (raw label equality, not accuracy)`);
    console.log(`     engine vs a DERANGED reading   ${sham}/${ids.length}  ${sp.toFixed(1)}%`);
    ok(rp - sp >= 15, "the gap clears 15 points, so the agreement is about these threads",
       `gap ${(rp - sp).toFixed(1)} points`);
  } else {
    console.log("  SKIP  fewer than 20 scored threads on disk — run a labelled run first");
  }

  console.log("\n[8] every tenant cache is at least as new as the world the fixture serves");
  /**
   * THE CACHES DESCRIBE THE TENANT AT FOUR DIFFERENT DATES.
   *
   * Orders, companies, places and professions are four separate pulls, and on
   * 2026-09-16 they were 22 days apart. The engine resolves a venue against the PLACES
   * snapshot and then compares that answer to a venue written inside an ORDER name, so
   * a place created between the two pulls is invisible on one side and present on the
   * other. venueVerdict demotes what it cannot resolve to a weak verdict, which is the
   * safe direction, but it is silent: the study would simply link less well than
   * production and report it as engine accuracy.
   *
   * The bar is not "recent". It is that each cache covers the world the fixture
   * actually serves, which the /orders cutoff bounds precisely: every order served was
   * created before some thread's FIRST message, so no served order can post-date the
   * latest first-message in the sample. A cache older than that horizon is scoring the
   * engine against rows it was never shown.
   */
  {
    const sample: any[] = existsSync(join(TMP, "real-sample.json"))
      ? JSON.parse(readFileSync(join(TMP, "real-sample.json"), "utf8")) : [];
    const cachePath = join(ROOT, ".tmp-data", "orders-with-job.json");
    if (!sample.length || !existsSync(cachePath)) {
      console.log("  SKIP  no sample or order cache on disk — run a labelled run first");
    } else {
      const day = (s: unknown) => String(s ?? "").slice(0, 10);
      const at = (p: string) => (existsSync(p) ? statSync(p).mtime.toISOString().slice(0, 10) : "");
      // Every order the fixture can serve was created before SOME thread's first message.
      const horizon = sample.map((t) => day(t.messages?.[0]?.date_iso || t.first_date)).sort().pop()!;
      // And the thread's later messages are answered in a world the cache must still cover.
      const lastMsg = sample.map((t) => day(t.last_date)).sort().pop()!;

      for (const [name, file] of [["places", "places.json"], ["companies", "companies.json"], ["professions", "professions.json"]] as const) {
        const stamp = at(join(ROOT, ".tmp-data", file));
        const days = stamp ? Math.round((Date.parse(stamp) - Date.parse(horizon)) / 864e5) : 0;
        ok(!!stamp && stamp >= horizon, `${name} covers the newest order the fixture can serve`,
           stamp ? `pulled ${stamp}, horizon ${horizon}, ${days >= 0 ? `${days}d of margin` : `${-days}d SHORT — re-pull it`}`
                 : "cache missing");
      }

      const orders: any[] = JSON.parse(readFileSync(cachePath, "utf8")).orders ?? [];
      const newest = orders.map((o) => day(o.created)).filter(Boolean).sort().pop() ?? "";
      const days = newest ? Math.round((Date.parse(newest) - Date.parse(lastMsg)) / 864e5) : 0;
      ok(orders.length > 0 && newest >= lastMsg, "the order cache runs past the last message in the sample",
         `${orders.length} orders to ${newest}, sample ends ${lastMsg}, ${days >= 0 ? `${days}d of margin` : `${-days}d SHORT`}`);
    }
  }

  console.log("\n[7] the answers on disk were produced by the build about to be scored");
  // The engine leg resumes by thread id so a dead run need not be re-bought. Keyed on
  // the id alone it also resumed across a CODE CHANGE: the 2026-09-17 --label=after run
  // made zero model calls, wrote a file byte-identical to --label=before, and reported
  // the same 79% for a build that had changed. A before/after that cannot see a change
  // is worse than no harness, because it reads as a finding.
  {
    const rows = jsonl(join(TMP, "real-engine.jsonl"));
    if (!rows.length) {
      console.log("  SKIP  no engine answers on disk — run a labelled run first");
    } else {
      const want = engineBuildId(ROOT);
      const builds = new Set(rows.map((r) => String(r.build ?? "(none)")));
      ok(builds.size === 1, "every answer came from ONE build", [...builds].join(", "));
      ok(builds.has(want), "and that build is the engine source as it stands now",
         builds.has(want) ? `build ${want}`
                          : `on disk ${[...builds].join(",")} vs source ${want} — re-run the engine leg`);
    }
  }

  console.log("\n[6] no ruling is applied to an answer the engine no longer gives");
  // The settle cache was keyed on the thread id, so a ruling outlived the answer it was
  // about. On the 2026-09-16 run 20 rulings were stale, 11 of them scored against the
  // engine, and the headline read 2 points low. The direction that matters more is the
  // other one: a fix that makes a thread agree leaves the old "standard wins" in place,
  // so the fix measures as zero and stage 2 cannot be evaluated at all.
  if (ids.length >= 20 && existsSync(join(TMP, "real-settled.jsonl"))) {
    const r = spawnSync("npx", ["tsx", join(ROOT, "study", "real.ts"), "--report"],
                        { encoding: "utf8", shell: true, cwd: ROOT });
    const out = r.stdout ?? "";
    const staleN = Number(/(\d+) ruling\(s\) IGNORED as stale/.exec(out)?.[1] ?? 0);
    const unruledN = Number(/(\d+) thread\(s\) DISAGREE TODAY WITH NO RULING/.exec(out)?.[1] ?? 0);
    ok(/REAL-MAIL ACCURACY/.test(out), "the report runs and produces a figure");
    // A ruling about a disagreement that has since evaporated is obsolete, not a fault:
    // there is no question left to put to a judge, and the report already drops it. The
    // count is printed because a file that keeps growing them is worth seeing.
    console.log(`     ${staleN} obsolete ruling(s) on disk, ignored by the report (a thread that now agrees)`);
    // This is the assertion. A disagreement with no ruling that matches today's answers
    // scores as clean, so every one of them is a free mark the engine did not earn.
    ok(unruledN === 0, "every live disagreement has a ruling made about the answers now given",
       unruledN ? `${unruledN} unruled — the figure is an UPPER BOUND. Run: npx tsx study/real.ts --settle`
                : "none unruled");
  } else {
    console.log("  SKIP  no settled file on disk — run a labelled run first");
  }

  console.log(`\n${fails === 0 ? "ALL GUARDS PASS — a number from this harness is worth reading." :
    `${fails} GUARD(S) FAILED — DO NOT QUOTE ANY NUMBER FROM THIS HARNESS UNTIL THEY PASS.`}\n`);
  if (fails) process.exit(1);
}

// ---------------------------------------------------------------------------
function runLabelled(label: string, reportOnly: boolean, fresh = false): void {
  const dir = join(STORE, label);
  mkdirSync(dir, { recursive: true });

  /**
   * --fresh: RE-BUY THE ENGINE LEG ON A BUILD THAT HAS NOT CHANGED.
   *
   * Guard 7 makes a changed build re-run. Nothing makes an UNCHANGED build re-run, and
   * it should not by default — that resume is what stops a crashed run costing twice.
   * But it also means the harness can never be run twice on one build, and running it
   * twice on one build is the only way to learn what the number does when NOTHING is
   * different. That figure bounds every before/after this harness will ever produce: a
   * change smaller than the spread between two identical runs cannot be seen by one
   * pair, however real it is. Measured 2026-09-16 — see the header.
   */
  if (fresh && !reportOnly) {
    const p = join(TMP, "real-engine.jsonl");
    if (existsSync(p)) {
      rmSync(p);
      console.log("--fresh: discarded the engine answers on disk; this run re-buys all of them");
    }
  }

  if (reportOnly) {
    // Restore the stored run into the working files so --report reads THAT run and not
    // whatever happened to be produced last.
    for (const f of FILES) if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(TMP, f));
  } else {
    mkdirSync(TMP, { recursive: true });
    if (!existsSync(join(TMP, "real-sample.json"))) sh(["--sample", "--n=100", "--seed=20260903"], "sample");
    // The standard is the same mail read the same way whatever the engine does, so it is
    // reused across runs. Re-buying it every time would cost money to learn nothing and
    // would make two runs differ for a reason that is not the change under test.
    if (!existsSync(join(TMP, "real-standard.jsonl"))) sh(["--adjudicate", "--n=100", "--ceiling=6"], "adjudicate");
    sh(["--engine", "--n=100", "--ceiling=25"], "engine");
    sh(["--settle", "--ceiling=8"], "settle");
    for (const f of FILES) if (existsSync(join(TMP, f))) copyFileSync(join(TMP, f), join(dir, f));
    writeFileSync(join(dir, "build.json"), JSON.stringify({
      label,
      at: new Date().toISOString(),
      head: spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim(),
      dirty: (spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "").trim().length > 0,
    }, null, 1) + "\n", "utf8");
  }

  const r = spawnSync("npx", ["tsx", join(ROOT, "study", "real.ts"), "--report"],
                      { encoding: "utf8", shell: true, cwd: ROOT });
  const out = r.stdout ?? "";
  console.log(out);
  writeFileSync(join(dir, "report.txt"), out, "utf8");
  console.log(`-> ${dir}`);
}

// ---------------------------------------------------------------------------
function diff(a: string, b: string): void {
  const load = (l: string) => {
    const p = join(STORE, l, "real-engine.jsonl");
    if (!existsSync(p)) throw new Error(`no run stored at ${p}`);
    return byId(jsonl(p));
  };
  const A = load(a), B = load(b);
  const meta = (l: string) => existsSync(join(STORE, l, "build.json"))
    ? JSON.parse(readFileSync(join(STORE, l, "build.json"), "utf8")) : {};
  const headline = (l: string) => {
    const p = join(STORE, l, "report.txt");
    if (!existsSync(p)) return "(no report stored)";
    return (readFileSync(p, "utf8").split("\n").find((x) => /EXCLUDING HARD GATES/.test(x))
         ?? readFileSync(p, "utf8").split("\n").find((x) => /REAL-MAIL ACCURACY/.test(x)) ?? "").trim();
  };

  console.log(`${a}  ${JSON.stringify(meta(a))}\n   ${headline(a)}`);
  console.log(`${b}  ${JSON.stringify(meta(b))}\n   ${headline(b)}`);

  const ids = [...A.keys()].filter((id) => B.has(id));
  console.log(`\n${ids.length} thread(s) in both runs.`);

  const moved = ids.filter((id) => A.get(id).status !== B.get(id).status
                                || A.get(id).classification !== B.get(id).classification);
  console.log(`${moved.length} changed outcome or classification:\n`);
  const shape: Record<string, number> = {};
  for (const id of moved) {
    const x = A.get(id), y = B.get(id);
    const k = `${x.classification}/${x.status}  ->  ${y.classification}/${y.status}`;
    shape[k] = (shape[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(shape).sort((p, q) => q[1] - p[1])) {
    console.log(`  ${String(n).padStart(3)}x  ${k}`);
  }
  // The notes that appear only in B are the mechanism that changed. A diff of outcomes
  // says WHAT moved; this says why, and it is the half that survives into a commit message.
  const fresh: Record<string, number> = {};
  for (const id of moved) {
    const before = new Set<string>(A.get(id).notes ?? []);
    for (const n of (B.get(id).notes ?? []) as string[]) {
      if (!before.has(n)) {
        const k = n.replace(/\d+/g, "N").slice(0, 88);
        fresh[k] = (fresh[k] ?? 0) + 1;
      }
    }
  }
  if (Object.keys(fresh).length) {
    console.log(`\nreasons present only in "${b}":`);
    for (const [k, n] of Object.entries(fresh).sort((p, q) => q[1] - p[1]).slice(0, 12)) {
      console.log(`  ${String(n).padStart(3)}x  ${k}`);
    }
  }
  console.log(`\nthread ids that moved:\n  ${moved.join("\n  ")}`);
}

// ---------------------------------------------------------------------------
if (has("selftest")) selftest();
else if (flag("diff")) {
  const [a, b] = String(flag("diff")).split(",");
  if (!a || !b) throw new Error("--diff=before,after");
  diff(a, b);
} else if (flag("label")) {
  runLabelled(String(flag("label")), has("report"), has("fresh"));
} else {
  console.log(readFileSync(join(ROOT, "study", "harness.ts"), "utf8").split("\n").slice(0, 28).join("\n"));
}
