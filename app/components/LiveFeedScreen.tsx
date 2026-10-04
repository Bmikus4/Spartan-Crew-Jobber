"use client";

// The office TV: everything the engine processed that is still waiting on a person.
//
// A DISPLAY, NOT A WORKSPACE. The only control that writes is the tick, and the tick
// writes only its own record (app/lib/feed/check.ts). The same component runs in the app
// shell and fullscreen on the TV; `s` (scale) is the only difference.
//
// IT WEARS THE TOOL'S OWN DESIGN LANGUAGE (globals.css): the theme tokens, one bordered
// panel with hairline rows, the KPI strip, eyebrow labels, mono ids, colour only as a
// signal. Heavy type is spent on one thing per row, the client's name.
//
// AN EMPTY SCREEN MUST NEVER LOOK LIKE "ALL CLEAR". Intake was silently down for 53
// hours on 2026-10-01..03, so the data age and the last-email age are always on screen
// and turn amber, and a failed refresh keeps the last good rows rather than clearing them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedCard, FeedCounts, FeedItem } from "../lib/feed/project";

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
/** A row that has just gone green holds its place this long, then fades and drops to the done group (Ben, 2026-10-04). */
const HOLD_MS = 3_000;
const FADE_MS = 600;

// Signal colours only, from the theme. Everything else is the tool's neutral tokens.
const RED = "var(--danger)";
const BLUE = "var(--viz-blue)";
const GREEN = "var(--up)";
const AMBER = "var(--warn)";
const GREY = "var(--text-muted)";
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

const LAYOUT_KEY = "spartan.liveFeed.layout";
function readLayout(): "a" | "b" {
  try { return window.localStorage.getItem(LAYOUT_KEY) === "b" ? "b" : "a"; } catch { return "a"; }
}
function saveLayout(v: "a" | "b") {
  try { window.localStorage.setItem(LAYOUT_KEY, v); } catch { /* private window: the toggle still works for this visit */ }
}

const hhmm = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(ms);
const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(ms);
function ago(ms: number, now: number): string {
  const m = Math.max(0, Math.floor((now - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function ageShort(ms: number | null, now: number): string {
  if (ms == null) return "never";
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}
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
  if (g.mark === "order-found") return `Order found in OnSinch: ${e.r_number ? `R${e.r_number}` : e.text ?? "it exists"}, ${when}`;
  return `${e.text ?? "Done by the system"}, ${when}`;
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
const isOpen = (c: FeedCard) => c.lane !== "done";
const signal = (c: FeedCard) => (c.colour === "red" ? RED : c.colour === "blue" ? BLUE : GREY);

/** The first job day that has not passed, or null for an undated job. */
function nextDay(c: FeedCard, now: number): string | null {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return c.dates.find((d) => d >= today) ?? null;
}
/** When the countdown runs to: the job's first block not yet started, else the start of its next day. */
function deadline(c: FeedCard, now: number): number | null {
  if (c.starts_at != null) return c.starts_at;
  const d = nextDay(c, now);
  return d ? Date.parse(`${d}T00:00:00Z`) : null;
}
/** Starts within 48 hours and is still open. */
function urgent(c: FeedCard, now: number): boolean {
  if (!isOpen(c)) return false;
  const at = deadline(c, now);
  return at != null && at - now <= URGENT_MS;
}

const two = (n: number) => String(n).padStart(2, "0");
/** Green at 48 hours to red at none, through yellow and orange: the hue walks the spectrum, not a blend. */
const urgencyColour = (left: number) => `hsl(${Math.round(Math.min(1, Math.max(0, left / URGENT_MS)) * 130)} 78% 50%)`;
function countdownText(left: number): string {
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000), sec = Math.floor((left % 60_000) / 1000);
  return `${h}:${two(m)}:${two(sec)}`;
}

/**
 * The 48-hour countdown, after the follow-up timer on Leni's list (DueClock): a tinted
 * clock face in the urgency colour. Here the ring is the time left of the 48 hours, a dot
 * walks it with the seconds, and the live time to the job's start sits inside.
 */
function CountdownClock({ until, now, size }: { until: number; now: number; size: number }) {
  const left = Math.max(0, until - now);
  const f = Math.min(1, left / URGENT_MS);
  const color = urgencyColour(left);
  const C = 2 * Math.PI * 44;
  const sec = Math.floor((left % 60_000) / 1000);
  const dot = ((sec * 6 - 90) * Math.PI) / 180;
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Starts in ${countdownText(left)}`} style={{ flexShrink: 0, overflow: "visible" }}>
      <circle cx="50" cy="50" r="47" fill={`color-mix(in oklab, ${color} 14%, transparent)`} />
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--border-strong)" strokeWidth="5" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * f} ${C}`} transform="rotate(-90 50 50)" style={{ transition: "stroke-dasharray 900ms linear, stroke 900ms linear" }} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = ((i * 30 - 90) * Math.PI) / 180;
        return <line key={i} x1={50 + Math.cos(a) * 36} y1={50 + Math.sin(a) * 36} x2={50 + Math.cos(a) * 39.5} y2={50 + Math.sin(a) * 39.5} stroke={color} strokeOpacity={i % 3 ? 0.35 : 0.8} strokeWidth={i % 3 ? 1.4 : 2.2} strokeLinecap="round" />;
      })}
      <circle cx={50 + Math.cos(dot) * 44} cy={50 + Math.sin(dot) * 44} r="4.6" fill={color} stroke="var(--bg)" strokeWidth="1.6" />
      <text x="50" y="50" textAnchor="middle" className="mono tnum" style={{ fontSize: 23, fontWeight: 700, fill: `color-mix(in oklab, ${color} 78%, var(--text-primary))` }}>
        {left === 0 ? "NOW" : `${h}:${two(m)}`}
      </text>
      <text x="50" y="68" textAnchor="middle" className="mono tnum" style={{ fontSize: 13, fontWeight: 600, fill: "var(--text-muted)" }}>
        {left === 0 ? "started" : `${two(sec)}s`}
      </text>
    </svg>
  );
}
function numbersOf(c: FeedCard, one = false): string | null {
  if (c.colour === "neutral") return null;
  if (!c.r_number && !c.j_number) return "No order yet";
  return one ? c.r_number ?? c.j_number : [c.r_number, c.j_number].filter(Boolean).join(" ");
}

