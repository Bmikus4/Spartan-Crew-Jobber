// ============================================================================
// Sweep 12 months of bookings@spartancrew.co.uk into the TEST corpus.
// ----------------------------------------------------------------------------
// Runs from this terminal, not n8n: no workflow to build, no thousands of n8n
// executions, no 60-second function ceiling, and the live bookings workflow is
// never touched.
//
// Read-only throughout. It lists and reads mail; it never labels, sends or deletes,
// so the live workflow's label ledger is undisturbed.
//
// Paged by THREAD, not message. Gmail's list gives a threadId per message, so
// collapsing to distinct threads first turns tens of thousands of message fetches
// into a few thousand thread fetches — the difference between minutes and hours.
//
// DRY RUN BY DEFAULT: counts what is there and shows a sample, writes nothing.
//
//   npx tsx scripts/sweep-gmail.ts --dry              # what is in the last 12 months
//   npx tsx scripts/sweep-gmail.ts --months 12        # sweep and store
//   npx tsx scripts/sweep-gmail.ts --months 1 --apply # one month, to check the shape
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";
import { storeSweptThread, sweepStats } from "../app/lib/sweepDb";

loadEnv();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry") || !argv.includes("--apply");
const MONTHS = Number(argv[argv.indexOf("--months") + 1]) || 12;
const MAILBOX = "bookings@spartancrew.co.uk";

const CLIENT_ID = requireEnv("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");
const REFRESH = requireEnv("GMAIL_REFRESH_TOKEN");

// ---------------------------------------------------------------- auth
let token: string | null = null;
let tokenExpiry = 0;
async function accessToken() {
  if (token && Date.now() < tokenExpiry - 60_000) return token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`refresh failed ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  token = j.access_token;
  tokenExpiry = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return token;
}

/** Gmail GET with one retry on 429/5xx — a sweep of this size will meet both. */
async function gmail(path: string, attempt = 0): Promise<any> {
  const t = await accessToken();
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 4) throw new Error(`${path} -> ${r.status} after ${attempt} retries`);
    const wait = 2 ** attempt * 1000;
    await new Promise((s) => setTimeout(s, wait));
    return gmail(path, attempt + 1);
  }
  if (!r.ok) throw new Error(`${path} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ---------------------------------------------------------------- decode
const b64url = (d: unknown): string => {
  if (!d) return "";
  try { return Buffer.from(String(d).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
  catch { return ""; }
};

function bodyOf(part: any): string {
  if (!part) return "";
  if (Array.isArray(part.parts)) {
    const plain = part.parts.find((p: any) => p.mimeType === "text/plain");
    if (plain?.body?.data) return b64url(plain.body.data);
    const html = part.parts.find((p: any) => p.mimeType === "text/html");
    if (html?.body?.data) return b64url(html.body.data);
    for (const p of part.parts) { const n = bodyOf(p); if (n) return n; }
  }
  if (part.body?.data) return b64url(part.body.data);
  return "";
}

const headers = (m: any): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const h of m?.payload?.headers ?? []) if (h?.name) out[String(h.name).toLowerCase()] = h.value;
  return out;
};
const addr = (v: unknown): string => {
  const s = String(v || "");
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
};
const SPARTAN = /@spartancrew\.co\.uk/i;

/** A Gmail thread -> the same payload shape the engine's intake already accepts. */
function toPayload(thread: any) {
  const messages = (thread.messages ?? []).map((m: any) => {
    const h = headers(m);
    const from = addr(m.from || h.from);
    const iso = m.internalDate
      ? new Date(Number(m.internalDate)).toISOString()
      : h.date ? new Date(h.date).toISOString() : new Date(0).toISOString();
    return {
      message_id: String(m.id ?? ""),
      from,
      to: String(h.to || "").split(",").map(addr).filter(Boolean),
      date_iso: iso,
      subject: String(h.subject || ""),
      body: bodyOf(m.payload) || String(m.snippet || ""),
      is_from_spartan: SPARTAN.test(from),
    };
  });
  return { thread_id: String(thread.id), messages, sweep: { mailbox: MAILBOX, swept: true } };
}

// ---------------------------------------------------------------- run
function monthWindows(months: number) {
  const out: Array<{ label: string; q: string }> = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const f = (d: Date) => `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    out.push({ label: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`, q: `after:${f(from)} before:${f(to)}` });
  }
  return out;
}

async function main() {
  const profile = await gmail("profile");
  console.log(`\nmailbox: ${profile.emailAddress}   ${profile.messagesTotal} messages, ${profile.threadsTotal} threads`);
  if (!SPARTAN.test(profile.emailAddress || "")) {
    console.error(`\nthat is not a spartancrew.co.uk mailbox — refusing to sweep. Re-run gmail-login.mjs.`);
    process.exit(1);
  }
  console.log(`${DRY ? "DRY RUN — nothing will be stored" : "APPLY — threads will be stored in sweep_threads"}\n`);

  const threadIds = new Set();
  for (const w of monthWindows(MONTHS)) {
    let pageToken = "", pages = 0, seen = 0;
    do {
      const qs = new URLSearchParams({ q: w.q, maxResults: "500", ...(pageToken ? { pageToken } : {}) });
      const page = await gmail(`messages?${qs}`);
      for (const m of page.messages ?? []) { seen++; if (m.threadId) threadIds.add(m.threadId); }
      pageToken = page.nextPageToken || "";
      pages++;
    } while (pageToken && pages < 40);
    console.log(`  ${w.label}: ${seen} message(s)   running distinct threads: ${threadIds.size}`);
  }

  console.log(`\n${threadIds.size} distinct thread(s) across ${MONTHS} month(s)`);
  if (DRY) {
    const sample = [...threadIds].slice(0, 3);
    for (const id of sample) {
      const p = toPayload(await gmail(`threads/${id}?format=full`));
      const client = p.messages.filter((m: any) => !m.is_from_spartan);
      console.log(`\n  ${id}  ${p.messages.length} msg(s), ${client.length} from clients`);
      console.log(`    subject: ${String(p.messages[0]?.subject).slice(0, 70)}`);
      console.log(`    first  : ${p.messages[0]?.date_iso?.slice(0, 10)}   from ${p.messages[0]?.from}`);
    }
    console.log(`\n(dry run — re-run with --apply to store all ${threadIds.size}.)\n`);
    return;
  }

  let stored = 0, skipped = 0, failed = 0, n = 0;
  for (const id of threadIds) {
    n++;
    try {
      const r = await storeSweptThread(toPayload(await gmail(`threads/${id}?format=full`)), MAILBOX);
      if (r.stored) stored++; else if (r.ok) skipped++; else { failed++; console.log(`  ${id}: ${r.error}`); }
    } catch (e) {
      failed++;
      console.log(`  ${id}: ${(e as Error).message}`);
    }
    if (n % 100 === 0) console.log(`  … ${n}/${threadIds.size}  stored=${stored} skipped=${skipped} failed=${failed}`);
  }
  const s = await sweepStats();
  console.log(`\ndone. stored=${stored} skipped=${skipped} failed=${failed}`);
  console.log(`corpus: ${s.threads} threads / ${s.messages} messages, ${String(s.from).slice(0, 10)} .. ${String(s.to).slice(0, 10)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
