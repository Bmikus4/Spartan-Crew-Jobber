"use client";

// The office TV: everything the engine processed that is still waiting on a person.
//
// A DISPLAY, NOT A WORKSPACE. The only control that writes is the tick, and the tick
// writes only its own record (app/lib/feed/check.ts). The same component runs in the app
// shell and fullscreen on the TV; `s` (scale) is the only difference.
//
// ONE LIST, ONE TILE PER JOB, TOP TO BOTTOM IN THE SERVER'S ORDER (Ben, 2026-10-10:
// "maintain the original tiling, just one up and down list"), matte and grained, and NO
// TIMERS: the reply-wait clock is gone from the screen. The wait still orders the list
// (orderCards puts a client waiting 24h+ first); it is just no longer drawn.
//
// AN EMPTY SCREEN MUST NEVER LOOK LIKE "ALL CLEAR". Intake was silently down for 53
// hours on 2026-10-01..03, so an empty list turns amber when the sync is not healthy, and a
// failed refresh keeps the last good tiles rather than clearing them.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { FeedCard, FeedCounts, FeedItem } from "../lib/feed/project";
import { deadline, londonDay, nextDay, QUIET_MS } from "../lib/feed/order";
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
/** A tile that has just gone green holds its place this long, then fades and moves to Done (Ben, 2026-10-04). */
const HOLD_MS = 3_000;
const RETURN_TO_TOP_MS = 20_000;
const FADE_MS = 600;

// Signal colours only, from the theme. Everything else is the tool's neutral tokens.
const RED = "var(--danger)";
const BLUE = "var(--viz-blue)";
const GREEN = "var(--up)";
const AMBER = "var(--warn)";
const GREY = "var(--text-muted)";
/** The red/blue edge on each tile, in px before scaling. */
const STRIPE = 4;
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
/**
 * Confirm wears the tool's primary button, not red (2026-10-10). Red means "New job" in the
 * legend, and a red button on every blue tile contradicted it. Set CONFIRM_FILL to RED and
 * CONFIRM_TEXT to "#fff" to restore the 10-04 look.
 */
const CONFIRM_FILL = "var(--accent)";
const CONFIRM_TEXT = "var(--accent-contrast)";

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
/** The signer's first name as the tick recorded it; ticks before 2026-10-05 carry only an email. */
function personName(by: string | null, name: unknown): string {
  if (typeof name === "string" && name.trim()) return name.trim().split(/\s+/)[0];
  const local = String(by ?? "").split("@")[0].split(/[._-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : "";
}
function evidenceLine(it: FeedItem): string | null {
  const g = it.green;
  if (!g) return null;
  const e = (g.evidence ?? {}) as { text?: string; at?: string; r_number?: string | null; held?: boolean; name?: string };
  const when = hhmm(Date.parse(e.at ?? "") || g.at);
  if (g.mark === "checked") { const who = personName(g.by, e.name); return `Confirmed${who ? ` by ${who}` : ""} ${when}`; }
  if (e.held) return "Already in OnSinch: every shift asked for";
  if (g.mark === "staff-edit") return `Changed in OnSinch by staff: ${e.text ?? "edited"}, ${when}`;
  if (g.mark === "order-found") return `Order found in OnSinch: ${e.r_number ? `R${String(e.r_number).replace(/^R/i, "")}` : e.text ?? "it exists"}, ${when}`;
  return `${e.text ?? "Done by the system"}, ${when}`;
}

/**
 * A BELL, NOT A BEEP (Ben, 2026-10-04: "softer and less 8 bit"). Two notes a fourth apart,
 * each a sine with two quiet upper partials that die away faster than it does, a gentle
 * attack and a long fade, through one short darkened echo for some room. The compressor
 * keeps it even without the edge a triangle or square wave gives. WebAudio, so there is no
 * file to fail to load.
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

/** Starts within 48 hours and is still open. */
function urgent(c: FeedCard, now: number): boolean {
  if (!isOpen(c)) return false;
  const at = deadline(c, now);
  return at != null && at - now <= URGENT_MS;
}

/**
 * Nothing, not "No order yet", when the card has no numbers (Ben, 2026-10-04): an unbound
 * need is often a job staff booked by hand, so the phrase was false 9 times in 12.
 */
function numbersOf(c: FeedCard): string | null {
  if (c.colour === "neutral" || (!c.r_number && !c.j_number)) return null;
  return [c.r_number, c.j_number].filter(Boolean).join("  ");
}

/** The system's reason, minus the Gmail message ids it quotes: ops cannot act on a hex id. */
const cleanNote = (n: string) => n.replace(/\s*\((?:[0-9a-f]{16})\)/g, "");

/**
 * The job's own timing: its next day, said as Today or Tomorrow when it is, amber within
 * 48 hours, with the count of further days a multi-day job runs. A reply-only card has no
 * job, so it shows the day the client wrote instead.
 */
function When({ card, it, lead, now, s }: { card: FeedCard; it: FeedItem | null; lead: FeedItem; now: number; s: number }) {
  const day = nextDay(card, now) ?? card.dates[0] ?? null;
  const t = day ? Date.parse(`${day}T12:00:00Z`) : null;
  const today = londonDay(now);
  const tomorrow = londonDay(Date.parse(`${today}T12:00:00Z`) + 86_400_000);
  const sameYear = t != null && fmt(t, { year: "numeric" }) === fmt(now, { year: "numeric" });
  const more = day ? card.dates.filter((d) => d > day).length : 0;
  const hot = urgent(card, now);
  const label = !it ? "Waiting since" : !day || t == null ? "Date" : day === today ? "Today" : day === tomorrow ? "Tomorrow" : fmt(t, { weekday: "long" });
  const value = !it ? fmt(lead.at, { day: "numeric", month: "short" }) : t != null ? fmt(t, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }) : "TBC";
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13 * s, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: hot ? AMBER : "var(--text-muted)", whiteSpace: "nowrap" }}>
        {label}{more > 0 && <span style={{ color: "var(--text-faint)" }}> · +{more} {more === 1 ? "day" : "days"}</span>}
      </div>
      <div className="tnum" style={{ fontSize: 28 * s, fontWeight: 700, lineHeight: 1.15, marginTop: 3 * s, whiteSpace: "nowrap", color: hot ? AMBER : t != null || !it ? "var(--text-primary)" : "var(--text-muted)" }}>{value}</div>
    </div>
  );
}

