"use client";

// ============================================================================
// All Opportunities (the owner, 1 Nov): every conversation in the bookings inbox, the TV's urgent jobs among them.
// The old Jobs Board's tags, lanes, search and copyable R and J carried over; its rows set out like the Live Feed's
// tiles; a conversation opens beside the list, rendered in full as Gmail shows it (quoted history folded away).
// The list is /api/opportunities, built around the TV's own read, so an urgent job here is the TV's card itself.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FeedCard } from "../lib/feed/project";
import type { Opportunity, OppState } from "../lib/feed/opportunities";
import { latestText } from "../lib/v2/interpret/ground";

const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const FAINT = "var(--text-faint)";
const A = "var(--accent)";
const BORDER = "var(--border)";
const BORDER_STRONG = "var(--border-strong)";
const TAN = "var(--border-strong)";
const REFRESH_MS = 60_000;

// ---- tags (carried over from the Jobs Board: a hue on a square swatch, the text in ordinary ink) -------------------
type TagTone = "neutral" | "accent" | "green" | "amber" | "red" | "blue" | "teal" | "violet";
const TONES: Record<TagTone, string> = {
  neutral: MUT, accent: A, green: "var(--ok)", amber: "var(--warn)", red: "var(--danger)",
  blue: "var(--viz-blue)", teal: "var(--viz-teal)", violet: "var(--viz-violet)",
};
function Swatch({ color }: { color: string }) {
  return <span aria-hidden style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />;
}
function Tag({ label, tone, title, mono = false }: { label: string; tone: TagTone; title?: string; mono?: boolean }) {
  return (
    <span title={title} className={mono ? "mono" : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 4, fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", lineHeight: 1.5, color: SUB, border: `1px solid ${BORDER_STRONG}` }}>
      <Swatch color={TONES[tone]} />{label}
    </span>
  );
}

const STATE: Record<OppState, { label: string; tone: TagTone; title: string }> = {
  urgent: { label: "On the TV", tone: "amber", title: "A person still has to do something: it is on the Live Feed's Urgent list" },
  done: { label: "Done", tone: "green", title: "Done: by staff in OnSinch, by the bot, or ticked" },
  settled: { label: "Settled", tone: "green", title: "Settled in the thread (a quote or terms accepted, a cancellation confirmed, a request taken back) and held in OnSinch" },
  quoted: { label: "Quote sent", tone: "blue", title: "Spartan sent the quote; nothing to do until the client confirms" },
  reply: { label: "Needs Reply", tone: "accent", title: "The client asked something that needs an email answer" },
  info: { label: "No action", tone: "neutral", title: "Nothing was asked for: a thanks, a confirmation, information" },
  closed: { label: "Closed", tone: "neutral", title: "Off the board: its days passed, or it was dealt with earlier" },
  undecided: { label: "Not read", tone: "neutral", title: "Stored, but never read by the system (before 9 Oct, or while intake was paused)" },
};

function tagsOf(o: Opportunity) {
  const tags: { label: string; tone: TagTone; title: string; mono?: boolean }[] = [];
  if (o.kind === "new") tags.push({ label: "New job", tone: "teal", title: "A first request for crew" });
  if (o.kind === "update") tags.push({ label: "Update", tone: "violet", title: "A change to a job that already exists" });
  if (o.kind === "quote") tags.push({ label: "Quote", tone: "blue", title: "A price request" });
  tags.push(STATE[o.state]);
  if (o.j_number) tags.push({ label: o.j_number, tone: "blue", title: "OnSinch job number", mono: true });
  if (o.r_number) tags.push({ label: o.r_number, tone: "amber", title: "OnSinch order number", mono: true });
  return tags;
}

/** The R or J a person types into OnSinch's search: click to copy, in the colour the row gives it. */
function IdChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const tone: TagTone = value.startsWith("J") ? "blue" : "amber";
  return (
    <button title={`${value.startsWith("J") ? "OnSinch job number" : "OnSinch order number"}: click to copy`} className="mono"
      onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {}); }}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "3px 8px", borderRadius: 4, fontSize: 12, fontWeight: 500, lineHeight: 1.5, background: "transparent", color: copied ? "var(--ok)" : INK, border: `1px solid ${copied ? "var(--ok)" : BORDER_STRONG}` }}>
      <Swatch color={copied ? "var(--ok)" : TONES[tone]} />{copied ? "Copied" : value}
    </button>
  );
}

