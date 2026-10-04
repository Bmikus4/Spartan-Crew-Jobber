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
import { BrandMark, BrandWordmark } from "./BrandLogo";

interface FeedResponse {
  ok: boolean;
  generated_at: string;
  health: { last_email_at: string | null; minutes_since_email: number | null; intake_stale: boolean; replies_enabled: boolean; verify?: { last_at: string | null; note: string | null } };
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
const RETURN_TO_TOP_MS = 20_000;
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
/**
 * A BELL, NOT A BEEP (Ben, 2026-10-04: "softer and less 8 bit"). Two notes a fourth apart,
 * each a sine with two quiet upper partials that die away faster than it does, a gentle
 * attack and a long fade, through one short darkened echo for some room. The compressor
 * keeps it even without the edge a triangle or square wave gives.
 */
function chime(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
  const out = ctx.createGain();
  // 0.9 was "a little too loud" in the office (Ben, 2026-10-04); 0.55 is about 4 dB down.
  out.gain.value = 0.55;
  const bus = ctx.createGain();
  const echo = ctx.createDelay();
  echo.delayTime.value = 0.16;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  const dark = ctx.createBiquadFilter();
  dark.type = "lowpass";
  dark.frequency.value = 2400;
  bus.connect(comp);
  bus.connect(echo);
  echo.connect(dark);
  dark.connect(feedback);
  feedback.connect(echo);
  dark.connect(comp);
  comp.connect(out).connect(ctx.destination);
  for (const [i, f] of [784, 1047].entries()) {
    const at = t0 + i * 0.28;
    for (const [mult, peak, decay] of [[1, 0.8, 1.6], [2, 0.12, 0.7], [3.01, 0.05, 0.35]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      o.connect(g).connect(bus);
      o.start(at);
      o.stop(at + decay + 0.05);
    }
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

/** A client waiting this long for our reply is red, and goes to the top (Ben, 2026-10-04). */
const REPLY_RED_MS = 24 * 3_600_000;
const replyColour = (ms: number) => `hsl(${Math.round((1 - Math.min(1, Math.max(0, ms) / REPLY_RED_MS)) * 130)} 78% 50%)`;

/** How long a client has waited, read from across the room: whole hours, then days past two. */
function waitText(ms: number): string {
  if (ms < 3_600_000) return "<1h";
  return ms < URGENT_MS ? `${Math.floor(ms / 3_600_000)}h` : `${Math.floor(ms / 86_400_000)}d`;
}

/**
 * THE REPLY CLOCK, after the follow-up timer on Leni's list (DueClock): how long the client
 * has waited with nothing from us. A tinted face whose ring fills and whose colour walks
 * green to red over 24 hours, and stays red after. It is the TV's only clock: the job's own
 * timing is its date beside a calendar (Ben, 2026-10-04).
 */
function ReplyClock({ ms, size, label = true }: { ms: number; size: number; label?: boolean }) {
  const t = Math.max(0, ms);
  const spent = Math.min(1, t / REPLY_RED_MS);
  const color = replyColour(t);
  const text = waitText(t);
  const C = 2 * Math.PI * 44;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Waiting ${text} for a reply`} style={{ flexShrink: 0, overflow: "visible" }}>
      <circle cx="50" cy="50" r="47" fill={`color-mix(in oklab, ${color} 14%, transparent)`} />
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--border-strong)" strokeWidth="5" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * spent} ${C}`} transform="rotate(-90 50 50)" style={{ transition: "stroke-dasharray 900ms linear, stroke 900ms linear" }} />
      {/* No marks at 3 and 9 o'clock: that is where the figure sits. */}
      {Array.from({ length: 12 }, (_, i) => i).filter((i) => i !== 3 && i !== 9).map((i) => {
        const a = ((i * 30 - 90) * Math.PI) / 180;
        return <line key={i} x1={50 + Math.cos(a) * 36} y1={50 + Math.sin(a) * 36} x2={50 + Math.cos(a) * 39.5} y2={50 + Math.sin(a) * 39.5} stroke={color} strokeOpacity={i % 3 ? 0.35 : 0.8} strokeWidth={i % 3 ? 1.4 : 2.2} strokeLinecap="round" />;
      })}
      <text x="50" y={label ? 46 : 51} textAnchor="middle" dominantBaseline="central" className="tnum" style={{ fontSize: label ? 29 : 32, fontWeight: 800, letterSpacing: "-0.02em", fill: `color-mix(in oklab, ${color} 78%, var(--text-primary))` }}>
        {text}
      </text>
      {label && (
        <text x="50" y="69" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", fill: "var(--text-muted)" }}>
          NO REPLY
        </text>
      )}
    </svg>
  );
}

function CalendarIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" />
      <circle cx="8" cy="14" r="0.7" fill={color} /><circle cx="12" cy="14" r="0.7" fill={color} /><circle cx="16" cy="14" r="0.7" fill={color} />
      <circle cx="8" cy="17.5" r="0.7" fill={color} /><circle cx="12" cy="17.5" r="0.7" fill={color} />
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

/** The sync state as a cloud: green connected, grey offline, red an error. No timers. */
function SyncCloud({ s, state, why }: { s: number; state: "ok" | "offline" | "error"; why: string }) {
  const color = state === "ok" ? GREEN : state === "error" ? RED : GREY;
  const line1 = state === "ok" ? "Synced with" : state === "error" ? "Sync error" : "Offline";
  const line2 = state === "ok" ? "Gmail and OnSinch" : state === "error" ? why || "Gmail or OnSinch" : "Not syncing";
  return (
    <div role="status" aria-label={`${line1} ${line2}`} style={{ display: "flex", alignItems: "center", gap: 12 * s, padding: `0 ${14 * s}px 0 ${18 * s}px`, borderLeft: `${2 * s}px solid var(--border)` }}>
      <svg width={52 * s} height={52 * s} viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <path d="M17.5 19a4.5 4.5 0 1 0-1.2-8.84A6 6 0 0 0 4.5 12.5 3.5 3.5 0 0 0 7 19h10.5Z" fill={tint(color, 22)} stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
        {state === "ok" && <polyline points="9 14.6 11.2 16.6 15.2 12.4" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />}
        {state === "error" && <><line x1="12" y1="11.6" x2="12" y2="14.8" stroke={color} strokeWidth="1.9" strokeLinecap="round" /><circle cx="12" cy="17" r="0.95" fill={color} /></>}
        {state === "offline" && <line x1="9.6" y1="12.4" x2="14.4" y2="17.2" stroke={color} strokeWidth="1.9" strokeLinecap="round" />}
      </svg>
      <div style={{ fontSize: 18 * s, fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap", color: state === "ok" ? "var(--text-secondary)" : color }}>
        {line1}<br /><span style={{ color: state === "ok" ? "var(--text-primary)" : color }}>{line2}</span>
      </div>
    </div>
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
      display: "grid", gridTemplateColumns: `${4 * s}px minmax(0, 1fr) ${108 * s}px ${300 * s}px ${72 * s}px`, alignItems: "center", columnGap: 20 * s,
      minHeight: 116 * s, padding: `${14 * s}px ${20 * s}px ${14 * s}px 0`, borderBottom: "1px solid var(--border)",
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
        {isOpen(card) && card.awaiting_reply_since != null && <ReplyClock ms={now - card.awaiting_reply_since} size={100 * s} />}
      </div>

      {/* The job's own timing: its date beside a calendar, amber within 48 hours. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 * s, minWidth: 0 }}>
        <CalendarIcon size={44 * s} color={urgent(card, now) ? AMBER : "var(--text-muted)"} />
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ fontSize: 14 * s, color: urgent(card, now) ? AMBER : "var(--text-muted)" }}>
            {!it ? "Waiting since" : t ? fmt(t, { weekday: "long" }) + (more ? ` +${more}d` : "") : "Date"}
          </div>
          <div className="tnum" style={{ fontSize: 28 * s, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", marginTop: 2 * s }}>
            {!it ? fmt(lead.at, { day: "numeric", month: "short" }) : t ? fmt(t, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }) : "TBC"}
          </div>
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
          {isOpen(card) && card.awaiting_reply_since != null && <span className="tnum" style={{ color: replyColour(now - card.awaiting_reply_since), fontWeight: 700 }}>{waitText(now - card.awaiting_reply_since)} no reply · </span>}
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
  const listRef = useRef<HTMLDivElement>(null);
  const lastScrollAt = useRef(0);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [okAt, setOkAt] = useState<number | null>(null);
  /** Why the last refresh failed: the screen could not reach the system, or the system answered with an error. */
  const [failKind, setFailKind] = useState<null | "offline" | "error">(null);
  const failed = failKind !== null;
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
    let res: Response;
    try {
      res = await fetch("/api/feed", { cache: "no-store" });
    } catch {
      setFailKind("offline"); // keep the last good rows; the cloud goes grey
      return;
    }
    try {
      const body = (await res.json()) as FeedResponse;
      if (!res.ok || !body.ok) throw new Error("feed");
      const keys = new Set(body.items.flatMap((c) => c.items.map((i) => i.item_key)));
      // A chime for an item this screen has not seen before. Never on first load, at
      // most one per ten seconds, and only once a click has unlocked audio.
      const prev = seen.current;
      const arrived = !!prev && [...keys].some((k) => !prev.has(k));
      if (arrived && audio.current && Date.now() - lastChime.current > CHIME_GAP_MS) {
        lastChime.current = Date.now();
        try { chime(audio.current); } catch { /* audio is a nicety */ }
      }
      // Something new goes to the top, so the top is where the screen has to be looking.
      if (arrived) window.setTimeout(() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 50);
      seen.current = keys;
      setData(body);
      setOkAt(Date.now());
      setFailKind(null);
    } catch {
      setFailKind("error"); // the system answered, and the answer was a failure: the cloud goes red
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

  /**
   * THE TV ALWAYS COMES BACK TO THE TOP (Ben, 2026-10-04). The most urgent work is up
   * there, and a list somebody scrolled down and walked away from would hide it all day.
   * Twenty seconds after the last scroll it glides back.
   */
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollTop > 0 && Date.now() - lastScrollAt.current > RETURN_TO_TOP_MS) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [now]);

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

  /**
   * THE ORDER (Ben, 2026-10-04). Open orders above done ones. Within the open ones, every
   * client who has waited a day or more for our reply comes first; then everything by how
   * near the job is, nearest first, the longer wait breaking a tie. Undated jobs go last in
   * their group. Done keeps the server's order: what went green most recently on top.
   */
  const cards = useMemo(() => {
    const list = data?.items ?? [];
    const waited = (c: FeedCard) => (c.awaiting_reply_since != null ? now - c.awaiting_reply_since : -1);
    const red = (c: FeedCard) => (waited(c) >= REPLY_RED_MS ? 0 : 1);
    const when = (c: FeedCard) => deadline(c, now) ?? Number.MAX_SAFE_INTEGER;
    const open = list.filter(isOpen).sort((a, b) => red(a) - red(b) || when(a) - when(b) || waited(b) - waited(a));
    return [...open, ...list.filter((c) => !isOpen(c))];
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
  const emailStale = !!data?.health.intake_stale;
  const onsinchUnread = /unreadable|failed/i.test(data?.health.verify?.note ?? "");
  /**
   * THE SYNC CLOUD (Ben, 2026-10-04: no timers, a green, grey or red cloud).
   *   grey   offline: the screen cannot reach the system, or has had nothing for 2 minutes
   *   red    an error: the system answered with a failure, Gmail has gone quiet in working
   *          hours (intake was silently down for 53 hours on 2026-10-01..03), or OnSinch
   *          could not be read
   *   green  connected, and both are coming through
   * The ages are still measured; they just decide the colour instead of being printed.
   */
  const sync: "ok" | "offline" | "error" =
    failKind === "offline" || data == null || (dataAge != null && dataAge > STALE_DATA_MS && failKind == null) ? "offline"
    : failKind === "error" || emailStale || onsinchUnread ? "error"
    : "ok";
  const warn = sync !== "ok";
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
        <div style={{ display: "flex", alignItems: "center", gap: 26 * s, minWidth: 0 }}>
        <div aria-label="Spartan Crew" style={{ display: "flex", alignItems: "center", gap: 8 * s, flexShrink: 0 }}>
          <BrandWordmark height={40 * s} />
          <BrandMark height={52 * s} />
        </div>
        <div style={{ width: 2 * s, alignSelf: "stretch", background: "var(--border)", flexShrink: 0 }} />
        <div aria-label="Legend" style={{ display: "flex", flexDirection: "column", gap: 8 * s, minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 32 * s, alignItems: "center", fontSize: 31 * s, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 14 * s }}><span style={{ width: 32 * s, height: 32 * s, borderRadius: 8 * s, background: RED, flexShrink: 0 }} />Red = New job</span>
            <span style={{ display: "flex", alignItems: "center", gap: 14 * s }}><span style={{ width: 32 * s, height: 32 * s, borderRadius: 8 * s, background: BLUE, flexShrink: 0 }} />Blue = Update</span>
          </div>
          {/* The clock's key. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 * s, fontSize: 20 * s, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
            <ReplyClock ms={5 * 3_600_000} size={38 * s} label={false} />
            <span>= time since the client's email, unanswered</span>
            <span style={{ color: "var(--text-muted)" }}>· red at 24h</span>
          </div>
        </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {kpis.map((k) => (
            <div key={k.label.join(" ")} style={{ display: "flex", alignItems: "center", gap: 10 * s, padding: `0 ${16 * s}px`, borderLeft: `${2 * s}px solid var(--border)` }}>
              <span className="tnum" style={{ fontSize: 56 * s, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", color: k.n ? k.color : "var(--text-faint)" }}>{k.n}</span>
              <span style={{ fontSize: 19 * s, fontWeight: 600, lineHeight: 1.2, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{k.label[0]}<br />{k.label[1]}</span>
            </div>
          ))}
          <SyncCloud s={s} state={sync} why={failKind === "error" ? "The feed returned an error" : emailStale ? "No new email for 90+ min" : onsinchUnread ? "OnSinch could not be read" : ""} />
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

      <div ref={listRef} onScroll={() => { lastScrollAt.current = Date.now(); }} className="frosted-glass" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {data == null ? (
          <div style={{ padding: 40 * s, fontSize: 22 * s, fontWeight: 600, color: failed ? AMBER : "var(--text-muted)" }}>{failed ? "The feed could not be read. Retrying." : "Loading…"}</div>
        ) : (
          <>
            {openRows.length === 0 && (
              <div style={{ padding: `${22 * s}px ${20 * s}px`, borderBottom: "1px solid var(--border)", fontSize: 20 * s, fontWeight: 700, color: warn ? AMBER : GREEN, background: warn ? tint(AMBER, 10) : tint(GREEN, 12) }}>
                {warn ? "Nothing listed, but the sync is not healthy: see the cloud at the top right." : openCount === 0 && strip.length === 0 ? "Everything is checked." : "Nothing else waiting."}
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16 * s, flexShrink: 0 }}>
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