/**
 * The tick, as CONFIRM (Ben, 2026-10-04): the one thing on a tile a person is meant to
 * press. Pressed, it goes green and still undoes; green from evidence, it is a label that
 * says Done and does nothing.
 */
function Tick({ card, it, s, height, onTick }: { card: FeedCard; it: FeedItem; s: number; height: number; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const ticked = it.green?.mark === "checked";
  const autoGreen = !!it.green && !ticked;
  const h = height * s;
  const label = ticked ? "Confirmed" : it.green ? "Done" : "Confirm";
  return (
    <button
      aria-label={ticked ? "Undo confirm" : label}
      onClick={() => { if (!autoGreen) onTick(card, it, !ticked); }}
      style={{
        height: h, minWidth: h * 2.7, padding: `0 ${h * 0.36}px`, borderRadius: h * 0.24, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: h * 0.16,
        fontSize: h * 0.4, fontWeight: 700, whiteSpace: "nowrap",
        color: autoGreen ? GREEN : it.green ? "#fff" : CONFIRM_TEXT, background: autoGreen ? "transparent" : it.green ? GREEN : CONFIRM_FILL,
        border: autoGreen ? `1px solid ${tint(GREEN, 45)}` : "none",
        cursor: autoGreen ? "default" : "pointer", transition: "background-color 200ms, color 200ms",
      }}>
      {it.green && (
        <svg width={h * 0.4} height={h * 0.4} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4.5 12.5 10 18 19.5 6.5" /></svg>
      )}
      {label}
    </button>
  );
}

/**
 * THE SYNC STATE (Ben, 2026-10-04: no timers; green, grey or red).
 *   grey   offline: the screen cannot reach the system, or has had nothing for 2 minutes
 *   red    an error: the system answered with a failure, Gmail has gone quiet in working
 *          hours, or OnSinch could not be read
 *   green  connected, and both are coming through
 */
function Sync({ s, state, why }: { s: number; state: "ok" | "offline" | "error"; why: string }) {
  const color = state === "ok" ? GREEN : state === "error" ? RED : GREY;
  const text = state === "ok" ? "Synced with Gmail and OnSinch" : state === "error" ? `Sync error: ${why || "Gmail or OnSinch"}` : "Offline: not syncing";
  return (
    <div role="status" aria-label={text} style={{ display: "flex", alignItems: "center", gap: 10 * s, fontSize: 16 * s, fontWeight: 600, whiteSpace: "nowrap", color: state === "ok" ? "var(--text-secondary)" : color }}>
      <span style={{ width: 10 * s, height: 10 * s, borderRadius: 99, background: color, boxShadow: `0 0 0 ${4 * s}px ${tint(color, 22)}`, flexShrink: 0 }} />
      {text}
    </div>
  );
}

type Phase = "steady" | "hold" | "fade";

const clamp = (lines: number): React.CSSProperties => ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" });

/**
 * One job, one tile, one line of the list. Left to right: the client and what to do, then
 * the numbers that find it in OnSinch, then when, then Confirm. Fixed right-hand columns
 * keep every date and every Confirm on one vertical line down the screen.
 */
function JobTile({ card, now, s, phase, onTick }: { card: FeedCard; now: number; s: number; phase: Phase; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const it = orderItem(card);
  const lead = it ?? card.items[0];
  const done = card.green;
  const evidence = it ? evidenceLine(it) : null;
  const numbers = numbersOf(card);
  const note = !done && card.note ? cleanNote(card.note) : null;
  const detail = [note, card.contact, card.crew ? `${card.crew} crew` : null, card.venue].filter(Boolean).join(" · ");
  const sig = signal(card);
  return (
    <article className="feed-tile" data-open={isOpen(card) ? "" : undefined} style={{
      display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${300 * s}px ${190 * s}px ${200 * s}px`, alignItems: "center", columnGap: 28 * s,
      minHeight: 104 * s, padding: `${16 * s}px ${24 * s}px ${16 * s}px ${(24 + STRIPE) * s}px`,
      background: done ? `color-mix(in srgb, ${GREEN} 9%, var(--surface))` : "var(--surface)",
      border: "1px solid var(--border)", borderRadius: 14 * s,
      // The legend's colour as an inset left edge, kept when the tile goes green so it still reads.
      boxShadow: `inset ${STRIPE * s}px 0 0 0 ${sig}`,
      opacity: phase === "fade" ? 0 : 1,
      transition: `background-color 200ms ease, opacity ${FADE_MS}ms ease`,
      animation: phase === "steady" ? "feedTileIn 400ms ease" : undefined,
    }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 * s }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 * s, minWidth: 0 }}>
          {/* No client matched: the subject line, quoted and dimmer, so it never reads as a client's name. */}
          <span style={{ fontSize: 30 * s, fontWeight: 700, letterSpacing: "-0.015em", color: card.company ? "var(--text-primary)" : "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            {card.company || (card.subject ? `“${card.subject}”` : "Unknown client")}
          </span>
          <span style={{ fontSize: 17 * s, fontWeight: 600, color: done ? GREEN : sig, whiteSpace: "nowrap", flexShrink: 0 }}>
            {lead.status}{hasReply(card) && it && <span style={{ color: GREY }}> · Needs reply</span>}
          </span>
        </div>
        <div style={{ fontSize: 17 * s, fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {evidence
            ? <span style={{ color: GREEN }}>{evidence}</span>
            : <>{detail}{detail ? <span style={{ color: "var(--text-faint)" }}> · </span> : null}<span style={{ color: "var(--text-muted)" }}>{ago(lead.at, now)}</span></>}
        </div>
      </div>

      {/* The numbers find the job in OnSinch. */}
      <div className="mono" style={{ fontSize: 26 * s, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "pre", overflow: "hidden" }}>{numbers}</div>

      <When card={card} it={it} lead={lead} now={now} s={s} />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {it && <Tick card={card} it={it} s={s} height={52} onTick={onTick} />}
      </div>
    </article>
  );
}

function Section({ s, label, n, color }: { s: number; label: string; n: number; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 * s, padding: `${14 * s}px ${4 * s}px ${4 * s}px`, fontSize: 14 * s, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: color ?? "var(--text-muted)", flexShrink: 0 }}>
      <span style={{ whiteSpace: "nowrap" }}>{label} <span className="tnum" style={{ color: "var(--text-faint)" }}>{n}</span></span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
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
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [undo, setUndo] = useState<{ card: FeedCard; item: FeedItem; until: number } | null>(null);
  /** Tiles that have just gone green: where they stood, and when. */
  const [settling, setSettling] = useState<Map<string, { index: number; since: number }>>(new Map());
  const [below, setBelow] = useState(0);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const lastChime = useRef(0);
  const shown = useRef<string[]>([]);
  const wasGreen = useRef<Set<string> | null>(null);

  const s = full || tv ? 1 : 0.72;

  const load = useCallback(async () => {
    let res: Response;
    try {
      res = await fetch("/api/feed", { cache: "no-store" });
    } catch {
      setFailKind("offline"); // keep the last good tiles; the sync dot goes grey
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
      setFailKind("error"); // the system answered, and the answer was a failure: the sync dot goes red
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

  // The cursor and the fullscreen button hide after three idle seconds on the TV.
  useEffect(() => {
    if (!full && !tv) { setIdle(false); return; }
    let t = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS);
    const move = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS); };
    window.addEventListener("mousemove", move);
    return () => { window.clearTimeout(t); window.removeEventListener("mousemove", move); };
  }, [full, tv]);

  /**
   * A TILE THAT GOES GREEN STAYS PUT, THEN MOVES. Without this a finished job jumped
   * straight to Done on the next refresh, which on a full screen read as the job
   * vanishing. It is noticed here, from the data, so a tick, an engine write and a staff
   * edit found in OnSinch all settle the same way. Never on first load.
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

  // Released on the screen's own clock, not a timer per tile: a tick refetches within a
  // second, and a timer cleared by that refetch left the tile held in place for good.
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

  // The server's order (orderCards, app/lib/feed/order.ts), where test/feedProjection.ts pins it.
  const cards = data?.items ?? [];

  // Open tiles, with any tile still settling held at the place it stood.
  const settlingRows = cards.filter((c) => settling.has(c.thread_id));
  const openRows = cards.filter((c) => isOpen(c) && !settling.has(c.thread_id));
  for (const c of [...settlingRows].sort((a, b) => settling.get(a.thread_id)!.index - settling.get(b.thread_id)!.index)) {
    openRows.splice(Math.min(settling.get(c.thread_id)!.index, openRows.length), 0, c);
  }
  const doneRows = cards.filter((c) => !isOpen(c) && !settling.has(c.thread_id));
  useEffect(() => { shown.current = [...openRows, ...doneRows].map((c) => c.thread_id); });
  const phaseOf = (c: FeedCard): Phase => {
    const st = settling.get(c.thread_id);
    if (!st) return "steady";
    return now - st.since >= HOLD_MS ? "fade" : "hold";
  };

  /**
   * THE TV CANNOT SCROLL, SO IT SAYS WHAT IS BELOW. Open tiles whose top is under the fold
   * are counted every second and named at the foot of the list; without it the ninth job
   * waiting looked exactly like there being eight.
   */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const fold = el.getBoundingClientRect().bottom - 30 * s;
    const n = [...el.querySelectorAll("[data-open]")].filter((t) => t.getBoundingClientRect().top > fold).length;
    setBelow((b) => (b === n ? b : n));
  }, [now, data, s]);

  const c = data?.counts;
  const dataAge = okAt == null ? null : now - okAt;
  const emailStale = !!data?.health.intake_stale;
  const onsinchUnread = /unreadable|failed/i.test(data?.health.verify?.note ?? "");
  const sync: "ok" | "offline" | "error" =
    failKind === "offline" || data == null || (dataAge != null && dataAge > STALE_DATA_MS && failKind == null) ? "offline"
    : failKind === "error" || emailStale || onsinchUnread ? "error"
    : "ok";
  const warn = sync !== "ok";
  const urgentCount = cards.filter((x) => urgent(x, now)).length;
  const openCount = cards.filter(isOpen).length;
  const pad = 28 * s;

  const kpis: Array<{ label: string; n: number; color: string }> = c ? [
    { label: "Need created", n: c.needs_created, color: RED },
    { label: "Need updated", n: c.needs_updated, color: BLUE },
    { label: "To check", n: c.to_check, color: "var(--text-primary)" },
    ...(data?.health.replies_enabled ? [{ label: "Need reply", n: c.needs_reply, color: GREY }] : []),
    { label: "Within 48 hours", n: urgentCount, color: AMBER },
  ] : [];

  return (
    <div ref={rootRef} className="grain" style={{ position: "relative", height: "100%", width: "100%", background: "var(--bg)", color: "var(--text-primary)", display: "flex", flexDirection: "column", gap: 22 * s, padding: pad, cursor: idle ? "none" : undefined, overflow: "hidden" }}>
      <style>{`@keyframes feedTileIn { from { opacity: 0; transform: translateY(${6 * s}px); } to { opacity: 1; transform: none; } } .feed-list { scrollbar-width: none; } .feed-list::-webkit-scrollbar { display: none; }`}</style>

      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `${16 * s}px ${36 * s}px`, flexShrink: 0 }}>
        <div aria-label="Spartan Crew" style={{ display: "flex", alignItems: "center", gap: 8 * s, flexShrink: 0 }}>
          <BrandWordmark height={30 * s} />
          <BrandMark height={38 * s} />
        </div>

        {/* The legend: permanent, not interactive, exactly two entries. It is the key to every tile's edge. */}
        <div aria-label="Legend" style={{ display: "flex", alignItems: "center", gap: 26 * s, fontSize: 22 * s, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 11 * s }}><span style={{ width: 7 * s, height: 26 * s, borderRadius: 4 * s, background: RED }} />Red = New job</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 11 * s }}><span style={{ width: 7 * s, height: 26 * s, borderRadius: 4 * s, background: BLUE }} />Blue = Update</span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 32 * s, flexWrap: "wrap" }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span className="tnum" style={{ fontSize: 40 * s, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: k.n ? k.color : "var(--text-faint)" }}>{k.n}</span>
              <span style={{ fontSize: 13 * s, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 6 * s, whiteSpace: "nowrap" }}>{k.label}</span>
            </div>
          ))}
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
          <Sync s={s} state={sync} why={failKind === "error" ? "the feed returned an error" : emailStale ? "no new email for 90+ min" : onsinchUnread ? "OnSinch could not be read" : ""} />
          <button onClick={() => void goFull()} aria-label={full ? "Exit fullscreen" : "Fullscreen"} title={full ? "Exit fullscreen" : "Fullscreen"}
            style={{ width: 44 * s, height: 44 * s, borderRadius: 10 * s, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center", padding: 0, flexShrink: 0, opacity: idle ? 0 : 1, transition: "opacity 200ms" }}>
            <svg width={22 * s} height={22 * s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={full
                ? "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"
                : "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"} />
            </svg>
          </button>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
        <div ref={listRef} className="feed-list" onScroll={() => { lastScrollAt.current = Date.now(); }} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 * s, paddingBottom: 8 * s }}>
          {data == null ? (
            <div style={{ padding: 40 * s, fontSize: 22 * s, fontWeight: 600, color: failed ? AMBER : "var(--text-muted)" }}>{failed ? "The feed could not be read. Retrying." : "Loading…"}</div>
          ) : (
            <>
              {openRows.length === 0 && (
                <div style={{ padding: `${24 * s}px ${24 * s}px`, border: "1px solid var(--border)", borderRadius: 14 * s, fontSize: 20 * s, fontWeight: 600, color: warn ? AMBER : GREEN, background: warn ? tint(AMBER, 8) : tint(GREEN, 8), flexShrink: 0 }}>
                  {warn ? "Nothing listed, but the sync is not healthy." : openCount === 0 ? "Everything is checked." : "Nothing else waiting."}
                </div>
              )}
              {openRows.map((card, i) => (
                <Fragment key={card.thread_id}>
                  {/* Sunk, not hidden (Ben, 2026-10-05): the label says why these sit lower. */}
                  {card.quiet && !openRows[i - 1]?.quiet && <Section s={s} label={`Nothing new for ${QUIET_MS / 86_400_000}+ days`} n={openRows.filter((x) => x.quiet).length} />}
                  <JobTile card={card} now={now} s={s} phase={phaseOf(card)} onTick={tick} />
                </Fragment>
              ))}
              <Section s={s} label="Done" n={doneRows.length} color={GREEN} />
              {doneRows.map((card) => <JobTile key={card.thread_id} card={card} now={now} s={s} phase="steady" onTick={tick} />)}
              {c && c.older > 0 && (
                <div style={{ padding: `${10 * s}px ${4 * s}px`, fontSize: 15 * s, color: "var(--text-muted)", flexShrink: 0 }}>
                  {c.older} older undated {c.older === 1 ? "enquiry" : "enquiries"} with no word from the client for two weeks, not shown.
                </div>
              )}
            </>
          )}
        </div>
        {below > 0 && (
          <div aria-live="polite" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 110 * s, pointerEvents: "none", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 12 * s, background: "linear-gradient(to bottom, transparent, var(--bg) 75%)" }}>
            <span className="tnum" style={{ fontSize: 18 * s, fontWeight: 600, color: "var(--text-primary)", background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 99, padding: `${8 * s}px ${20 * s}px` }}>
              {below} more waiting below
            </span>
          </div>
        )}
      </div>

      {undo && undo.until > now && (
        <div role="status" style={{ position: "absolute", left: "50%", bottom: 32 * s, transform: "translateX(-50%)", background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: 12 * s, padding: `${12 * s}px ${16 * s}px ${12 * s}px ${20 * s}px`, fontSize: 18 * s, fontWeight: 600, display: "flex", gap: 16 * s, alignItems: "center" }}>
          Confirmed{undo.card.company ? `: ${undo.card.company}` : ""}
          <button onClick={() => { const u = undo; setUndo(null); void tick(u.card, u.item, false); }} style={{ fontSize: 15 * s, fontWeight: 700, padding: `${6 * s}px ${14 * s}px`, borderRadius: 8 * s, border: "none", background: "var(--accent)", color: "var(--accent-contrast)", cursor: "pointer" }}>Undo</button>
        </div>
      )}
    </div>
  );
}
