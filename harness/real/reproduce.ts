// ============================================================================
// The baseline proof: every figure of eval/live-week-reads.md, recomputed from the label file
// and production's stored decisions, compared with the number the document states.
// ----------------------------------------------------------------------------
// The expected values are transcribed from the document with its line number. The computed
// values come from the harness's own code (labels.ts, system.ts), never from the reads scripts,
// so a match proves the harness, not the scripts, reproduces the baseline.
// A figure the document takes from another file is marked "cited" and checked against that file.
//
// Four inputs sit outside the gold copy, read only, exactly as the reads scripts read them:
// week-review-1014.json (the 400 and week-review's verdicts), week-truth-acts.json and
// week-truth-orders.json (staff acts, cands.mts), failure-taxonomy.md (the 117 bucketed rows).
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coded } from "../../app/lib/v2/reasons";
import { utcToLondon } from "../../app/lib/v2/bot/ops";
import { ROOT, addr, gold, readJson, fileHash, type GoldDecision, type GoldMessage } from "./data";
import { STRICT, WIDE, has, inq, type Label } from "./labels";
import { readsOutcome, SHOWN, type SystemRow } from "./system";
import { exact, kappa, rate } from "./stats";
import { taxonomy } from "./metrics";

export type Check = { line: number; claim: string; doc: string; harness: string; ok: boolean; /** Words, not a count: shown, never a gate. */ descriptive?: boolean };

const EXTRA = {
  weekReview: join(ROOT, ".tmp-data/week-review-1014.json"),
  acts: join(ROOT, ".tmp-data/week-truth-acts.json"),
  orders: join(ROOT, ".tmp-data/week-truth-orders.json"),
  taxonomy: join(ROOT, "eval/failure-taxonomy.md"),
  doc: join(ROOT, "eval/live-week-reads.md"),
};
export const extraHashes = () => Object.fromEntries(Object.entries(EXTRA).map(([k, p]) => [k, existsSync(p) ? fileHash(p) : "absent"]));

const pc = (k: number, n: number, dp = 1) => `${((100 * k) / n).toFixed(dp)}%`;
const ci = (k: number, n: number, dp = 1) => { const c = exact(k, n); return `${(100 * c.lo).toFixed(dp)}-${(100 * c.hi).toFixed(dp)}`; };
const tally = (xs: string[]) => { const t: Record<string, number> = {}; for (const x of xs) t[x] = (t[x] ?? 0) + 1; return t; };
const show = (t: Record<string, number>, keys: string[]) => keys.map((k) => `${k} ${t[k] ?? 0}`).join(", ");

