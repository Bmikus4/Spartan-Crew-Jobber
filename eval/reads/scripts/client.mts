// client_resolution_accuracy (A.3: correct client ÷ emails with a client), per metrics.md:297's recipe. Counts only.
import fs from "node:fs";
const J = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const FIRM = new Set((process.argv[2] ?? "strong,adjudicated").split(","));
const truth = fs.readFileSync(".tmp-data/gold/truth.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const orders = new Map(J(".tmp-data/gold/orders.json").map((o: any) => [Number(o.id), o]));
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));
const conf: Record<string, number> = {}; for (const t of truth) conf[`${t.truth?.kind}/${t.truth?.confidence}`] = (conf[`${t.truth?.kind}/${t.truth?.confidence}`] ?? 0) + 1;
const rows = truth.filter((t) => t.truth?.kind === "existing" && FIRM.has(t.truth?.confidence) && dec.has(t.message_id));
let withClient = 0, correct = 0, nullCo = 0, wrong = 0; const wrongIds: string[] = [];
for (const t of rows) {
  const o: any = orders.get(Number(t.truth.orders?.[0])); if (!o) continue;
  withClient++;
  const got = (dec.get(t.message_id) as any).company_id;
  if (got == null) nullCo++; else if (Number(got) === Number(o.company_id)) correct++; else { wrong++; wrongIds.push(t.message_id); }
}
console.log({ label_kinds: conf, firm_existing_decided: rows.length, with_client: withClient, correct, left_without_client: nullCo, wrong_client: wrong, wrongIds });
