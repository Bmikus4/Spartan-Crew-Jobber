// ============================================================================
// A mail message off the wire, with no dependency.
// ----------------------------------------------------------------------------
// The routing-rule intake receives RFC 822 and nothing else — no Gmail client, no
// parsed-JSON dialect, no credential. That makes this the narrowest point in the
// whole system: everything the engine ever learns about a client passes through
// this function, so it is pure, total, and tested offline (test/mailInbound.ts).
//
// NO MIME LIBRARY ON PURPOSE. This repo has five runtime dependencies and mail
// parsers are a known supply-chain surface for something that is, at the size we
// need, header unfolding plus two transfer encodings. What is NOT implemented is
// as deliberate as what is: no attachment decoding (the bytes are not read, only
// the fact of them), no nested-message extraction, no charset beyond what
// TextDecoder already knows.
//
// TOTAL, NEVER THROWING. A parse failure on the no-data-loss path must degrade to
// a message with empty fields that still gets stored, not to a 500 that makes the
// provider retry mail we already hold.
// ============================================================================

export interface MailAttachment {
  filename: string;
  content_type: string;
  /** Bytes as declared, before decoding. Enough to say "there was a 2 MB PDF". */
  size_hint: number;
}

export interface ParsedMail {
  /** Normalised: lower-cased, angle-bracketed. "" when the sender set none. */
  message_id: string;
  in_reply_to: string[];
  references: string[];
  from: string;
  from_name: string;
  to: string[];
  cc: string[];
  /** Envelope recipients the transport stamped on, which survive BCC and aliases. */
  delivered_to: string[];
  subject: string;
  /** UTC instant. "" when the Date header is missing or unparseable. */
  date_iso: string;
  /** text/plain if there is one, else HTML reduced to text, else "". */
  body: string;
  attachments: MailAttachment[];
  headers: Record<string, string>;
}

const EMPTY: ParsedMail = {
  message_id: "", in_reply_to: [], references: [], from: "", from_name: "",
  to: [], cc: [], delivered_to: [], subject: "", date_iso: "", body: "",
  attachments: [], headers: {},
};

/** "<A@B>" | "a@b" -> "<a@b>". Identity for "". */
export function normaliseMessageId(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  const m = t.match(/<([^>]*)>/);
  const inner = (m ? m[1] : t).trim().toLowerCase();
  return inner ? `<${inner}>` : "";
}

/** Every <id> in a header value, in the order written. */
function idsIn(v: string): string[] {
  const out: string[] = [];
  for (const m of String(v ?? "").matchAll(/<[^>\s]+>/g)) {
    const id = normaliseMessageId(m[0]);
    if (id) out.push(id);
  }
  // A bare unbracketed id is legal-ish and some mailers emit it; accept a single one
  // rather than reading the header as empty and starting a new thread.
  if (!out.length) {
    const bare = String(v ?? "").trim();
    if (/^[^<>\s@]+@[^<>\s@]+$/.test(bare)) out.push(normaliseMessageId(bare));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Header block
// ---------------------------------------------------------------------------

/**
 * Split at the first blank line and unfold. A continuation line begins with space
 * or tab and belongs to the header above it — a References chain of any real length
 * arrives folded across several lines, so reading one line at a time sees only the
 * first id and silently starts a new thread for every reply.
 */
function splitHeaders(raw: string): { lines: string[]; body: string } {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  const cut = text.indexOf("\n\n");
  const head = cut === -1 ? text : text.slice(0, cut);
  const body = cut === -1 ? "" : text.slice(cut + 2);

  const lines: string[] = [];
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += " " + line.trim();
    else lines.push(line);
  }
  return { lines, body };
}

/** Repeated headers are kept: the last wins for lookup, all are kept for the multi ones. */
function headerMap(lines: string[]): { one: Record<string, string>; many: Record<string, string[]> } {
  const one: Record<string, string> = {};
  const many: Record<string, string[]> = {};
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    one[name] = value;
    (many[name] ||= []).push(value);
  }
  return { one, many };
}

