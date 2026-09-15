// ============================================================================
// WHY DO 19 ORDERS HAVE MORE THAN ONE THREAD?
// ----------------------------------------------------------------------------
// Four explanations fit the shape, and they need completely different fixes:
//
//   A. GMAIL SPLIT a real conversation across thread ids. Then the threads hold the SAME
//      messages, or consecutive halves of one exchange, and nothing is mis-attributed -
//      the join key is wrong, not the link.
//   B. matchExistingOrder ATTACHED a second enquiry to an order that already existed,
//      because the rule is company + date and a client can have two jobs on one day.
//      Then one claim is a real mis-attribution.
//   C. The same email ARRIVED TWICE under different thread ids (forward, re-send, the
//      n8n intake replaying), so both threads are the same enquiry.
//   D. Genuinely different clients collided on an id through some other route.
//
// Distinguishing them needs the message ids, which tell you whether two threads hold the
// same emails - that single fact separates A and C from B and D.
//
// Read-only. No writes anywhere.
//   npx tsx scripts/analyse-contested.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

const norm = (s: unknown) =>
  String(s ?? "").replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();

(async () => {
  const rows = (await sql`select thread_id, state from conversation_state`) as Array<{ thread_id: string; state: any }>;
  const stateOf = new Map<string, any>();
  const byOrder = new Map<number, string[]>();
  for (const r of rows) {
    const s = typeof r.state === "string" ? JSON.parse(r.state) : (r.state ?? {});
    stateOf.set(r.thread_id, s);
    const id = Number(s.onsinch_order_id);
    if (Number.isInteger(id) && id > 0) byOrder.set(id, [...(byOrder.get(id) ?? []), r.thread_id]);
  }
  const contested = [...byOrder.entries()].filter(([, v]) => v.length > 1);

  const msgs = (await sql`
    select thread_id, message_id, from_address, date_iso, subject, is_from_spartan
    from thread_messages order by date_iso asc`) as Array<any>;
  const byThread = new Map<string, Array<any>>();
  for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);

  const verdicts = new Map<string, number>();
  const detail: string[] = [];

  for (const [order_id, threads] of contested.sort((a, b) => b[1].length - a[1].length)) {
    const info = threads.map((t) => {
      const s = stateOf.get(t) ?? {};
      const ms = byThread.get(t) ?? [];
      const notes = (s.notes ?? []).map(String);
      return {
        t,
        subj: norm(s.subject ?? ms[0]?.subject),
        ids: new Set(ms.map((m: any) => String(m.message_id))),
        from: new Set(ms.filter((m: any) => !m.is_from_spartan).map((m: any) => String(m.from_address || "").toLowerCase())),
        first: ms[0]?.date_iso ?? null,
        last: ms[ms.length - 1]?.date_iso ?? null,
        n: ms.length,
        created: (s.order_action_log ?? []).some((a: any) => a.kind === "create" && a.ok),
        matched: notes.some((n: string) => /matched existing OnSinch order/i.test(n)),
        company: s.company_id ?? null,
      };
    });

    // Do any two claims hold the SAME email? That is the fact that separates a split
    // conversation from two different enquiries, and nothing else in the data does.
    let sharedIds = 0, sameSubject = 0, sharedSender = 0, pairs = 0;
    for (let i = 0; i < info.length; i++)
      for (let j = i + 1; j < info.length; j++) {
        pairs++;
        const a = info[i]!, b = info[j]!;
        if ([...a.ids].some((x) => b.ids.has(x))) sharedIds++;
        if (a.subj && a.subj === b.subj) sameSubject++;
        if ([...a.from].some((x) => b.from.has(x))) sharedSender++;
      }

    const creators = info.filter((x) => x.created).length;
    const matchers = info.filter((x) => x.matched).length;
    const companies = new Set(info.map((x) => String(x.company)));

    let verdict: string;
    if (sharedIds) verdict = "A/C same emails in both threads";
    else if (sameSubject === pairs && sharedSender === pairs) verdict = "A/C same subject + same sender, no shared ids";
    else if (creators <= 1 && matchers >= 1 && companies.size === 1) verdict = "B second enquiry matched onto an existing order";
    else if (companies.size > 1) verdict = "D different companies";
    else verdict = "unclassified";
    verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);

    detail.push(
      `#${order_id}  ${threads.length} claims  ${verdict}\n` +
      `    created=${creators} matched=${matchers} companies={${[...companies].join(",")}} sharedEmails=${sharedIds}/${pairs} sameSubject=${sameSubject}/${pairs} sameSender=${sharedSender}/${pairs}\n` +
      info.map((x) =>
        `    ${x.t.slice(0, 10)} n=${String(x.n).padStart(2)} ${String(x.first ?? "").slice(0, 16)}..${String(x.last ?? "").slice(0, 16)}` +
        ` ${x.created ? "CREATED" : x.matched ? "matched" : "—      "} co=${x.company ?? "?"}  "${x.subj.slice(0, 58)}"`
      ).join("\n")
    );
  }

  console.log(`contested orders: ${contested.length}\n`);
  console.log("VERDICTS");
  for (const [v, n] of [...verdicts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${v}`);
  console.log("\n" + detail.join("\n\n"));
})();
