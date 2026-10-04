"use client";

// The office TV: everything the engine processed that is still waiting on a person.
//
// A DISPLAY, NOT A WORKSPACE. The only control that writes is the tick, and the tick
// writes only its own record (app/lib/feed/check.ts). The same component runs in the app
// shell and fullscreen on the TV; `scale` is the only difference.
//
// THE LOOK is the requester's mockup (2026-10-03): light cream rows, the company huge, the
// date beside a calendar, a large tick square on the right, an urgency badge, big counts in
// a white header. What the mockup leaves out and the brief requires is kept: the status
// wording verbatim, the two-entry legend top-left, and the R/J numbers.
//
// AN EMPTY SCREEN MUST NEVER LOOK LIKE "ALL CLEAR". Intake was silently down for 53
// hours on 2026-10-01..03, so the data age and the last-email age are always on screen
// and turn amber, and a failed refresh keeps the last good cards with the age climbing
// rather than clearing them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedCard, FeedCounts, FeedItem } from "../lib/feed/project";
import { BrandMark, BrandWordmark } from "./BrandLogo";

interface FeedResponse {
  ok: boolean;
  generated_at: string;
  health: { last_email_at: string | null; minutes_since_email: number | null; intake_stale: boolean; replies_enabled: boolean };
  counts: FeedCounts;
  items: FeedCard[];
}

const REFRESH_MS = 20_000;
const STALE_DATA_MS = 2 * 60_000;
const CHIME_GAP_MS = 10_000;
const UNDO_MS = 10_000;
const IDLE_CURSOR_MS = 3_000;
const URGENT_MS = 48 * 3_600_000;
const STRIP = 5;

const C = {
  page: "#f3f4f6", header: "#ffffff", ink: "#111318", sub: "#5b616e", faint: "#8a909c", rule: "#e6e1d6",
  cream: "#fcf3e2", white: "#ffffff", greenBg: "#e3f4e8", greenEdge: "#9bd3ad", greyBg: "#eceef1",
  red: "#c8231a", blue: "#1d5fd1", green: "#15803d", grey: "#6b7280", amber: "#b45309", amberBg: "#fef3c7",
};

const LAYOUT_KEY = "spartan.liveFeed.layout";
function readLayout(): "a" | "b" {
  try { return window.localStorage.getItem(LAYOUT_KEY) === "b" ? "b" : "a"; } catch { return "a"; }
}
function saveLayout(v: "a" | "b") {
  try { window.localStorage.setItem(LAYOUT_KEY, v); } catch { /* private window: the toggle still works for this visit */ }
}

