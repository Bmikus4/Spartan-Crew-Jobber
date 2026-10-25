import fs from "node:fs";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const joined = fs.readFileSync(".tmp-v2/reads/joined.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));
const csv = (p: string) => fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const c = l.split(","); return [c[0], c] as [string, string[]]; });
const A = new Map([...csv("eval/reads/A-1.csv"), ...csv("eval/reads/A-2.csv")]), B = new Map([...csv("eval/reads/B-1.csv"), ...csv("eval/reads/B-2.csv")]);
const portal = new Set<string>(J(".tmp-v2/reads/none-inquiries.json").none_not_client);
const has = (a: string | undefined, k: string) => (a ?? "").split("+").includes(k);
// quotes that are not strict inquiries
const q: Record<string, number> = {}; for (const [id, sys] of joined) if (has(A.get(id)?.[1], "quote_or_availability") && has(B.get(id)?.[1], "quote_or_availability") && !/new_booking|change|cancel/.test(A.get(id)![1] + B.get(id)![1])) q[sys] = (q[sys] ?? 0) + 1;
// create_order writes vs readers' new_booking
let creates = 0, createsNew = 0; const createOther: string[] = [];
for (const [id] of joined) { const d: any = dec.get(id); if (d.kind !== "write") continue; if (!(d.decision.ops ?? []).some((o: any) => (o.op ?? o).kind === "create_order")) continue; creates++; if (has(A.get(id)?.[1], "new_booking") && has(B.get(id)?.[1], "new_booking")) createsNew++; else createOther.push(`${id}:${A.get(id)?.[1]}/${B.get(id)?.[1]}`); }
// day agreement on strict consensus rows
let both = 0, sameDays = 0, sameCrew = 0, crewBoth = 0;
for (const [id, , , , , , strict] of joined) { if (strict !== "inquiry" || portal.has(id)) continue; both++; const a = A.get(id)!, b = B.get(id)!; if ((a[3] ?? "") === (b[3] ?? "")) sameDays++; if (a[4] && b[4]) { crewBoth++; if (a[4] === b[4]) sameCrew++; } }
// new_booking consensus (excluding portal) by outcome
const nb: Record<string, number> = {}; for (const [id, sys] of joined) if (!portal.has(id) && has(A.get(id)?.[1], "new_booking") && has(B.get(id)?.[1], "new_booking")) nb[sys] = (nb[sys] ?? 0) + 1;
console.log({ quote_only_consensus_by_outcome: q, create_writes: creates, create_writes_readers_new_booking: createsNew, create_other: createOther, strict_rows_excl_portal: both, same_days: sameDays, crew_both_stated: crewBoth, same_crew: sameCrew, new_booking_consensus_by_outcome: nb });