const london = (ms: number, withTime = true) => !ms ? "" : new Date(ms).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const ago = (ms: number, now: number) => { const m = Math.max(0, Math.round((now - ms) / 60_000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const nameOf = (o: Opportunity) => o.client || o.contact || o.sender || "Unknown client";

// ---- one opportunity, as a row like the Live Feed's tiles: name and tags, then the R and J and when in columns --------
function OppRow({ o, now, selected, compact, onSelect }: { o: Opportunity; now: number; selected: boolean; compact: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const cell: React.CSSProperties = { alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 14px", borderLeft: `2px solid ${TAN}`, minWidth: 0 };
  return (
    <div ref={ref} role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      data-thread={o.thread_id}
      style={{ display: "grid", gridTemplateColumns: compact ? "minmax(0,1fr)" : "minmax(0,1fr) 108px 108px 120px", alignItems: "center", flexShrink: 0, cursor: "pointer",
        padding: "12px 16px 12px 20px", borderRadius: 12, border: `1px solid ${selected ? "var(--accent)" : BORDER}`,
        background: selected ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface)",
        boxShadow: `inset 4px 0 0 0 ${o.state === "urgent" ? "var(--warn)" : o.state === "done" || o.state === "settled" ? "var(--ok)" : "transparent"}` }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 5, paddingRight: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(o)}</span>
          {compact && <span style={{ marginLeft: "auto", fontSize: 11.5, color: FAINT, whiteSpace: "nowrap" }}>{ago(o.last_at, now)}</span>}
        </div>
        <div style={{ fontSize: 13, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {o.urgent?.ask ?? o.subject ?? ""}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {tagsOf(o).map((t) => <Tag key={t.label} {...t} />)}
          {o.dates.length > 0 && <span style={{ fontSize: 11.5, color: MUT }}>{o.dates.slice(0, 3).map(dayLabel).join(", ")}{o.dates.length > 3 ? ` +${o.dates.length - 3}` : ""}</span>}
        </div>
      </div>
      {!compact && <>
        <div style={{ ...cell, borderLeft: "none" }}><span className="mono" style={{ fontSize: 15, fontWeight: 600, color: INK }}>{o.r_number ?? ""}</span></div>
        <div style={cell}><span className="mono" style={{ fontSize: 15, fontWeight: 600, color: INK }}>{o.j_number ?? ""}</span></div>
        <div style={{ ...cell, flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: SUB, whiteSpace: "nowrap" }}>{ago(o.last_at, now)}</span>
          <span style={{ fontSize: 11.5, color: FAINT, whiteSpace: "nowrap" }}>{o.messages} {o.messages === 1 ? "email" : "emails"}</span>
        </div>
      </>}
    </div>
  );
}

// ---- the conversation, rendered as Gmail shows it ------------------------------------------------------------------
/** An HTML body as the words it shows: blocks become lines, tags and styles go, entities are read. */
function htmlText(html: string): string {
  return html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}
const isHtml = (s: string) => /<\/?(html|div|p|br|table|span|body)\b/i.test(s);
const who = (f: string | null) => { const s = String(f ?? ""); const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(s); return m ? { name: m[1].trim() || m[2], addr: m[2] } : { name: s, addr: "" }; };
const addrs = (x: unknown) => (Array.isArray(x) ? x : []).map((v) => typeof v === "string" ? v : (v as { address?: string; email?: string })?.address ?? (v as { email?: string })?.email ?? "").filter(Boolean).join(", ");

type Msg = { message_id: string; from: string | null; to: unknown; cc: unknown; at: string | null; subject: string; body: string; ours: boolean; attachments: string[] };
type Dec = { message_id: string; kind: string; code: string | null; intent: string | null; reasons: string[]; requests: Array<{ action: string; date: string | null; start: string | null; end: string | null; crew: number | null; venue: string | null; history: boolean }> };

function Message({ m, d, open, onToggle }: { m: Msg; d?: Dec; open: boolean; onToggle: () => void }) {
  const text = isHtml(m.body) ? htmlText(m.body) : m.body.replace(/\r/g, "");
  const newest = latestText(text);
  const at = text.indexOf(newest);
  const quoted = at >= 0 ? text.slice(at + newest.length).trim() : "";
  const [showQuoted, setShowQuoted] = useState(false);
  const f = who(m.from);
  return (
    <article style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: m.ours ? "color-mix(in srgb, var(--accent) 5%, var(--surface))" : "var(--surface)", overflow: "hidden", flexShrink: 0 }}>
      <header role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === "Enter") onToggle(); }}
        style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
        <span style={{ width: 28, height: 28, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, alignSelf: "center",
          background: m.ours ? "var(--accent)" : "var(--surface-2)", color: m.ours ? "var(--accent-contrast)" : SUB, border: `1px solid ${BORDER}` }}>{(m.ours ? "S" : f.name.slice(0, 1) || "?").toUpperCase()}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
            <b style={{ fontSize: 14, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.ours ? "Spartan Crew" : f.name}</b>
            {!m.ours && f.addr && <span style={{ fontSize: 12, color: MUT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.addr}</span>}
          </div>
          {open ? <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>to {addrs(m.to) || "bookings"}{addrs(m.cc) ? `, cc ${addrs(m.cc)}` : ""}</div>
            : <div style={{ fontSize: 12.5, color: MUT, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{newest.replace(/\s+/g, " ").slice(0, 160)}</div>}
        </div>
        <span style={{ fontSize: 12, color: MUT, whiteSpace: "nowrap" }}>{london(Date.parse(m.at ?? ""))}</span>
      </header>
      {open && (
        <div style={{ padding: "0 16px 14px 54px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14, lineHeight: 1.55, color: INK }}>{newest || <span style={{ color: MUT }}>(no text)</span>}</div>
          {quoted && (
            <div>
              <button onClick={() => setShowQuoted((v) => !v)} title={showQuoted ? "Hide quoted text" : "Show quoted text"}
                style={{ border: `1px solid ${BORDER}`, background: "var(--surface-2)", color: MUT, borderRadius: 6, padding: "0 8px", fontSize: 14, lineHeight: "16px", cursor: "pointer" }}>•••</button>
              {showQuoted && <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13, lineHeight: 1.5, color: MUT, borderLeft: `2px solid ${BORDER_STRONG}`, paddingLeft: 12, marginTop: 8 }}>{quoted}</div>}
            </div>
          )}
          {m.attachments.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {m.attachments.map((a, k) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: SUB, border: `1px solid ${BORDER_STRONG}`, borderRadius: 6, padding: "3px 8px" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
                  {String(a)}
                </span>
              ))}
            </div>
          )}
          {d && !m.ours && (
            <div style={{ borderTop: `1px dashed ${BORDER}`, paddingTop: 8, fontSize: 12.5, color: SUB }}>
              <span style={{ fontWeight: 700, color: MUT, marginRight: 6 }}>What the system decided:</span>
              {d.kind === "write" ? "a change it could make" : d.kind === "handoff" ? "left for a person" : "nothing to do"}
              {d.reasons[0] && <span style={{ color: MUT }}> · {d.reasons[0]}</span>}
              {d.requests.filter((r) => !r.history).length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: SUB }}>
                  {d.requests.filter((r) => !r.history).map((r, k) => <li key={k}>{r.action.replace(/_/g, " ")}{r.date ? `, ${dayLabel(r.date)}` : ""}{r.start ? `, ${r.start}${r.end ? `-${r.end}` : ""}` : ""}{r.crew ? `, ${r.crew} crew` : ""}{r.venue ? `, ${r.venue}` : ""}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Detail({ o, onClose, narrow }: { o: Opportunity; onClose: () => void; narrow: boolean }) {
  const [d, setD] = useState<{ messages: Msg[]; decisions: Dec[]; marks: Array<{ mark: string; text: string | null; by: string | null; at: string }> } | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    setD(null); setErr(false);
    void (async () => {
      try {
        const r = await fetch(`/api/opportunities?id=${encodeURIComponent(o.thread_id)}`, { cache: "no-store" });
        const b = await r.json();
        if (!r.ok || !b.ok) throw new Error("detail");
        if (!live) return;
        setD(b);
        // As Gmail opens a conversation: the newest email open, the rest folded to a line.
        setOpen(new Set(b.messages.length ? [b.messages[b.messages.length - 1].message_id] : []));
      } catch { if (live) setErr(true); }
    })();
    return () => { live = false; };
  }, [o.thread_id]);
  const card: FeedCard | null = o.urgent;
  const marks = (d?.marks ?? []).filter((m) => m.text);
  return (
    <section aria-label="Conversation" style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: narrow ? "4px 0 40px" : "4px 4px 40px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: A, cursor: "pointer", fontWeight: 700, fontSize: 13, padding: 0 }}>{narrow ? "← All Opportunities" : "Close"}</button>
      </div>
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: INK }}>{nameOf(o)}</h2>
        <div style={{ fontSize: 14, color: SUB }}>{o.subject}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {tagsOf(o).filter((t) => !t.mono).map((t) => <Tag key={t.label} {...t} />)}
          {o.j_number && <IdChip value={o.j_number} />}
          {o.r_number && <IdChip value={o.r_number} />}
          {(o.j_number || o.r_number) && <span style={{ fontSize: 11.5, color: FAINT }}>search this in OnSinch</span>}
        </div>
        {o.dates.length > 0 && <div style={{ fontSize: 13, color: MUT }}>Days: {o.dates.map(dayLabel).join(", ")}</div>}
      </header>
      {card && (
        <div style={{ border: `1px solid var(--warn)`, background: "color-mix(in srgb, var(--warn) 8%, var(--surface))", borderRadius: 12, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--warn)" }}>{card.green ? "Done, on the Live Feed" : "On the Live Feed now"}</span>
          {card.ask && <span style={{ fontSize: 14, color: INK }}>{card.ask}</span>}
          {card.check && <span style={{ fontSize: 13, color: SUB }}>{card.check}</span>}
        </div>
      )}
      {marks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: SUB }}>
          {marks.map((m, k) => <div key={k}><Swatch color={m.mark === "possibly" ? "var(--warn)" : "var(--ok)"} /> <span style={{ marginLeft: 4 }}>{m.text}</span></div>)}
        </div>
      )}
      {err ? <div style={{ color: MUT, fontSize: 13 }}>The conversation could not be loaded.</div>
        : !d ? <div style={{ color: MUT, fontSize: 13 }} className="crm-shimmer">Loading the conversation…</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: MUT }}>
              <span>{d.messages.length} {d.messages.length === 1 ? "email" : "emails"}</span>
              <button onClick={() => setOpen(new Set(open.size === d.messages.length ? [] : d.messages.map((m) => m.message_id)))}
                style={{ marginLeft: "auto", background: "none", border: "none", color: A, cursor: "pointer", fontWeight: 600, fontSize: 12.5 }}>{open.size === d.messages.length ? "Collapse all" : "Expand all"}</button>
            </div>
            {d.messages.map((m) => (
              <Message key={m.message_id} m={m} d={d.decisions.find((x) => x.message_id === m.message_id)} open={open.has(m.message_id)}
                onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(m.message_id)) n.delete(m.message_id); else n.add(m.message_id); return n; })} />
            ))}
          </div>
        )}
    </section>
  );
}