const hhmm = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(ms);
function ago(ms: number, now: number): string {
  const m = Math.max(0, Math.floor((now - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}
function ageShort(ms: number | null, now: number): string {
  if (ms == null) return "never";
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}
const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(ms).toUpperCase();
function personName(by: string | null): string {
  const local = String(by ?? "someone").split("@")[0].split(/[._-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : "someone";
}
function evidenceLine(it: FeedItem): string | null {
  const g = it.green;
  if (!g) return null;
  const e = (g.evidence ?? {}) as { text?: string; at?: string; r_number?: string | null };
  const when = hhmm(Date.parse(e.at ?? "") || g.at);
  if (g.mark === "checked") return `Checked by ${personName(g.by)} ${when}`;
  if (g.mark === "staff-edit") return `Changed in OnSinch by staff: ${e.text ?? "edited"}, ${when}`;
  return `Order found in OnSinch: ${e.r_number ? `R${e.r_number}` : e.text ?? "it exists"}, ${when}`;
}

/** The soft two-note chime. WebAudio, so there is no file to fail to load. */
function chime(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  for (const [i, f] of [660, 880].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    const s = t0 + i * 0.22;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(0.07, s + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(s);
    o.stop(s + 0.65);
  }
}

const orderItem = (c: FeedCard) => c.items.find((i) => i.kind !== "needs-reply") ?? null;
const hasReply = (c: FeedCard) => c.items.some((i) => i.kind === "needs-reply");
const openNeed = (c: FeedCard) => c.lane === "reply" || (c.lane === "need" && !c.green);

/** The first job day that has not passed, or null for an undated job. */
function nextDay(c: FeedCard, now: number): string | null {
  const today = fmt(now, { year: "numeric", month: "2-digit", day: "2-digit" }); // dd/mm/yyyy
  const iso = today.split("/").reverse().join("-");
  return c.dates.find((d) => d >= iso) ?? null;
}
/** Starts within 48 hours and nobody has verified it yet: the mockup's URGENT badge. */
function urgent(c: FeedCard, now: number): boolean {
  if (c.green) return false;
  const d = nextDay(c, now);
  return !!d && Date.parse(`${d}T00:00:00Z`) - now <= URGENT_MS;
}

/** What leaves first when the screen is full: green, then unverified checks, needs last. */
const keepRank = (c: FeedCard) => (openNeed(c) ? 0 : c.green ? 2 : 1);
function fit(cards: FeedCard[], cap: number): { shown: FeedCard[]; hidden: number } {
  if (cards.length <= cap) return { shown: cards, hidden: 0 };
  const keep = new Set([...cards].map((c, i) => ({ c, i })).sort((a, b) => keepRank(a.c) - keepRank(b.c) || a.i - b.i).slice(0, cap).map((x) => x.c));
  return { shown: cards.filter((c) => keep.has(c)), hidden: cards.length - keep.size };
}

function edgeOf(c: FeedCard) { return c.colour === "red" ? C.red : c.colour === "blue" ? C.blue : C.grey; }
function bgOf(c: FeedCard) { return c.green ? C.greenBg : c.colour === "neutral" ? C.greyBg : c.lane === "done" ? C.white : C.cream; }
function numbersOf(c: FeedCard, one = false) {
  if (c.colour === "neutral") return null;
  if (!c.r_number && !c.j_number) return "No order yet";
  return one ? c.r_number ?? c.j_number : [c.r_number, c.j_number].filter(Boolean).join(" ");
}

function Pill({ s, bg, fg, children }: { s: number; bg: string; fg: string; children: React.ReactNode }) {
  return <span style={{ background: bg, color: fg, borderRadius: 8 * s, padding: `${4 * s}px ${14 * s}px`, fontSize: 24 * s, fontWeight: 800, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1.25 }}>{children}</span>;
}

function Calendar({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" />
      <circle cx="8" cy="14" r="0.6" fill={color} /><circle cx="12" cy="14" r="0.6" fill={color} /><circle cx="16" cy="14" r="0.6" fill={color} />
      <circle cx="8" cy="17.5" r="0.6" fill={color} /><circle cx="12" cy="17.5" r="0.6" fill={color} /><circle cx="16" cy="17.5" r="0.6" fill={color} />
    </svg>
  );
}

function Tick({ card, it, s, size, onTick }: { card: FeedCard; it: FeedItem; s: number; size: number; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const ticked = it.green?.mark === "checked";
  const autoGreen = !!it.green && !ticked;
  const edge = edgeOf(card);
  return (
    <button
      aria-label={ticked ? "Undo check" : it.green ? "Verified" : "Mark checked"}
      onClick={() => { if (!autoGreen) onTick(card, it, !ticked); }}
      style={{
        width: size * s, height: size * s, borderRadius: 16 * s * (size / 112), flexShrink: 0, padding: 0, display: "grid", placeItems: "center",
        cursor: autoGreen ? "default" : "pointer",
        background: it.green ? C.green : C.white, border: it.green ? "none" : `${5 * s * (size / 112)}px solid ${edge}`,
        boxShadow: it.green ? "0 4px 14px rgba(21,128,61,0.35)" : "none",
      }}>
      <svg width={size * 0.5 * s} height={size * 0.5 * s} viewBox="0 0 24 24" fill="none" stroke={it.green ? "#fff" : edge} strokeOpacity={it.green ? 1 : 0.22} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4.5 12.5 10 18 19.5 6.5" /></svg>
    </button>
  );
}

/** One row of the feed: the mockup's shape. */
function Row({ card, now, s, onTick }: { card: FeedCard; now: number; s: number; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const it = orderItem(card);
  const lead = it ?? card.items[0];
  const edge = edgeOf(card);
  const reply = hasReply(card);
  const day = nextDay(card, now) ?? card.dates[0] ?? null;
  const t = day ? Date.parse(`${day}T12:00:00Z`) : null;
  const more = card.dates.length > 1 ? card.dates.length - 1 : 0;
  const evidence = it ? evidenceLine(it) : null;
  const numbers = numbersOf(card);
  const rest = [card.contact, card.crew ? `${card.crew} crew` : null, card.venue].filter(Boolean).join(" · ");
  const isReplyOnly = !it;

  return (
    <div style={{
      height: "100%", boxSizing: "border-box", borderRadius: 18 * s, overflow: "hidden",
      background: bgOf(card), borderLeft: `${16 * s}px solid ${edge}`,
      boxShadow: card.green ? `inset 0 0 0 ${3 * s}px ${C.greenEdge}` : card.lane === "done" ? `inset 0 0 0 ${2 * s}px ${C.rule}` : "0 2px 10px rgba(17,19,24,0.06)",
      display: "flex", alignItems: "center", gap: 28 * s, padding: `${18 * s}px ${26 * s}px ${18 * s}px ${30 * s}px`,
    }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 * s }}>
        <div style={{ display: "flex", gap: 10 * s, alignItems: "center", overflow: "hidden" }}>
          {/* Black, not red: a red urgency badge on a blue Update row would contradict the legend. */}
          {urgent(card, now) && <Pill s={s} bg={C.ink} fg="#fff">URGENT – NEXT 48H</Pill>}
          <Pill s={s} bg={card.green ? C.green : edge} fg="#fff">{lead.status}</Pill>
          {reply && it && <Pill s={s} bg={C.grey} fg="#fff">Needs reply</Pill>}
        </div>
        <div style={{ fontSize: 62 * s, fontWeight: 800, color: C.ink, lineHeight: 1.08, letterSpacing: "-0.015em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {card.company || card.subject || "Unknown client"}
        </div>
        {/* The numbers lead the line so a long venue can never truncate them: they are how
            somebody finds the job in OnSinch. */}
        <div style={{ fontSize: 27 * s, fontWeight: 600, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {numbers && <span style={{ color: C.ink, fontWeight: 800 }}>{numbers}</span>}
          {numbers && " · "}
          {evidence ? <span style={{ color: C.green, fontWeight: 700 }}>{evidence}</span> : <>{rest}{rest ? " · " : ""}{ago(lead.at, now)}</>}
        </div>
      </div>

      <div style={{ alignSelf: "stretch", width: 2 * s, background: C.rule, flexShrink: 0 }} />

      <div style={{ width: 430 * s, flexShrink: 0, display: "flex", alignItems: "center", gap: 26 * s }}>
        <Calendar size={66 * s} color={C.sub} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 26 * s, fontWeight: 700, color: C.faint, letterSpacing: "0.04em" }}>
            {isReplyOnly ? "WAITING SINCE" : t ? fmt(t, { weekday: "short" }) + (more ? `  +${more} DAY${more > 1 ? "S" : ""}` : "") : "DATE"}
          </div>
          <div style={{ fontSize: 50 * s, fontWeight: 800, color: C.ink, lineHeight: 1.1, whiteSpace: "nowrap" }}>
            {isReplyOnly ? fmt(lead.at, { day: "2-digit", month: "short" }) : t ? fmt(t, { day: "2-digit", month: "short", year: "numeric" }) : "TBC"}
          </div>
        </div>
      </div>

      <div style={{ width: 112 * s, flexShrink: 0, display: "grid", placeItems: "center" }}>
        {it && <Tick card={card} it={it} s={s} size={112} onTick={onTick} />}
      </div>
    </div>
  );
}

/** Layout B's top strip: the same row, folded into a tile. */
function Tile({ card, now, s, onTick }: { card: FeedCard; now: number; s: number; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const it = orderItem(card);
  const lead = it ?? card.items[0];
  const edge = edgeOf(card);
  const day = nextDay(card, now) ?? card.dates[0] ?? null;
  const t = day ? Date.parse(`${day}T12:00:00Z`) : null;
  const numbers = numbersOf(card, true);
  return (
    <div style={{ height: "100%", boxSizing: "border-box", borderRadius: 14 * s, overflow: "hidden", background: bgOf(card), borderLeft: `${12 * s}px solid ${edge}`, boxShadow: "0 2px 10px rgba(17,19,24,0.06)", padding: `${12 * s}px ${14 * s}px`, display: "flex", gap: 10 * s }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 * s }}>
        <div style={{ fontSize: 20 * s, fontWeight: 800, color: card.green ? C.green : edge, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lead.status}
        </div>
        <div style={{ fontSize: 32 * s, fontWeight: 800, color: C.ink, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.company || card.subject}</div>
        <div style={{ fontSize: 20 * s, fontWeight: 700, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {/* Number first, as on the rows, so the date is what truncates. URGENT rides here too:
              as a prefix to the status it cut the wording to "Order needs c..." at 1080p. */}
          {numbers ? <span style={{ color: C.ink }}>{numbers} · </span> : null}
          {urgent(card, now) && <span style={{ color: C.ink, fontWeight: 800 }}>URGENT · </span>}
          {t ? fmt(t, { weekday: "short", day: "2-digit", month: "short" }) : it ? "Date TBC" : `Waiting since ${fmt(lead.at, { day: "2-digit", month: "short" })}`}
        </div>
      </div>
      {it && <div style={{ display: "grid", placeItems: "center" }}><Tick card={card} it={it} s={s} size={56} onTick={onTick} /></div>}
    </div>
  );
}

function Count({ s, n, label, color }: { s: number; n: number; label: [string, string]; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 * s, padding: `0 ${16 * s}px`, borderLeft: `${2 * s}px solid ${C.rule}` }}>
      <span style={{ fontSize: 52 * s, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{n}</span>
      <span style={{ fontSize: 19 * s, fontWeight: 600, color: C.sub, lineHeight: 1.2, whiteSpace: "nowrap" }}>{label[0]}<br />{label[1]}</span>
    </div>
  );
}

export default function LiveFeedScreen({ isActive, tv = false }: { isActive: boolean; tv?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [okAt, setOkAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [layout, setLayout] = useState<"a" | "b">("a");
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [undo, setUndo] = useState<{ card: FeedCard; item: FeedItem; until: number } | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const lastChime = useRef(0);

  const s = full || tv ? 1 : 0.62;

  useEffect(() => { setLayout(readLayout()); }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feed", { cache: "no-store" });
      const body = (await res.json()) as FeedResponse;
      if (!res.ok || !body.ok) throw new Error("feed");
      const keys = new Set(body.items.flatMap((c) => c.items.map((i) => i.item_key)));
      // A chime for an item this screen has not seen before. Never on first load, at
      // most one per ten seconds, and only once a click has unlocked audio.
      const prev = seen.current;
      if (prev && [...keys].some((k) => !prev.has(k)) && audio.current && Date.now() - lastChime.current > CHIME_GAP_MS) {
        lastChime.current = Date.now();
        try { chime(audio.current); } catch { /* audio is a nicety */ }
      }
      seen.current = keys;
      setData(body);
      setOkAt(Date.now());
      setFailed(false);
    } catch {
      setFailed(true); // keep the last good cards; the header's age says how old they are
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isActive, load]);

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // The cursor and the two controls hide after three idle seconds on the TV.
  useEffect(() => {
    if (!full && !tv) { setIdle(false); return; }
    let t = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS);
    const move = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS); };
    window.addEventListener("mousemove", move);
    return () => { window.clearTimeout(t); window.removeEventListener("mousemove", move); };
  }, [full, tv]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data != null]);

  const unlockAudio = () => {
    try {
      if (!audio.current) audio.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      void audio.current.resume();
    } catch { /* no audio on this device */ }
  };
  const goFull = async () => {
    unlockAudio();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch { /* the browser refused; the screen still works windowed */ }
  };
  const toggleLayout = () => { unlockAudio(); const v = layout === "a" ? "b" : "a"; setLayout(v); saveLayout(v); };

  const tick = useCallback(async (card: FeedCard, item: FeedItem, checked: boolean) => {
    unlockAudio();
    setData((d) => d && {
      ...d,
      items: d.items.map((c) => c.thread_id !== card.thread_id ? c : {
        ...c,
        green: checked && c.items.every((i) => i.item_key === item.item_key || i.green),
        items: c.items.map((i) => i.item_key !== item.item_key ? i : { ...i, green: checked ? { mark: "checked" as const, by: null, evidence: null, at: Date.now() } : null }),
      }),
    });
    setUndo(checked ? { card, item, until: Date.now() + UNDO_MS } : null);
    try {
      await fetch("/api/feed/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item_key: item.item_key, thread_id: card.thread_id, checked }) });
    } finally {
      void load();
    }
  }, [load]);

  // Within its lane, a job starting in the next 48 hours goes first: the mockup's order.
  const cards = useMemo(() => {
    const list = data?.items ?? [];
    return list.map((c, i) => ({ c, i, u: urgent(c, now) ? 0 : 1 }))
      .sort((a, b) => (a.c.lane === b.c.lane ? a.u - b.u : 0) || a.i - b.i)
      .map((x) => x.c);
  }, [data, now]);

  const pad = 26 * s;
  const gap = 16 * s;
  const rowH = 200 * s;
  const tileH = 150 * s;
  const moreH = 40 * s;

  let strip: FeedCard[] = [];
  let stripMore = 0;
  let rest = cards;
  if (layout === "b") {
    const open = cards.filter(openNeed);
    strip = open.slice(0, STRIP);
    stripMore = open.length - strip.length;
    const inStrip = new Set(strip);
    rest = cards.filter((c) => !inStrip.has(c));
  }
  const stripH = layout === "b" && strip.length ? tileH + gap + (stripMore ? moreH : 0) : 0;
  const rows = Math.max(1, Math.floor((box.h - 2 * pad - stripH - moreH + gap) / (rowH + gap)));
  const { shown, hidden } = fit(rest, rows);

  const c = data?.counts;
  const dataAge = okAt == null ? null : now - okAt;
  const dataStale = failed || (dataAge != null && dataAge > STALE_DATA_MS);
  const emailAt = data?.health.last_email_at ? Date.parse(data.health.last_email_at) : null;
  const emailStale = !!data?.health.intake_stale;
  const urgentCount = cards.filter((x) => x.lane !== "done" && urgent(x, now)).length;
  const warn = dataStale || emailStale;
  const showControls = !idle;

  return (
    <div ref={rootRef} style={{ position: "relative", height: "100%", width: "100%", background: C.page, color: C.ink, display: "flex", flexDirection: "column", cursor: idle ? "none" : undefined, overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 * s, padding: `${18 * s}px ${pad + 8 * s}px`, background: C.header, borderBottom: `${2 * s}px solid ${C.rule}`, flexShrink: 0, ["--text-primary" as string]: C.ink }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 * s, minWidth: 0, flex: 1, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 * s, flexShrink: 0 }}>
            <BrandWordmark height={44 * s} />
            <BrandMark height={58 * s} />
          </div>
          <div style={{ width: 2 * s, alignSelf: "stretch", background: C.rule }} />
          <div style={{ minWidth: 0 }}>
            {/* Shrinks with an ellipsis rather than running under the counts, which it did at
                1920 wide with four counts showing. The counts are the part that must stay whole. */}
            <div style={{ fontSize: 38 * s, fontWeight: 800, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.15 }}>Jobs Requiring Attention</div>
            {/* The legend: permanent, not interactive, exactly two entries. */}
            <div aria-label="Legend" style={{ display: "flex", gap: 22 * s, alignItems: "center", fontSize: 23 * s, fontWeight: 700, color: C.sub, marginTop: 6 * s, whiteSpace: "nowrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 * s }}><span style={{ width: 24 * s, height: 24 * s, borderRadius: 5 * s, background: C.red }} />Red = New job</span>
              <span style={{ display: "flex", alignItems: "center", gap: 9 * s }}><span style={{ width: 24 * s, height: 24 * s, borderRadius: 5 * s, background: C.blue }} />Blue = Update</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {c && <>
            <Count s={s} n={c.needs_created} label={["need", "created"]} color={C.red} />
            <Count s={s} n={c.needs_updated} label={["need", "updated"]} color={C.blue} />
            {data?.health.replies_enabled && <Count s={s} n={c.needs_reply} label={["need", "reply"]} color={C.grey} />}
            <Count s={s} n={urgentCount} label={["within", "48 hours"]} color={C.ink} />
            <Count s={s} n={c.done} label={["done", "today"]} color={C.grey} />
          </>}
          <div style={{ display: "flex", alignItems: "center", gap: 12 * s, padding: `${6 * s}px ${14 * s}px`, marginLeft: 4 * s, borderLeft: `${2 * s}px solid ${C.rule}`, background: warn ? C.amberBg : undefined, borderRadius: warn ? 10 * s : 0 }}>
            <svg width={38 * s} height={38 * s} viewBox="0 0 24 24" fill="none" stroke={warn ? C.amber : C.sub} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-1.2-8.84A6 6 0 0 0 4.5 12.5 3.5 3.5 0 0 0 7 19h10.5Z" /></svg>
            <div style={{ fontSize: 19 * s, fontWeight: 600, color: C.sub, lineHeight: 1.3, whiteSpace: "nowrap" }}>
              <div style={{ color: dataStale ? C.amber : undefined, fontWeight: dataStale ? 800 : 600 }}>{failed ? "Refresh failed · " : "Updated "}{ageShort(okAt, now)}</div>
              <div style={{ color: emailStale ? C.amber : undefined, fontWeight: emailStale ? 800 : 600 }}>Last email {ageShort(emailAt, now)}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Hidden with the cursor on the TV, so nothing but the feed is on screen. */}
      <div style={{ position: "absolute", bottom: 12 * s, right: pad, display: "flex", gap: 8 * s, opacity: showControls ? 1 : 0, transition: "opacity 300ms", pointerEvents: showControls ? "auto" : "none", zIndex: 2 }}>
        <button onClick={toggleLayout} title="Switch layout" style={ctl(s)}>{layout === "a" ? "Layout B" : "Layout A"}</button>
        <button onClick={() => void goFull()} style={ctl(s)}>{full ? "Exit fullscreen" : "Fullscreen"}</button>
      </div>

      <div ref={gridRef} style={{ flex: 1, minHeight: 0, padding: pad, display: "flex", flexDirection: "column", gap }}>
        {data == null ? (
          <div style={{ margin: "auto", fontSize: 34 * s, color: failed ? C.amber : C.sub, fontWeight: 700 }}>{failed ? "The feed could not be read. Retrying." : "Loading…"}</div>
        ) : (
          <>
            {layout === "b" && strip.length > 0 && (
              <div style={{ flexShrink: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${STRIP}, minmax(0, 1fr))`, gap, height: tileH }}>
                  {strip.map((card) => <Tile key={card.thread_id} card={card} now={now} s={s} onTick={tick} />)}
                </div>
                {stripMore > 0 && <div style={more(s, moreH)}>+{stripMore} more needing an order or a reply</div>}
              </div>
            )}
            {shown.length === 0 && strip.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center", fontSize: 34 * s, color: C.sub, fontWeight: 700 }}>
                Nothing waiting.
                <div style={{ fontSize: 24 * s, marginTop: 8 * s, color: emailStale ? C.amber : C.faint }}>Last email {ageShort(emailAt, now)}</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gridAutoRows: rowH, gap, alignContent: "start", flex: 1, minHeight: 0 }}>
                {shown.map((card) => <Row key={card.thread_id} card={card} now={now} s={s} onTick={tick} />)}
              </div>
            )}
            <div style={more(s, moreH)}>
              {hidden > 0 ? `+${hidden} more` : ""}
              {c && c.older > 0 ? `${hidden > 0 ? " · " : ""}older: ${c.older}` : ""}
            </div>
          </>
        )}
      </div>

      {undo && undo.until > now && (
        <div role="status" style={{ position: "absolute", left: "50%", bottom: 28 * s, transform: "translateX(-50%)", background: C.ink, color: "#fff", borderRadius: 12 * s, padding: `${14 * s}px ${20 * s}px`, fontSize: 24 * s, fontWeight: 700, display: "flex", gap: 18 * s, alignItems: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
          Marked checked{undo.card.company ? `: ${undo.card.company}` : ""}
          <button onClick={() => { const u = undo; setUndo(null); void tick(u.card, u.item, false); }} style={{ ...ctl(s), background: "#fff", color: C.ink, border: "none" }}>Undo</button>
        </div>
      )}
    </div>
  );
}

function ctl(s: number): React.CSSProperties {
  return { fontSize: 17 * s, fontWeight: 700, padding: `${7 * s}px ${13 * s}px`, borderRadius: 8 * s, border: `1px solid ${C.rule}`, background: "#fff", color: C.ink, cursor: "pointer", whiteSpace: "nowrap" };
}
function more(s: number, h: number): React.CSSProperties {
  return { height: h, flexShrink: 0, display: "flex", alignItems: "center", fontSize: 24 * s, fontWeight: 700, color: C.sub };
}
