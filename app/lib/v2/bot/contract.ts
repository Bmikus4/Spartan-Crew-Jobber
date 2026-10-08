// ============================================================================
// Form contracts: what a form looked like on the day the bot was benched against it.
// ----------------------------------------------------------------------------
// Ben, 10-06: "the harness needs to know when any UI changes were made so that it can
// update the protocol." A form is checked against its contract before every fill, and the
// request it sends is checked again before it leaves the browser. Any field-set change
// BLOCKS the write; a version change alone only WARNS, because OnSinch ships new script
// tags with no change to the form, and blocking on those would stop the bot for nothing.
//
// Field names are compared with their numeric indexes collapsed ([0] -> [n]): a position
// with two requirements renders SlotRequirement[0] and [1], one with none renders [0],
// and neither is a change to the form.
// ============================================================================

export type FieldShape = { name: string; type: string; required: boolean; hidden: boolean };

export type VersionSignals = {
  /** Footer "Appka 3.2.137". */
  appka: string | null;
  /** The `?<n>` cache-buster on OnSinch's own scripts. */
  scriptTag: string | null;
  /** The wizard's hashed bundle, e.g. newJobForm.d7l4n0pt.js. */
  bundle?: string | null;
};

export type Contract = {
  surface: string;
  version: VersionSignals;
  fields: FieldShape[];
  /** The only fields the bot may set on this surface. */
  fill: string[];
  /** Fields the page's own script may change when a filled field changes. */
  derived: string[];
  benched_at: string;
};

export type Verdict = { tier: "ok" | "warn" | "block"; reasons: string[] };

export const normaliseName = (n: string) => n.replace(/\[\d+\]/g, "[n]");

export function normaliseFields(fields: FieldShape[]): FieldShape[] {
  const seen = new Map<string, FieldShape>();
  for (const f of fields) {
    const name = normaliseName(f.name);
    if (/_Token\]/.test(name)) continue;
    const key = `${name}|${f.type}`;
    const prior = seen.get(key);
    seen.set(key, prior ? { ...prior, required: prior.required || f.required } : { ...f, name });
  }
  return [...seen.values()].sort((a, b) => (a.name + a.type).localeCompare(b.name + b.type));
}

export function checkContract(c: Contract, observed: { version: VersionSignals; fields: FieldShape[] }): Verdict {
  const block: string[] = [];
  const warn: string[] = [];
  const want = new Map(normaliseFields(c.fields).map((f) => [`${f.name}|${f.type}`, f]));
  const got = new Map(normaliseFields(observed.fields).map((f) => [`${f.name}|${f.type}`, f]));
  for (const [k, f] of want) {
    const g = got.get(k);
    if (!g) { block.push(`field gone: ${k}`); continue; }
    if (g.required !== f.required) block.push(`required changed: ${k} ${f.required} -> ${g.required}`);
    if (g.hidden !== f.hidden) block.push(`hidden changed: ${k} ${f.hidden} -> ${g.hidden}`);
  }
  for (const k of got.keys()) if (!want.has(k)) block.push(`field new: ${k}`);
  const names = new Set([...got.values()].map((f) => f.name));
  for (const f of c.fill) if (!names.has(normaliseName(f))) block.push(`fill target missing: ${f}`);
  for (const key of ["appka", "scriptTag", "bundle"] as const) {
    const a = c.version[key] ?? null;
    const b = observed.version[key] ?? null;
    if (a !== null && a !== b) warn.push(`version ${key}: ${a} -> ${b}`);
  }
  if (block.length) return { tier: "block", reasons: [...block, ...warn] };
  return { tier: warn.length ? "warn" : "ok", reasons: warn };
}

// ---------------------------------------------------------------------------
// The submission guard. The page's own JavaScript builds the request; this reads it back
// before it leaves and refuses it unless the only values that moved are the ones the
// operation asked for (plus what the contract declares the page derives from them).
// ---------------------------------------------------------------------------

export type Pairs = [string, string][];

/** multipart/form-data or urlencoded body -> ordered name/value pairs. */
export function parseBody(body: string, contentType: string): Pairs {
  if (/multipart\/form-data/i.test(contentType)) {
    const boundary = /boundary=(.+)$/i.exec(contentType)?.[1]?.trim();
    if (!boundary) return [];
    const out: Pairs = [];
    for (const part of body.split(`--${boundary}`)) {
      const m = /Content-Disposition: form-data; name="([^"]*)"(?:; filename="[^"]*")?\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n$/.exec(part);
      if (m) out.push([m[1], m[2]]);
    }
    return out;
  }
  return [...new URLSearchParams(body)];
}

/**
 * The builder's own scripts re-spell dates and times on blur ("1.12.2027" <-> "01.12.2027",
 * "9:00" <-> "09:00"), including on fields the bot did not touch. Those spellings are the
 * same value, so [date] and [time] fields are compared as values; everything else exactly.
 */
export function canonical(name: string, value: string): string {
  if (/\[date\]$/.test(name)) {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/\[time\]$/.test(name)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  return value;
}

/** Multi-valued names are joined so a reordered list is a change and a repeated one is not. */
export function asMap(pairs: Pairs): Map<string, string> {
  const m = new Map<string, string[]>();
  for (const [k, v] of pairs) m.set(k, [...(m.get(k) ?? []), canonical(k, v)]);
  return new Map([...m].map(([k, v]) => [k, v.join("\u0001")]));
}

export function unexpectedChanges(before: Pairs, sent: Pairs, intended: Record<string, string>, derived: string[]): string[] {
  const a = asMap(before);
  const b = asMap(sent);
  const allowed = new Set([...Object.keys(intended), ...derived].map(normaliseName));
  const out: string[] = [];
  for (const [k, v] of Object.entries(intended)) if (b.get(k) !== canonical(k, v)) out.push(`intended ${k}=${v} but sent ${b.get(k) ?? "(absent)"}`);
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (/_Token\]/.test(k)) continue;
    if (a.get(k) === b.get(k)) continue;
    if (allowed.has(normaliseName(k))) continue;
    out.push(`unintended ${k}: ${a.get(k) ?? "(absent)"} -> ${b.get(k) ?? "(absent)"}`);
  }
  return out;
}
