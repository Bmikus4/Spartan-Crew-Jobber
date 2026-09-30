// ============================================================================
// admit — the one door from a model's answer into the engine.
// ----------------------------------------------------------------------------
// Everything a model returns was read from an email, and anyone can send one. Tool
// calling fixes the shape a model is ASKED for and enforces nothing, so its answer is
// untrusted input here, not the schema it was given. Measured 2026-09-29 over 749
// stored threads: facts held keys the schema never offered (requests[].customer_reference
// x4) and integer ids the model echoed back (requests[].place_id x80, profession_id x21),
// and compile trusted both — a model's place_id or profession_id reached the OnSinch
// body wherever compile had no value of its own for that block.
//
// Three rules, each lossless on that history:
//   1. Only the schema's fields, in the schema's types. 966/966 dates, 804/804 starts,
//      736/736 ends, 824/824 sizes and every classification already conform.
//   2. No ids. compile re-derives place_id from the block's venue wording and
//      profession_id from the alias store on every pass; one arriving from the model
//      is the model deciding identity.
//   3. A value that says WHO must be on the page: every 3+ character token of the
//      company, contact address and PO occurs in the thread, and a phone's digits do.
//      Replayed through this file over the 749 threads: 1 refusal in 1,353 values
//      (company 434/435, email 434/434, phone 367/367, PO 117/117). The venue is
//      exempt — 2.8% of stored venues are enrichments the model is right to make
//      ("Royal Albert Hall" for "RAH").
//
// What this cannot stop is a sender who TYPES another client's name: that passes rule
// 3 by construction. Accepted, not overlooked (Ben, 2026-09-29; see the bind in compiler.ts).
// ============================================================================
import type { Classification, ConversationFacts } from "./types";
import type { ClassifyResult } from "./reason";

export interface Evidence {
  tokens: Set<string>;
  text: string;
  phones: string[];
}

/** Everything the thread's authors put on the page: who it came from, the subject, the body. */
export function evidenceOf(messages: Array<{ from?: string; subject?: string; body?: string }>): Evidence {
  const text = messages.map((m) => `${m.from ?? ""}\n${m.subject ?? ""}\n${m.body ?? ""}`).join("\n").toLowerCase();
  return {
    tokens: new Set(text.match(/[a-z0-9]{3,}/g) ?? []),
    text,
    // Runs that may hold a phone number with its spacing. Digits are compared per run,
    // never across the whole text, where unrelated numbers would concatenate into a match.
    phones: (text.match(/\+?\d[\d\s().-]{5,}\d/g) ?? []).map((s) => s.replace(/\D/g, "")),
  };
}

const CLASSES: readonly Classification[] = ["new-job", "update", "confirmation-only", "not-a-job"];
const PRIORITIES = ["low", "medium", "high"] as const;
/** Four times the largest block ever requested (50, over 824 stored requests). */
const MAX_SIZE = 200;
const MAX_REQUESTS = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

const SCALARS = ["company_name", "contact_name", "contact_email", "contact_phone", "customer_reference", "location_text"] as const;
const REQUEST_TEXT = { task: 500, profession_hint: 200, location_text: 200 } as const;

function text(v: unknown, cap: number): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, cap) : undefined;
}

function onThePage(k: (typeof SCALARS)[number], v: string, ev: Evidence): boolean {
  if (k === "contact_phone") {
    // "01233 328130 ext 1502": the extension is never written against the number.
    const d = v.replace(/\s*(?:ext\.?|extension|x)\s*:?\s*\d+\s*$/i, "").replace(/\D/g, "");
    return d.length >= 7 && ev.phones.some((p) => p.includes(d.slice(-9)));
  }
  if (k === "contact_email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return false;
  // A legal form says nothing about WHO: "Big Events Ltd" for an email signed "Big Events".
  const toks = (v.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !(k === "company_name" && LEGAL_FORM.has(t)));
  return toks.every((t) => ev.tokens.has(t) || ev.text.includes(t));
}

const GATED = new Set(["company_name", "contact_email", "contact_phone", "customer_reference"]);
const LEGAL_FORM = new Set(["ltd", "limited", "plc", "llp", "llc", "inc", "the", "and", "group"]);

export function admitFacts(raw: unknown, ev: Evidence): { facts: ConversationFacts; refused: string[] } {
  const refused: string[] = [];
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const facts: ConversationFacts = { requests: [] };

  for (const k of Object.keys(r)) {
    if (k !== "requests" && !(SCALARS as readonly string[]).includes(k)) refused.push(k);
  }
  for (const k of SCALARS) {
    const v = text(r[k], 200);
    if (v === undefined) continue;
    if (GATED.has(k) && !onThePage(k, v, ev)) { refused.push(`${k} "${v}"`); continue; }
    facts[k] = v;
  }

  const reqs = Array.isArray(r.requests) ? r.requests.slice(0, MAX_REQUESTS) : [];
  reqs.forEach((item, i) => {
    const q = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const out: ConversationFacts["requests"][number] = {};
    for (const k of Object.keys(q)) {
      if (!["date", "start_time", "end_time", "size", ...Object.keys(REQUEST_TEXT)].includes(k)) refused.push(`requests[${i}].${k}`);
    }
    if (typeof q.date === "string" && DATE.test(q.date)) out.date = q.date;
    else if (q.date != null && q.date !== "") refused.push(`requests[${i}].date "${String(q.date)}"`);
    for (const k of ["start_time", "end_time"] as const) {
      if (typeof q[k] === "string" && TIME.test(q[k] as string)) out[k] = q[k] as string;
      else if (q[k] != null && q[k] !== "") refused.push(`requests[${i}].${k} "${String(q[k])}"`);
    }
    if (typeof q.size === "number" && Number.isInteger(q.size) && q.size >= 1 && q.size <= MAX_SIZE) out.size = q.size;
    else if (q.size != null) refused.push(`requests[${i}].size ${JSON.stringify(q.size)}`);
    for (const [k, cap] of Object.entries(REQUEST_TEXT) as [keyof typeof REQUEST_TEXT, number][]) {
      const v = text(q[k], cap);
      if (v !== undefined) out[k] = v;
    }
    facts.requests.push(out);
  });

  return { facts, refused };
}

export function admitClassification(raw: unknown): ClassifyResult {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = typeof r.order_title === "string" ? text(r.order_title, 120) : undefined;
  return {
    classification: CLASSES.includes(r.classification as Classification) ? (r.classification as Classification) : "not-a-job",
    priority: PRIORITIES.includes(r.priority as (typeof PRIORITIES)[number]) ? (r.priority as ClassifyResult["priority"]) : "low",
    job_summary: text(r.job_summary, 1000) ?? "",
    ...(title ? { order_title: title } : {}),
    // Any truthy spelling holds: a missed cancellation writes to a job being called off,
    // a spurious one only holds a write for a human.
    ...(r.cancellation != null && r.cancellation !== false && r.cancellation !== "false" && r.cancellation !== ""
      ? { cancellation: true }
      : {}),
  };
}

export function admitCombined(raw: unknown, ev: Evidence): ClassifyResult & { facts: ConversationFacts; refused: string[] } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const { facts, refused } = admitFacts(r.facts ?? { requests: [] }, ev);
  return { ...admitClassification(r), facts, refused };
}

/** One line for the ticket, or "" when nothing was refused. */
export function describeRefused(refused: string[]): string {
  return refused.length
    ? `ignored from the model's answer — ids and fields it does not supply, or values not in the email: ${refused.join("; ")}`
    : "";
}