export function reproduce(labels: Label[], rows: Map<string, SystemRow>): Check[] {
  const out: Check[] = [];
  // The document's own line must carry the first number transcribed from it: a check filed under
  // the wrong line, or a number mistyped, fails here rather than passing on a value nobody wrote.
  const docLines = readFileSync(EXTRA.doc, "utf8").split(/\r?\n/);
  const onLine = (line: number, doc: string) => {
    const n = /\d+(\.\d+)?/.exec(doc)?.[0];
    if (!line || !n) return true;
    return new RegExp("(^|[^0-9.])" + n.replace(".", "[.]") + "([^0-9]|$)").test(docLines[line - 1] ?? "");
  };
  const check = (line: number, claim: string, doc: string, harness: string | number, descriptive = false) =>
    out.push({ line, claim, doc, harness: String(harness), ok: String(harness) === doc && onLine(line, doc), ...(descriptive ? { descriptive } : {}) });
  const R = (l: Label) => rows.get(l.message_id)!;
  const msgs = new Map(gold<GoldMessage[]>("messages.json").map((m) => [m.message_id, m]));
  const dec = new Map(gold<GoldDecision[]>("decisions.json").map((d) => [d.message_id, d]));

  // --- line 5: the 400, joined to messages on (date, subject)
  const wr: any[] = readJson(EXTRA.weekReview);
  const key = (d: string, s: string | null) => `${new Date(d).toISOString()}|${s ?? ""}`;
  const byKey = new Map<string, GoldMessage[]>();
  for (const m of msgs.values()) if (!m.is_from_spartan) byKey.set(key(m.date_iso, m.subject), [...(byKey.get(key(m.date_iso, m.subject)) ?? []), m]);
  const joined = wr.map((r) => byKey.get(key(r.at, r.subject))).filter((h) => h?.length === 1).map((h) => h![0].message_id);
  const ids = new Set(labels.map((l) => l.message_id));
  check(5, "client emails joined to messages.json, and they are the labelled 400", "400 of 400", `${joined.filter((i) => ids.has(i)).length} of ${wr.length}`);

  // --- line 12: unread before the reads (week-review verdicts with no work)
  const unread = wr.filter((r) => r.verdict === "nothing to do" || r.verdict === "handed off").length;
  check(12, "never read before (week-review: nothing to do + handed off)", "291 of 400", `${unread} of ${wr.length}`);
  check(14, "already read", "109", wr.length - unread);

  // --- lines 17-21: reader agreement
  let both = 0, neither = 0, aOnly = 0, bOnly = 0;
  for (const l of labels) { const x = inq(l.A, STRICT), y = inq(l.B, STRICT); if (x && y) both++; else if (!x && !y) neither++; else if (x) aOnly++; else bOnly++; }
  check(17, "readers agree on booking work", "394 of 400 (98.5%, CI 96.8-99.4; kappa 0.97)", `${both + neither} of ${labels.length} (${pc(both + neither, labels.length)}, CI ${ci(both + neither, labels.length)}; kappa ${kappa(both, neither, aOnly, bOnly).toFixed(2)})`);
  const strictNoPortal = labels.filter((l) => l.consensus.strict === "inquiry" && l.excluded !== "portal_notice");
  check(18, "same days asked (booking work, portal notices out)", "109 of 110", `${strictNoPortal.filter((l) => l.A.days === l.B.days).length} of ${strictNoPortal.length}`);
  const crewBoth = strictNoPortal.filter((l) => l.A.crew && l.B.crew);
  check(19, "same crew count where both stated one", "62 of 64", `${crewBoth.filter((l) => l.A.crew === l.B.crew).length} of ${crewBoth.length}`);
  check(20, "labels marked unsure", "170 of 800", `${labels.filter((l) => l.A.sure === "unsure").length + labels.filter((l) => l.B.sure === "unsure").length} of ${2 * labels.length}`);
  const adj = tally(labels.filter((l) => l.adjudicate).map((l) => (/^third reader V/.test(l.adjudicate!) ? "V differences" : l.adjudicate === "readers disagree on booking work" ? "disagreements" : "other")));
  check(20, "adjudicate.csv: disagreements, V differences, other rows", "6, 2, 28", `${adj.disagreements ?? 0}, ${adj["V differences"] ?? 0}, ${adj.other ?? 0}`);
  const withV = labels.filter((l) => l.V);
  const agreedV = withV.filter((l) => inq(l.A, STRICT) === inq(l.B, STRICT));
  const vHit = agreedV.filter((l) => inq(l.V, STRICT) === inq(l.A, STRICT));
  const vDays = agreedV.filter((l) => inq(l.A, STRICT) && inq(l.V, STRICT));
  check(21, "reader-V matches the pair where they agreed", "38 of 40 (95%, CI 83-99%)", `${vHit.length} of ${agreedV.length} (${pc(vHit.length, agreedV.length, 0)}, CI ${ci(vHit.length, agreedV.length, 0)}%)`);
  check(21, "reader-V day sets matching", "10 of 10", `${vDays.filter((l) => l.V!.days === l.A.days).length} of ${vDays.length}`);
  // Descriptive, not a count: what V read against what the pair read, by the labels.
  const vMiss = agreedV.filter((l) => inq(l.V, STRICT) !== inq(l.A, STRICT)).map((l) => `${l.V!.asks} vs ${has(l.A, "change") || has(l.B, "change") ? "change" : has(l.A, "new_booking") && has(l.B, "new_booking") ? "booking" : l.A.asks}`).sort();
  check(21, "reader-V's 2 differences: what V read vs what the pair read", "po_only vs change; quote_or_availability vs booking", vMiss.join("; "), true);
  const split = withV.filter((l) => inq(l.A, STRICT) !== inq(l.B, STRICT));
  const sideA = split.filter((l) => inq(l.V, STRICT) === inq(l.A, STRICT)).length;
  check(21, "on the pair's splits, reader-V sides with A / with B", "4 / 2", `${sideA} / ${split.length - sideA}`);

  // --- lines 25-29: what the 400 are
  const work = labels.filter((l) => l.consensus.strict === "inquiry");
  check(25, "booking work, both readers", "136", work.length);
  const portal = work.filter((l) => l.excluded === "portal_notice");
  check(26, "portal notices among them; distinct senders", "26; 1", `${portal.length}; ${new Set(portal.map((l) => addr(msgs.get(l.message_id)!.from_address))).size}`);
  const done = work.filter((l) => l.excluded === "already_done");
  const basis = (re: RegExp) => done.filter((l) => re.test(l.excluded_basis ?? "")).length;
  check(27, "already done when decided", "20", done.length);
  check(27, "of these: confirmed in the snapshot / R in neither snapshot / not checked",
    "14 / 4 / 2", `${basis(/confirmed: /)} / ${basis(/in neither snapshot/)} / ${basis(/not checked/)}`);
  const outst = work.filter((l) => !l.excluded);
  check(28, "outstanding requests for booking work", "90", outst.length);
  const quotes = labels.filter((l) => l.consensus.quote_only);
  check(29, "quote or availability only, both readers", "23", quotes.length);

  // --- line 31: the headline before B42
  const silent = outst.filter((l) => !SHOWN(R(l).outcome));
  check(31, "silent misses over all client mail; inquiry_recall", "16 of 90; 74/90 = 82.2% (CI 72.7-89.5)", `${silent.length} of ${outst.length}; ${rate(outst.length - silent.length, outst.length)}`);
  const silentNone = silent.filter((l) => R(l).outcome === "none");
  check(32, "silent misses decided none; of them, none_nothing_to_do", "8; 8", `${silentNone.length}; ${silentNone.filter((l) => R(l).code === "none_nothing_to_do").length}`);

  // --- lines 33-36: staff acts and our replies (cands.mts)
  const acts: any[] = readJson(EXTRA.acts);
  const ordersW = new Map(readJson<any[]>(EXTRA.orders).map((o) => [Number(o.id), o]));
  const ordersG = new Map(gold<any[]>("orders.json").map((o) => [Number(o.id), o]));
  const daysOf = (o: any) => { const s = new Set<string>(); for (const j of [].concat(o?.Job ?? [])) for (const t of [].concat((j as any)?.SlotTeam ?? [])) for (const sl of [].concat((t as any)?.Slot ?? [])) { const b = (sl as any).beginning; if (b) try { s.add(utcToLondon(String(b)).date); } catch { /* a time London skips */ } } return s; };
  const byThread = new Map<string, GoldMessage[]>();
  for (const m of msgs.values()) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
  const staffOnDay = (l: Label) => {
    const d = dec.get(l.message_id)!, t0 = Date.parse(msgs.get(l.message_id)!.date_iso);
    const days = new Set([...l.A.days.split(";"), ...l.B.days.split(";")].filter(Boolean));
    const hits = d.company_id ? acts.filter((a) => Number(a.company_id) === Number(d.company_id) && String(a.by) !== "2257" && Date.parse(a.at) >= t0 - 3600e3 && Date.parse(a.at) <= t0 + 72 * 3600e3) : [];
    return hits.filter((a) => { const o = ordersW.get(Number(a.order_id)) ?? ordersG.get(Number(a.order_id)); return [...days].some((x) => daysOf(o).has(x)); }).length;
  };
  const replyH = (l: Label) => {
    const m = msgs.get(l.message_id)!, t0 = Date.parse(m.date_iso);
    const h = (byThread.get(m.thread_id) ?? []).filter((x) => x.is_from_spartan && Date.parse(x.date_iso) > t0).map((x) => (Date.parse(x.date_iso) - t0) / 3600e3).sort((a, b) => a - b)[0];
    return h ?? null;
  };
  const noneNothing = silentNone.filter((l) => R(l).code === "none_nothing_to_do");
  const actedNone = noneNothing.filter((l) => staffOnDay(l) > 0).map((l) => l.message_id).sort();
  check(33, "of the 8 none, staff acted on the named day", "4: 1a13fd80597e6e43, 1a13fd94ac637812, 1a14105b82e3493e, 1a159376628160f2", `${actedNone.length}: ${actedNone.join(", ")}`);
  const tax = taxonomy();
  const lw = labels.find((l) => l.message_id === "1a13fd94ac637812")!;
  check(34, "1a13fd94ac637812: taxonomy bucket; both readers; staff acts on its day", "label_wrong; booking work; yes", `${tax.get(lw.message_id)?.bucket}; ${lw.consensus.strict === "inquiry" ? "booking work" : lw.consensus.strict}; ${staffOnDay(lw) > 0 ? "yes" : "no"}`);
  check(35, "the other 4 of the 8: no staff act on a named day", "4", noneNothing.filter((l) => staffOnDay(l) === 0).length);
  const nr = silent.filter((l) => R(l).outcome === "needs-reply");
  const nrReply = nr.map((l) => ({ id: l.message_id, h: replyH(l) }));
  check(36, "needs-reply silent misses; staff acted on the named day", "8; 4", `${nr.length}; ${nr.filter((l) => staffOnDay(l) > 0).length}`);
  check(36, "our first reply within 2 h; the one that waited", "7; 1a14638ee5140233 61 h", `${nrReply.filter((x) => x.h != null && x.h <= 2).length}; ${nrReply.filter((x) => x.h == null || x.h > 2).map((x) => `${x.id} ${x.h == null ? "no reply" : Math.round(x.h) + " h"}`).join(", ")}`);

  // --- lines 37-38: other denominators
  const taxDoc = readFileSync(EXTRA.taxonomy, "utf8");
  check(37, "staff-acted count 4/84 (cited from failure-taxonomy.md:10)", "present", /4 real inquiries got no item/.test(taxDoc) && /denominator is 84 real inquiries/.test(taxDoc) ? "present" : "absent");
  const allQ = labels.filter((l) => (l.consensus.strict === "inquiry" && !l.excluded) || l.consensus.quote_only);
  const allQs = allQ.filter((l) => !SHOWN(R(l).outcome)).length;
  check(37, "every quote counted as an inquiry", "24 of 113 (78.8%, CI 70.1-85.9)", `${allQs} of ${allQ.length} (${pc(allQ.length - allQs, allQ.length)}, CI ${ci(allQ.length - allQs, allQ.length)})`);
  const b42q = labels.filter((l) => l.consensus.b42_shifts);
  const b42 = [...outst, ...b42q];
  const b42s = b42.filter((l) => !SHOWN(R(l).outcome)).length;
  check(38, "B42 adds inquiries / silent misses", "15 / 2", `${b42q.length} / ${b42q.filter((l) => !SHOWN(R(l).outcome)).length}`);
  check(38, "B42 working figure", "18 of 105, inquiry_recall 82.9% (CI 74.3-89.5)", `${b42s} of ${b42.length}, inquiry_recall ${pc(b42.length - b42s, b42.length)} (CI ${ci(b42.length - b42s, b42.length)})`);

  // --- lines 41-50: quotes, items shown, NONE
  const taxSilent = ["1a1399db710f7409", "1a13f8312ae75c73", "1a140632ce4d5e99", "1a144c619a140ea6"];
  check(41, "of the taxonomist's 4 strict silent misses: quote-only for both readers", "3", taxSilent.filter((id) => labels.find((l) => l.message_id === id)?.consensus.quote_only).length);
  const creates = labels.filter((l) => R(l).kind === "write" && (R(l).decision.ops ?? []).some((o: any) => (o.op ?? o).kind === "create_order"));
  const cNew = creates.filter((l) => l.consensus.new_booking);
  const cQuote = creates.filter((l) => !l.consensus.new_booking && (has(l.A, "quote_or_availability") || has(l.B, "quote_or_availability")));
  check(42, "create_order writes; on quote requests", "19; 7", `${creates.length}; ${cQuote.length}`);
  const items = labels.filter((l) => SHOWN(R(l).outcome));
  check(46, "items shown: listed + writes that ran", "104: 81 + 23", `${items.length}: ${items.filter((l) => R(l).outcome === "listed").length} + ${items.filter((l) => R(l).outcome === "check").length}`);
  const anyReq = items.filter((l) => l.consensus.wide === "inquiry").length, workItems = items.filter((l) => l.consensus.strict === "inquiry").length;
  check(47, "items both readers call a request; booking work", "96 (92.3%, CI 85.4-96.6); 74 (71.2%)", `${anyReq} (${pc(anyReq, items.length)}, CI ${ci(anyReq, items.length)}); ${workItems} (${pc(workItems, items.length)})`);
  const noth = items.filter((l) => l.consensus.nothing);
  check(48, "items both readers call nothing; all listed", "5 (4.8%); 5", `${noth.length} (${pc(noth.length, items.length)}); ${noth.filter((l) => R(l).outcome === "listed").length}`);
  check(48, "display_precision", "≈ 92%", `≈ ${Math.round((100 * anyReq) / items.length)}%`);
  check(50, "create_order writes on a new booking (both) / on quotes / on nothing", "12 (63%) / 7 / 0", `${cNew.length} (${pc(cNew.length, creates.length, 0)}) / ${cQuote.length} / ${creates.filter((l) => l.consensus.nothing).length}`);

  // --- lines 56-62: the detail table
  const by = (ls: Label[]) => tally(ls.map((l) => R(l).outcome));
  const O = ["none", "listed", "check", "needs-reply"];
  check(56, "system outcome over the 400", "none 278, listed 81, check 23, needs-reply 18", show(by(labels), O));
  check(57, "booking work (136) by outcome", "listed 59, none 54, check 15, needs-reply 8", show(by(work), ["listed", "none", "check", "needs-reply"]));
  const work54 = tally(work.filter((l) => R(l).outcome === "none").map((l) => R(l).code));
  check(58, "the 54 none by code", "none_not_client 26, none_already_booked 16, none_already_as_asked 2, other 2, none_nothing_to_do 8",
    show(work54, ["none_not_client", "none_already_booked", "none_already_as_asked", "other", "none_nothing_to_do"]));
  const others = work.filter((l) => R(l).outcome === "none" && R(l).code === "other");
  check(58, "the 2 'other' are both 'already as asked'", "2", others.filter((l) => /^already as asked/.test(String(R(l).decision.reason))).length);
  const disp = labels.filter((l) => l.consensus.strict === "disputed");
  check(59, "readers disagree, by outcome", "6: none 2, listed 4", `${disp.length}: ${show(by(disp), ["none", "listed"])}`);
  check(60, "quote-only (23) by outcome", "listed 9, check 6, needs-reply 6, none 2", show(by(quotes), ["listed", "check", "needs-reply", "none"]));
  const nothing = labels.filter((l) => l.consensus.nothing);
  check(61, "both readers nothing, by outcome", "none 176, listed 5", show(by(nothing), ["none", "listed"]));
  const taxRows = labels.filter((l) => tax.has(l.message_id));
  const TV: Record<string, string> = { "no card": "none", "needs-reply": "needs-reply", "check card": "check", listed: "listed" };
  check(62, "taxonomy rows; TV outcome derived the same way", "117; 117", `${taxRows.length}; ${taxRows.filter((l) => TV[tax.get(l.message_id)!.tv.replace(" (not listed)", "")] === R(l).outcome).length}`);
  const lwRows = taxRows.filter((l) => tax.get(l.message_id)!.bucket === "label_wrong");
  check(62, "label_wrong rows not booking work for either reader", "26 of 37", `${lwRows.filter((l) => !inq(l.A, STRICT) && !inq(l.B, STRICT)).length} of ${lwRows.length}`);
  const sysMiss = taxRows.filter((l) => !/label_wrong|genuinely_ambiguous|not a miss/.test(tax.get(l.message_id)!.bucket));
  const sysWork = sysMiss.filter((l) => l.consensus.strict === "inquiry");
  check(62, "system misses that are booking work for both", "57 of 77", `${sysWork.length} of ${sysMiss.length}`);
  const rest = sysMiss.filter((l) => l.consensus.strict !== "inquiry");
  check(62, "the other 20: quote requests / nothing for both / disputed", "15 / 2 / 3",
    `${rest.filter((l) => l.consensus.quote_only).length} / ${rest.filter((l) => !inq(l.A, WIDE) && !inq(l.B, WIDE)).length} / ${rest.filter((l) => l.consensus.strict === "disputed").length}`);

  // --- line 73 and the cross-check of the outcome code itself
  const c90 = exact(74, 90);
  check(73, "n and interval half-width on the headline", "n = 90; about ±8 points", `n = ${outst.length}; about ±${Math.round((100 * (c90.hi - c90.lo)) / 2)} points`);
  const same = labels.filter((l) => readsOutcome(R(l)) === R(l).outcome).length;
  check(0, "TV outcome (v2Source) equals the reads scorer's outcome (score.mts:22-30) on every email", "400 of 400", `${same} of ${labels.length}`);
  return out;
}

export function reproductionMarkdown(checks: Check[]): string {
  const figs = checks.filter((c) => !c.descriptive), words = checks.filter((c) => c.descriptive);
  return [
    `**Reproduction: ${figs.filter((c) => c.ok).length} of ${figs.length} figures match eval/live-week-reads.md exactly.** Descriptions checked against the labels: ${words.filter((c) => c.ok).length} of ${words.length} agree.`, "",
    "| doc line | figure | document | harness | match |", "|---|---|---|---|---|",
    ...checks.map((c) => `| ${c.line || "-"} | ${c.claim} | ${c.doc} | ${c.harness} | ${c.ok ? "yes" : c.descriptive ? "**no** (description)" : "**NO**"} |`),
  ].join("\n");
}