// ---------------------------------------------------------------------------
// Encodings
// ---------------------------------------------------------------------------

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const cs = (charset || "utf-8").toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(cs === "us-ascii" ? "utf-8" : cs, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/** quoted-printable to bytes. `isWord` switches on RFC 2047's `_` meaning space. */
function qpBytes(s: string, isWord = false): Uint8Array {
  const src = isWord ? s : s.replace(/=\r?\n/g, "");   // soft line breaks join
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "=" && i + 2 < src.length && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (isWord && c === "_") {
      out.push(0x20);
    } else {
      // The source is already a JS string, so anything not an escape is a code unit.
      // Push its low byte: legal QP is 7-bit, and a mailer that broke that rule is
      // better served by a slightly wrong character than by a throw.
      const cp = src.charCodeAt(i);
      if (cp < 0x100) out.push(cp);
      else out.push(...new TextEncoder().encode(c));
    }
  }
  return new Uint8Array(out);
}

function b64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

/** RFC 2047 encoded-words, which is how any non-ASCII subject arrives. */
function decodeWords(s: string): string {
  return String(s ?? "").replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_all, charset: string, enc: string, text: string) => {
      const bytes = enc.toLowerCase() === "b" ? b64Bytes(text) : qpBytes(text, true);
      return decodeBytes(bytes, charset);
    },
  // Adjacent encoded-words are meant to join with the whitespace between them
  // dropped; without this a name split across two words gains a stray space.
  ).replace(/\?=[ \t]+=\?/g, "?==?");
}