function Tag({ s, color, children }: { s: number; color: string; children: React.ReactNode }) {
  return (
    <span style={{ color, background: tint(color, 14), border: `1px solid ${tint(color, 30)}`, borderRadius: 6 * s, padding: `${3 * s}px ${10 * s}px`, fontSize: 17 * s, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1.35 }}>
      {children}
    </span>
  );
}

function Tick({ card, it, s, size, onTick }: { card: FeedCard; it: FeedItem; s: number; size: number; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const ticked = it.green?.mark === "checked";
  const autoGreen = !!it.green && !ticked;
  return (
    <button
      aria-label={ticked ? "Undo check" : it.green ? "Done" : "Mark checked"}
      onClick={() => { if (!autoGreen) onTick(card, it, !ticked); }}
      style={{
        width: size * s, height: size * s, borderRadius: 10 * s, flexShrink: 0, padding: 0, display: "grid", placeItems: "center",
        cursor: autoGreen ? "default" : "pointer", transition: "background-color 200ms, border-color 200ms",
        background: it.green ? GREEN : "transparent", border: `${1.5 * s}px solid ${it.green ? GREEN : "var(--border-strong)"}`,
      }}>
      {it.green && (
        <svg width={size * 0.5 * s} height={size * 0.5 * s} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4.5 12.5 10 18 19.5 6.5" /></svg>
      )}
    </button>
  );
}

type Phase = "steady" | "hold" | "fade";

/** One row: signal rule, name and status, ids and detail, date, tick. */
function Row({ card, now, s, phase, onTick }: { card: FeedCard; now: number; s: number; phase: Phase; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const it = orderItem(card);
  const lead = it ?? card.items[0];
  const done = card.green;
  const day = nextDay(card, now) ?? card.dates[0] ?? null;
  const t = day ? Date.parse(`${day}T12:00:00Z`) : null;
  const sameYear = t != null && fmt(t, { year: "numeric" }) === fmt(now, { year: "numeric" });
  const more = card.dates.length > 1 ? card.dates.length - 1 : 0;
  const evidence = it ? evidenceLine(it) : null;
  const numbers = numbersOf(card);
  const detail = [card.contact, card.crew ? `${card.crew} crew` : null, card.venue].filter(Boolean).join(" · ");

  return (
    <div style={{
      display: "grid", gridTemplateColumns: `${4 * s}px minmax(0, 1fr) ${104 * s}px ${240 * s}px ${72 * s}px`, alignItems: "center", columnGap: 20 * s,
      minHeight: 108 * s, padding: `${14 * s}px ${20 * s}px ${14 * s}px 0`, borderBottom: "1px solid var(--border)",
      background: done ? tint(GREEN, 15) : "transparent",
      opacity: phase === "fade" ? 0 : 1,
      transition: `background-color 200ms ease, opacity ${FADE_MS}ms ease`,
      animation: phase === "steady" ? "feedRowIn 400ms ease" : undefined,
    }}>
      {/* The legend's colour, kept when the row goes green so it still reads. */}
      <div style={{ alignSelf: "stretch", background: signal(card), borderRadius: `0 ${3 * s}px ${3 * s}px 0` }} />

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 * s }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 * s, minWidth: 0 }}>
          <span style={{ fontSize: 34 * s, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            {card.company || card.subject || "Unknown client"}
          </span>
          <Tag s={s} color={done ? GREEN : signal(card)}>{lead.status}</Tag>
          {hasReply(card) && it && <Tag s={s} color={GREY}>Needs reply</Tag>}
        </div>
        <div style={{ fontSize: 20 * s, fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {/* The numbers lead so a long venue can never cut them: they find the job in OnSinch. */}
          {numbers && <span className={card.r_number || card.j_number ? "mono" : undefined} style={{ color: "var(--text-primary)", fontWeight: 600 }}>{numbers}</span>}
          {numbers && <span style={{ color: "var(--text-faint)" }}> · </span>}
          {evidence
            ? <span style={{ color: GREEN, fontWeight: 600 }}>{evidence}</span>
            : <>{detail}{detail ? <span style={{ color: "var(--text-faint)" }}> · </span> : null}<span style={{ color: "var(--text-muted)" }}>{ago(lead.at, now)}</span></>}
        </div>
      </div>

      <div style={{ display: "grid", placeItems: "center" }}>
        {urgent(card, now) && <CountdownClock until={deadline(card, now)!} now={now} size={96 * s} />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{ fontSize: 14 * s, color: "var(--text-muted)" }}>
          {!it ? "Waiting since" : t ? fmt(t, { weekday: "long" }) + (more ? ` +${more}d` : "") : "Date"}
        </div>
        <div className="tnum" style={{ fontSize: 28 * s, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", marginTop: 2 * s }}>
          {!it ? fmt(lead.at, { day: "numeric", month: "short" }) : t ? fmt(t, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }) : "TBC"}
        </div>
      </div>

      <div style={{ display: "grid", placeItems: "center" }}>
        {it && <Tick card={card} it={it} s={s} size={52} onTick={onTick} />}
      </div>
    </div>
  );
}

/** Layout B's strip: the same signals, folded into a cell of the KPI-strip grid. */
function Tile({ card, now, s, onTick }: { card: FeedCard; now: number; s: number; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const it = orderItem(card);
  const lead = it ?? card.items[0];
  const day = nextDay(card, now) ?? card.dates[0] ?? null;
  const t = day ? Date.parse(`${day}T12:00:00Z`) : null;
  const numbers = numbersOf(card, true);
  return (
    <div style={{ background: card.green ? tint(GREEN, 15) : "var(--surface)", boxShadow: `inset ${3 * s}px 0 0 ${signal(card)}`, padding: `${12 * s}px ${14 * s}px ${12 * s}px ${18 * s}px`, display: "flex", gap: 10 * s, minWidth: 0, transition: "background-color 200ms" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 * s }}>
        <div style={{ fontSize: 14 * s, fontWeight: 700, color: card.green ? GREEN : signal(card), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lead.status}</div>
        <div style={{ fontSize: 22 * s, fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.company || card.subject}</div>
        <div style={{ fontSize: 14 * s, fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {numbers && <span className={card.r_number || card.j_number ? "mono" : undefined} style={{ color: "var(--text-primary)" }}>{numbers} · </span>}
          {urgent(card, now) && <span className="mono tnum" style={{ color: urgencyColour(deadline(card, now)! - now), fontWeight: 700 }}>{countdownText(Math.max(0, deadline(card, now)! - now))} · </span>}
          {t ? fmt(t, { weekday: "short", day: "numeric", month: "short" }) : it ? "Date TBC" : `Waiting since ${fmt(lead.at, { day: "numeric", month: "short" })}`}
        </div>
      </div>
      {it && <div style={{ display: "grid", placeItems: "center" }}><Tick card={card} it={it} s={s} size={34} onTick={onTick} /></div>}
    </div>
  );
}

function Section({ s, label, n, color }: { s: number; label: string; n: number; color?: string }) {
  return (
    <div className="eyebrow" style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: `${12 * s}px ${20 * s}px`, fontSize: 13 * s, color: color ?? "var(--text-muted)" }}>
      <span className="slash" style={{ color: "inherit" }}>/</span>{label} <span className="tnum" style={{ color: "var(--text-faint)" }}>· {n}</span>
    </div>
  );
}

export default function LiveFeedScreen({ isActive, tv = false }: { isActive: boolean; tv?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [okAt, setOkAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [layout, setLayout] = useState<"a" | "b">("a");
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [undo, setUndo] = useState<{ card: FeedCard; item: FeedItem; until: number } | null>(null);
  /** Rows that have just gone green: where they stood, and when. */
  const [settling, setSettling] = useState<Map<string, { index: number; since: number }>>(new Map());
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const lastChime = useRef(0);
  const shown = useRef<string[]>([]);
  const wasGreen = useRef<Set<string> | null>(null);

  const s = full || tv ? 1 : 0.72;

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
      setFailed(true); // keep the last good rows; the header's age says how old they are
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

  // The cursor and the controls hide after three idle seconds on the TV.
  useEffect(() => {
    if (!full && !tv) { setIdle(false); return; }
    let t = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS);
    const move = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS); };
    window.addEventListener("mousemove", move);
    return () => { window.clearTimeout(t); window.removeEventListener("mousemove", move); };
  }, [full, tv]);

  /**
   * A ROW THAT GOES GREEN STAYS PUT, THEN MOVES. Without this a finished job jumped
   * straight to the done group on the next refresh, which on a full screen read as the
   * job vanishing. It is noticed here, from the data, so a tick, an engine write and a
   * staff edit found in OnSinch all settle the same way. Never on first load.
   */
  useEffect(() => {
    if (!data) return;
    const green = new Set(data.items.filter((c) => c.green).map((c) => c.thread_id));
    const before = wasGreen.current;
    wasGreen.current = green;
    if (!before) return;
    const fresh = [...green].filter((id) => !before.has(id) && shown.current.includes(id));
    if (!fresh.length) return;
    const at = Date.now();
    setSettling((m) => {
      const next = new Map(m);
      for (const id of fresh) if (!next.has(id)) next.set(id, { index: shown.current.indexOf(id), since: at });
      return next;
    });
  }, [data]);

  // Released on the screen's own clock, not a timer per row: a tick refetches within a
  // second, and a timer cleared by that refetch left the row held in place for good.
  useEffect(() => {
    setSettling((m) => {
      const done = [...m].filter(([, v]) => now - v.since >= HOLD_MS + FADE_MS);
      if (!done.length) return m;
      const next = new Map(m);
      for (const [id] of done) next.delete(id);
      return next;
    });
  }, [now]);

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
  const pickLayout = (v: "a" | "b") => { unlockAudio(); setLayout(v); saveLayout(v); };

  const tick = useCallback(async (card: FeedCard, item: FeedItem, checked: boolean) => {
    unlockAudio();
    setData((d) => d && {
      ...d,
      items: d.items.map((c) => c.thread_id !== card.thread_id ? c : {
        ...c,
        green: checked && !hasReply(c),
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

  // Within the open group, a job starting in the next 48 hours goes first.
  const cards = useMemo(() => {
    const list = data?.items ?? [];
    return list.map((c, i) => ({ c, i, u: urgent(c, now) ? 0 : 1 }))
      .sort((a, b) => (isOpen(a.c) && isOpen(b.c) && a.c.lane === b.c.lane ? a.u - b.u : 0) || a.i - b.i)
      .map((x) => x.c);
  }, [data, now]);

  let strip: FeedCard[] = [];
  let stripMore = 0;
  let rest = cards;
  if (layout === "b") {
    const open = cards.filter((c) => isOpen(c) && !settling.has(c.thread_id));
    strip = open.slice(0, STRIP);
    stripMore = open.length - strip.length;
    const inStrip = new Set(strip);
    rest = cards.filter((c) => !inStrip.has(c));
  }

  // Open rows, with any row still settling held at the place it stood.
  const settlingRows = rest.filter((c) => settling.has(c.thread_id));
  const openRows = rest.filter((c) => isOpen(c) && !settling.has(c.thread_id));
  for (const c of [...settlingRows].sort((a, b) => settling.get(a.thread_id)!.index - settling.get(b.thread_id)!.index)) {
    openRows.splice(Math.min(settling.get(c.thread_id)!.index, openRows.length), 0, c);
  }
  const doneRows = rest.filter((c) => !isOpen(c) && !settling.has(c.thread_id));
  useEffect(() => { shown.current = [...strip, ...openRows, ...doneRows].map((c) => c.thread_id); });
  const phaseOf = (c: FeedCard): Phase => {
    const st = settling.get(c.thread_id);
    if (!st) return "steady";
    return now - st.since >= HOLD_MS ? "fade" : "hold";
  };

  const c = data?.counts;
  const dataAge = okAt == null ? null : now - okAt;
  const dataStale = failed || (dataAge != null && dataAge > STALE_DATA_MS);
  const emailAt = data?.health.last_email_at ? Date.parse(data.health.last_email_at) : null;
  const emailStale = !!data?.health.intake_stale;
  const warn = dataStale || emailStale;
  const urgentCount = cards.filter((x) => urgent(x, now)).length;
  const openCount = cards.filter(isOpen).length;
  const pad = 24 * s;

  const kpis: Array<{ label: [string, string]; n: number; color: string }> = c ? [
    { label: ["need", "created"], n: c.needs_created, color: RED },
    { label: ["need", "updated"], n: c.needs_updated, color: BLUE },
    ...(data?.health.replies_enabled ? [{ label: ["need", "reply"] as [string, string], n: c.needs_reply, color: GREY }] : []),
    { label: ["within", "48 hours"], n: urgentCount, color: AMBER },
    { label: ["done", "today"], n: c.done, color: GREEN },
  ] : [];

  return (
    <div ref={rootRef} style={{ position: "relative", height: "100%", width: "100%", background: "var(--bg)", color: "var(--text-primary)", display: "flex", flexDirection: "column", gap: 16 * s, padding: pad, cursor: idle ? "none" : undefined, overflow: "hidden" }}>
      <style>{`@keyframes feedRowIn { from { opacity: 0; transform: translateY(${6 * s}px); } to { opacity: 1; transform: none; } }`}</style>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 * s, flexShrink: 0 }}>
        {/* The legend: permanent, not interactive, exactly two entries. Large, because it is
            the key to every row's colour and is read from across the office. */}
        <div aria-label="Legend" style={{ display: "flex", gap: 36 * s, alignItems: "center", fontSize: 34 * s, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-primary)", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 14 * s }}><span style={{ width: 32 * s, height: 32 * s, borderRadius: 8 * s, background: RED, flexShrink: 0 }} />Red = New job</span>
          <span style={{ display: "flex", alignItems: "center", gap: 14 * s }}><span style={{ width: 32 * s, height: 32 * s, borderRadius: 8 * s, background: BLUE, flexShrink: 0 }} />Blue = Update</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {kpis.map((k) => (
            <div key={k.label.join(" ")} style={{ display: "flex", alignItems: "center", gap: 12 * s, padding: `0 ${22 * s}px`, borderLeft: `${2 * s}px solid var(--border)` }}>
              <span className="tnum" style={{ fontSize: 60 * s, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", color: k.n ? k.color : "var(--text-faint)" }}>{k.n}</span>
              <span style={{ fontSize: 20 * s, fontWeight: 600, lineHeight: 1.2, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{k.label[0]}<br />{k.label[1]}</span>
            </div>
          ))}
          <button onClick={() => void goFull()} aria-label={full ? "Exit fullscreen" : "Fullscreen"} title={full ? "Exit fullscreen" : "Fullscreen"}
            style={{ marginLeft: 16 * s, width: 64 * s, height: 64 * s, borderRadius: 14 * s, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-primary)", cursor: "pointer", display: "grid", placeItems: "center", padding: 0, flexShrink: 0 }}>
            <svg width={34 * s} height={34 * s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d={full
                ? "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"
                : "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"} />
            </svg>
          </button>
        </div>
      </header>

      {layout === "b" && strip.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${STRIP}, minmax(0, 1fr))`, gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            {strip.map((card) => <Tile key={card.thread_id} card={card} now={now} s={s} onTick={tick} />)}
            {Array.from({ length: STRIP - strip.length }, (_, i) => <div key={`pad${i}`} style={{ background: "var(--surface)" }} />)}
          </div>
          {stripMore > 0 && <div style={{ fontSize: 14 * s, fontWeight: 600, color: "var(--text-muted)", marginTop: 8 * s }}>+{stripMore} more needing action, in the list below</div>}
        </div>
      )}

      <div className="frosted-glass" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {data == null ? (
          <div style={{ padding: 40 * s, fontSize: 22 * s, fontWeight: 600, color: failed ? AMBER : "var(--text-muted)" }}>{failed ? "The feed could not be read. Retrying." : "Loading…"}</div>
        ) : (
          <>
            <Section s={s} label="Needs action" n={openRows.filter(isOpen).length} />
            {openRows.length === 0 && (
              <div style={{ padding: `${22 * s}px ${20 * s}px`, borderBottom: "1px solid var(--border)", fontSize: 20 * s, fontWeight: 700, color: warn ? AMBER : GREEN, background: warn ? tint(AMBER, 10) : tint(GREEN, 12) }}>
                {warn ? "Nothing listed, but the data may be out of date: see the status above." : openCount === 0 && strip.length === 0 ? "Everything is checked." : "Nothing else waiting."}
              </div>
            )}
            {openRows.map((card) => <Row key={card.thread_id} card={card} now={now} s={s} phase={phaseOf(card)} onTick={tick} />)}
            <Section s={s} label="Done" n={doneRows.length} color={GREEN} />
            {doneRows.map((card) => <Row key={card.thread_id} card={card} now={now} s={s} phase="steady" onTick={tick} />)}
            {c && c.older > 0 && (
              <div style={{ padding: `${14 * s}px ${20 * s}px`, fontSize: 15 * s, fontWeight: 500, color: "var(--text-muted)" }}>
                {c.older} older undated {c.older === 1 ? "enquiry" : "enquiries"} with no word from the client for two weeks, not shown.
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 * s, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 * s, padding: `${8 * s}px ${14 * s}px`, borderRadius: 999, border: `1px solid ${warn ? tint(AMBER, 45) : "var(--border)"}`, background: warn ? tint(AMBER, 12) : "var(--surface)", fontSize: 17 * s, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          <span style={{ width: 10 * s, height: 10 * s, borderRadius: 999, background: warn ? AMBER : GREEN }} />
          <span style={{ color: dataStale ? AMBER : undefined }}>{failed ? "Refresh failed" : "Live"} · updated {ageShort(okAt, now)}</span>
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span style={{ color: emailStale ? AMBER : undefined }}>last email {ageShort(emailAt, now)}</span>
        </div>
        {/* Hidden with the cursor on the TV, so nothing but the feed is on screen. */}
        <div className="seg" role="tablist" aria-label="Layout" style={{ opacity: idle ? 0 : 1, transition: "opacity 200ms", pointerEvents: idle ? "none" : "auto", transform: `scale(${s * 1.15})`, transformOrigin: "right center" }}>
          <button className="seg__btn" aria-selected={layout === "a"} onClick={() => pickLayout("a")}>List</button>
          <button className="seg__btn" aria-selected={layout === "b"} onClick={() => pickLayout("b")}>Strip</button>
        </div>
      </div>

      {undo && undo.until > now && (
        <div role="status" style={{ position: "absolute", left: "50%", bottom: 32 * s, transform: "translateX(-50%)", background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: 12 * s, padding: `${12 * s}px ${16 * s}px ${12 * s}px ${20 * s}px`, fontSize: 18 * s, fontWeight: 600, display: "flex", gap: 16 * s, alignItems: "center", boxShadow: "0 12px 32px rgba(0,0,0,0.35)" }}>
          Marked checked{undo.card.company ? `: ${undo.card.company}` : ""}
          <button onClick={() => { const u = undo; setUndo(null); void tick(u.card, u.item, false); }} style={{ fontSize: 15 * s, fontWeight: 700, padding: `${6 * s}px ${14 * s}px`, borderRadius: 8 * s, border: "none", background: "var(--accent)", color: "var(--accent-contrast)", cursor: "pointer" }}>Undo</button>
        </div>
      )}
    </div>
  );
}