type Lane = "all" | OppState | "order";
const LANES: Array<{ id: Lane; label: string; test: (o: Opportunity) => boolean }> = [
  { id: "all", label: "All", test: () => true },
  { id: "urgent", label: "On the TV", test: (o) => o.state === "urgent" },
  { id: "order", label: "With an order", test: (o) => !!(o.r_number || o.j_number) },
  { id: "settled", label: "Settled", test: (o) => o.state === "settled" },
  { id: "reply", label: "Needs Reply", test: (o) => o.state === "reply" },
  { id: "info", label: "No action", test: (o) => o.state === "info" },
  { id: "closed", label: "Closed", test: (o) => o.state === "closed" },
  { id: "undecided", label: "Not read", test: (o) => o.state === "undecided" },
];

/**
 * `focus`: a conversation to open, sent from an Urgent tile's open button; `onFocused` says it was taken. `toolbar`: the
 * Live Feed header's slot beside the Urgent / All Opportunities switch, where the filter and search sit (owner, 2 Nov)
 * so the list starts higher; without one they sit above the list.
 */
export default function OpportunitiesScreen({ isActive, focus, onFocused, toolbar }: { isActive: boolean; focus: string | null; onFocused: () => void; toolbar?: HTMLElement | null }) {
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [lane, setLane] = useState<Lane>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [width, setWidth] = useState(1200);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/opportunities", { cache: "no-store" });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error("opportunities");
      setItems(b.items); setFailed(false); setNow(Date.now());
    } catch { setFailed(true); }
  }, []);
  useEffect(() => {
    if (!isActive) return;
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isActive, load]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // An Urgent tile's open button: show every opportunity, and open that one.
  useEffect(() => {
    if (!focus) return;
    setLane("all"); setQuery(""); setSelected(focus); onFocused();
  }, [focus, onFocused]);

  const counts = useMemo(() => new Map(LANES.map((l) => [l.id, (items ?? []).filter(l.test).length])), [items]);
  const shown = useMemo(() => {
    const test = LANES.find((l) => l.id === lane)!.test;
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(test).filter((o) => !q || q.split(/\s+/).every((t) => [nameOf(o), o.subject, o.sender, o.contact, o.r_number, o.j_number, o.urgent?.ask, o.dates.join(" ")].join(" ").toLowerCase().includes(t)));
  }, [items, lane, query]);
  const current = selected ? (items ?? []).find((o) => o.thread_id === selected) ?? null : null;
  const narrow = width < 900;
  const compact = !!current && !narrow;

  const tools = (
    <>
      <select value={lane} onChange={(e) => setLane(e.target.value as Lane)} aria-label="Filter opportunities"
        style={{ padding: "8px 30px 8px 12px", borderRadius: 9, border: `1px solid ${BORDER}`, background: "var(--surface-2)", color: INK, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
        {LANES.filter((l) => l.id === "all" || l.id === lane || (counts.get(l.id) ?? 0) > 0).map((l) => <option key={l.id} value={l.id}>{l.label} ({counts.get(l.id) ?? 0})</option>)}
      </select>
      <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180, maxWidth: 340 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client, subject, R or J number…" aria-label="Search opportunities"
          style={{ width: "100%", padding: "8px 30px 8px 12px", borderRadius: 9, border: `1px solid ${BORDER}`, background: "var(--surface-2)", color: INK, fontSize: 12.5, fontFamily: "inherit" }} />
        {query && <button onClick={() => setQuery("")} aria-label="Clear search" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: MUT, cursor: "pointer", fontSize: 14 }}>×</button>}
      </div>
      {failed && <span style={{ fontSize: 12.5, color: "var(--warn)" }}>Could not refresh. <button onClick={() => void load()} style={{ color: A, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Retry</button></span>}
    </>
  );

  return (
    <div ref={rootRef} style={{ height: "100%", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
      {!(narrow && current) && (toolbar ? createPortal(tools, toolbar) : <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>{tools}</div>)}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 0 }}>
        {!(narrow && current) && (
          <div style={{ flex: compact ? "0 0 380px" : 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingBottom: 24 }}>
            {items == null ? <div style={{ color: failed ? "var(--warn)" : MUT, fontSize: 14, padding: 20 }}>{failed ? "The opportunities could not be read. Retrying." : "Loading…"}</div>
              : shown.length === 0 ? <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 12, padding: "32px 20px", textAlign: "center", color: MUT, fontSize: 13 }}>{query ? <>Nothing matches <b style={{ color: SUB }}>{query}</b> here.</> : "Nothing here."}</div>
              : shown.map((o) => <OppRow key={o.thread_id} o={o} now={now} selected={o.thread_id === selected} compact={compact} onSelect={() => setSelected(o.thread_id === selected ? null : o.thread_id)} />)}
          </div>
        )}
        {current && <div style={{ flex: 1, minWidth: 0 }}><Detail o={current} narrow={narrow} onClose={() => setSelected(null)} /></div>}
        {selected && items && !current && <div style={{ flex: 1, padding: 20, color: MUT, fontSize: 13 }}>That conversation is not in the list. <button onClick={() => setSelected(null)} style={{ color: A, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Close</button></div>}
      </div>
    </div>
  );
}