function decodePart(text: string, encoding: string, charset: string): string {
  const enc = (encoding || "").trim().toLowerCase();
  if (enc === "base64") return decodeBytes(b64Bytes(text), charset);
  if (enc === "quoted-printable") return decodeBytes(qpBytes(text), charset);
  // 7bit/8bit/binary: the transport gave us a JS string already. Re-decode only when
  // the charset is not a Unicode one, since the bytes then mean something else.
  if (/utf-?8/i.test(charset) || !charset) return text;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return decodeBytes(bytes, charset);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Split an address list on commas that are not inside quotes or angle brackets.
 * `"Smith, Jane" <j@x>` is one address and splitting it naively yields two, one of
 * which is not an address at all.
 */
function splitAddressList(v: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false, angle = 0;
  for (const c of String(v ?? "")) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "<") angle++;
    else if (!quoted && c === ">") angle = Math.max(0, angle - 1);
    if (c === "," && !quoted && angle === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function addressOf(v: string): string {
  const s = String(v ?? "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).replace(/^"|"$/g, "").trim().toLowerCase();
}

function displayNameOf(v: string): string {
  const s = String(v ?? "").trim();
  const m = s.match(/^(.*?)<[^>]+>\s*$/);
  if (!m) return "";
  return decodeWords(m[1].trim().replace(/^"|"$/g, "").trim());
}

function addressList(v: string | undefined): string[] {
  if (!v) return [];
  return splitAddressList(v).map(addressOf).filter((a) => a.includes("@"));
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function paramOf(contentType: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(contentType || "");
  return m ? (m[2] ?? m[1]).trim() : "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface PartResult { plain: string; html: string; attachments: MailAttachment[] }

/**
 * Walk a MIME tree, collecting the first text/plain, the first text/html, and the
 * existence of everything else. Depth-limited because a malformed boundary can
 * otherwise recurse on itself.
 */
function walk(contentType: string, encoding: string, raw: string, depth: number): PartResult {
  const out: PartResult = { plain: "", html: "", attachments: [] };
  const ct = (contentType || "text/plain").toLowerCase();

  if (depth < 8 && ct.startsWith("multipart/")) {
    const boundary = paramOf(contentType, "boundary");
    if (!boundary) return out;
    const marker = `--${boundary}`;
    // (?:--) NOT (--). A capturing group makes String.split interleave the capture
    // into its own output, so every other chunk came back undefined and the first
    // .trim() on one threw — which the outer catch turned into an empty message.
    const chunks = raw.split(new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \t]*$`, "m"));
    // chunks[0] is the preamble before the first boundary and is not a part.
    for (const chunk of chunks.slice(1)) {
      if (!chunk.trim()) continue;
      const { lines, body } = splitHeaders(chunk.replace(/^\n+/, ""));
      const { one } = headerMap(lines);
      const sub = walk(one["content-type"] || "text/plain", one["content-transfer-encoding"] || "",
                       body, depth + 1);
      if (!out.plain && sub.plain) out.plain = sub.plain;
      if (!out.html && sub.html) out.html = sub.html;
      out.attachments.push(...sub.attachments);
      // An attached message (forwarded mail) is the payload, not an attachment —
      // a forwarded enquiry is a real intake case here.
      if (/^message\//.test((one["content-type"] || "").toLowerCase()) && !out.plain) {
        const inner = parseRfc822(body);
        if (inner.body) out.plain = inner.body;
      }
      const disp = one["content-disposition"] || "";
      if (/attachment/i.test(disp) || (!/^(text|multipart|message)\//.test((one["content-type"] || "text/plain").toLowerCase()))) {
        out.attachments.push({
          filename: decodeWords(paramOf(disp, "filename") || paramOf(one["content-type"] || "", "name")),
          content_type: (one["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase(),
          size_hint: body.length,
        });
      }
    }
    // The recursive call above already pushed sub-attachments; de-duplicate the
    // leaf that both branches can describe.
    const seen = new Set<string>();
    out.attachments = out.attachments.filter((a) => {
      const k = `${a.content_type}|${a.filename}|${a.size_hint}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return out;
  }

  const charset = paramOf(contentType, "charset") || "utf-8";
  if (ct.startsWith("text/html")) out.html = decodePart(raw, encoding, charset);
  else if (ct.startsWith("text/") || !contentType) out.plain = decodePart(raw, encoding, charset);
  return out;
}

// ---------------------------------------------------------------------------

/** Parse a whole message. Never throws; an unparseable input yields empty fields. */
export function parseRfc822(raw: string): ParsedMail {
  try {
    if (!raw || typeof raw !== "string") return { ...EMPTY };
    const { lines, body } = splitHeaders(raw);
    const { one, many } = headerMap(lines);

    const parts = walk(one["content-type"] || "text/plain", one["content-transfer-encoding"] || "", body, 0);
    // text/plain wins. HTML reduced to text is a fallback, never a supplement: the
    // engine reads the newest message to decide what changed, and the same sentence
    // twice reads as emphasis that is not there.
    const text = parts.plain.trim() || (parts.html ? htmlToText(parts.html) : "");

    let date_iso = "";
    if (one["date"]) {
      const t = Date.parse(one["date"]);
      if (Number.isFinite(t)) date_iso = new Date(t).toISOString();
    }

    return {
      message_id: normaliseMessageId(idsIn(one["message-id"] || "")[0] || ""),
      in_reply_to: idsIn(one["in-reply-to"] || ""),
      references: idsIn(one["references"] || ""),
      from: addressOf(splitAddressList(one["from"] || "")[0] || ""),
      from_name: displayNameOf(splitAddressList(one["from"] || "")[0] || ""),
      to: addressList(one["to"]),
      cc: addressList(one["cc"]),
      // Every Delivered-To, not the last: an alias chain stamps one per hop and the
      // routed address is what tells us which mailbox rule fired.
      delivered_to: (many["delivered-to"] || []).concat(many["x-original-to"] || []).map(addressOf).filter(Boolean),
      subject: decodeWords(one["subject"] || "").trim(),
      date_iso,
      body: text,
      attachments: parts.attachments,
      headers: one,
    };
  } catch {
    return { ...EMPTY };
  }
}
