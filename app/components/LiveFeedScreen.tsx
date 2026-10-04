"use client";

// The office TV: everything the engine processed that is still waiting on a person.
//
// A DISPLAY, NOT A WORKSPACE. The only control that writes is the tick, and the tick
// writes only its own record (app/lib/feed/check.ts). The same component runs in the app
// shell and fullscreen on the TV; `scale` is the only difference.
//
// AN EMPTY SCREEN MUST NEVER LOOK LIKE "ALL CLEAR". Intake was silently down for 53
// hours on 2026-10-01..03, so the data age and the last-email age are always on screen
// and turn amber, and a failed refresh keeps the last good cards with the age climbing
// rather than clearing them.

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
/** Five, not six: at 1080p six compact cards cut "Order needs created" to "Order need...". */
const STRIP = 5;

const C = {
  bg: "#0b0d10", text: "#ffffff", dim: "#b9c0cb", faint: "#7d8592",
  red: "#c81e1e", blue: "#1d5fd1", green: "#157f3c", grey: "#3d4450", dark: "#171b22", amber: "#f59e0b",
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
function dayLabel(d: string): string {
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(t) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(t) : d;
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
/** What leaves first when the screen is full: green, then unverified checks, needs last. */
const keepRank = (c: FeedCard) => (openNeed(c) ? 0 : c.green ? 2 : 1);

function fit(cards: FeedCard[], cap: number): { shown: FeedCard[]; hidden: number } {
  if (cards.length <= cap) return { shown: cards, hidden: 0 };
  const keep = new Set([...cards].map((c, i) => ({ c, i })).sort((a, b) => keepRank(a.c) - keepRank(b.c) || a.i - b.i).slice(0, cap).map((x) => x.c));
  return { shown: cards.filter((c) => keep.has(c)), hidden: cards.length - keep.size };
}

function Card({ card, now, s, compact, onTick }: { card: FeedCard; now: number; s: number; compact?: boolean; onTick: (c: FeedCard, it: FeedItem, checked: boolean) => void }) {
  const it = orderItem(card);
  const reply = hasReply(card);
  const lead = it ?? card.items[0];
  const edge = card.colour === "red" ? C.red : card.colour === "blue" ? C.blue : C.grey;
  const solid = card.lane !== "check" && !card.green;
  const bg = card.green ? C.green : solid ? edge : C.dark;
  const chipBg = solid ? "#ffffff" : edge;
  const chipFg = solid ? edge : "#ffffff";
  const evidence = it ? evidenceLine(it) : null;
  const ticked = it?.green?.mark === "checked";
  const autoGreen = !!it?.green && !ticked;
  const longStatus = !compact && lead.status.length > 20;

  const ident = [
    card.company,
    card.contact,
    card.dates.length ? dayLabel(card.dates[0]) + (card.dates.length > 1 ? ` +${card.dates.length - 1} days` : "") : null,
    card.crew ? `${card.crew} crew` : null,
    compact ? null : card.venue,
  ].filter(Boolean).join(" · ");
  const numbers = card.colour === "neutral" ? null : card.r_number || card.j_number ? [card.r_number, card.j_number].filter(Boolean).join(" ") : "No order yet";

  return (
    <div style={{
      position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", borderRadius: 12 * s,
      background: bg, color: C.text,
      borderLeft: `${14 * s}px solid ${card.lane === "check" && !card.green ? edge : bg}`,
      // the thin red or blue edge a green card keeps, so the legend still reads
      boxShadow: card.green ? `inset 0 0 0 ${4 * s}px ${edge}` : undefined,
      padding: `${(compact ? 12 : 18) * s}px ${(compact ? 14 : 20) * s}px`, paddingRight: (it ? (compact ? 62 : 84) : 20) * s,
      display: "flex", flexDirection: "column", gap: 6 * s,
    }}>
      {/* "Order was created, check to verify" is the requester's wording and does not fit one
          line at 42px in a third of 1080p; it was shown as "Order was created, ch...". A long
          phrase takes two lines and the identity gives one back. */}
      <div style={{ fontSize: (compact ? 25 : 42) * s, fontWeight: 800, lineHeight: 1.1, overflow: "hidden", ...(longStatus ? { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const } : { whiteSpace: "nowrap", textOverflow: "ellipsis" }) }}>
        {lead.status}
      </div>
      <div style={{ display: "flex", gap: 10 * s, alignItems: "center", flexWrap: "nowrap", overflow: "hidden", fontSize: (compact ? 16 : 22) * s, fontWeight: 800, letterSpacing: "0.04em" }}>
        {card.colour !== "neutral" && <span style={{ background: chipBg, color: chipFg, borderRadius: 6 * s, padding: `${2 * s}px ${10 * s}px`, whiteSpace: "nowrap", flexShrink: 0 }}>{card.colour === "red" ? "NEW JOB" : "UPDATE"}</span>}
        {reply && it && <span style={{ background: "#e5e7eb", color: "#1f2937", borderRadius: 6 * s, padding: `${2 * s}px ${10 * s}px`, whiteSpace: "nowrap", flexShrink: 0 }}>{compact ? "REPLY" : "NEEDS REPLY"}</span>}
        {/* The numbers sit here, not in the identity line, because that line is clamped and a
            long venue cut "R10616 J13989" to "R10616..." on the 1080p screen. The number is
            how somebody finds the job, so it is the one thing that may never be truncated. */}
        {numbers && <span style={{ letterSpacing: 0, whiteSpace: "nowrap", flexShrink: 0 }}>{numbers}</span>}
        <span style={{ fontWeight: 600, letterSpacing: 0, color: solid || card.green ? "rgba(255,255,255,0.85)" : C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ago(lead.at, now)}</span>
      </div>
      <div style={{ fontSize: (compact ? 18 : 29) * s, fontWeight: 600, lineHeight: 1.2, display: "-webkit-box", WebkitLineClamp: longStatus ? 1 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {ident || card.subject}
      </div>
      {evidence && !compact && (
        <div style={{ marginTop: "auto", fontSize: 20 * s, fontWeight: 600, color: "rgba(255,255,255,0.92)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{evidence}</div>
      )}
      {it && (
        <button
          aria-label={ticked ? "Undo check" : it.green ? "Verified" : "Mark checked"}
          onClick={() => { if (!autoGreen) onTick(card, it, !ticked); }}
          style={{
            position: "absolute", right: (compact ? 14 : 18) * s, top: "50%", transform: "translateY(-50%)",
            width: (compact ? 36 : 48) * s, height: (compact ? 36 : 48) * s, borderRadius: 8 * s, cursor: autoGreen ? "default" : "pointer",
            border: `${3 * s}px solid rgba(255,255,255,0.9)`, background: it.green ? "#ffffff" : "transparent",
            color: C.green, fontSize: 34 * s, fontWeight: 900, lineHeight: 1, display: "grid", placeItems: "center", padding: 0,
          }}>
          {it.green ? "✓" : ""}
        </button>
      )}
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

  // The cursor hides after three idle seconds on the TV.
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

  const cards = useMemo(() => data?.items ?? [], [data]);
  const pad = 24 * s;
  const gap = 16 * s;
  const cardH = 236 * s;
  const minW = 600 * s;
  const cols = Math.max(1, Math.floor((box.w - 2 * pad + gap) / (minW + gap)));
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
  const stripH = layout === "b" && strip.length ? 150 * s + gap + (stripMore ? moreH : 0) : 0;
  const rows = Math.max(1, Math.floor((box.h - 2 * pad - stripH - moreH) / (cardH + gap)));
  const { shown, hidden } = fit(rest, cols * rows);

  const c = data?.counts;
  const dataAge = okAt == null ? null : now - okAt;
  const dataStale = failed || (dataAge != null && dataAge > STALE_DATA_MS);
  const emailAt = data?.health.last_email_at ? Date.parse(data.health.last_email_at) : null;
  const emailStale = !!data?.health.intake_stale;
  const countParts = c ? [
    `${c.needs_created} need created`,
    `${c.needs_updated} need updated`,
    data?.health.replies_enabled ? `${c.needs_reply} need reply` : null,
    `${c.to_verify} to verify`,
  ].filter(Boolean) : [];

  return (
    <div ref={rootRef} style={{ position: "relative", height: "100%", width: "100%", background: C.bg, color: C.text, display: "flex", flexDirection: "column", cursor: idle ? "none" : undefined, fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 * s, padding: `${16 * s}px ${pad}px`, borderBottom: "1px solid #232832", flexShrink: 0 }}>
        {/* The legend: permanent, not interactive, exactly two entries. */}
        <div aria-label="Legend" style={{ display: "flex", gap: 22 * s, alignItems: "center", fontSize: 26 * s, fontWeight: 700, whiteSpace: "nowrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 * s }}><span style={{ width: 30 * s, height: 30 * s, borderRadius: 6 * s, background: C.red }} />Red = New job</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 * s }}><span style={{ width: 30 * s, height: 30 * s, borderRadius: 6 * s, background: C.blue }} />Blue = Update</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 * s, minWidth: 0 }}>
          <div style={{ textAlign: "right", minWidth: 0 }}>
            <div style={{ fontSize: 26 * s, fontWeight: 800, whiteSpace: "nowrap" }}>{countParts.join(" · ") || "Loading…"}</div>
            <div style={{ fontSize: 20 * s, fontWeight: 600, whiteSpace: "nowrap", color: C.dim }}>
              <span style={{ color: dataStale ? C.amber : undefined }}>{failed ? "refresh failed, " : ""}updated {ageShort(okAt, now)}</span>
              {" · "}
              <span style={{ color: emailStale ? C.amber : undefined }}>last email {ageShort(emailAt, now)}</span>
            </div>
          </div>
          <button onClick={toggleLayout} title="Switch layout" style={ctl(s)}>{layout === "a" ? "Layout B" : "Layout A"}</button>
          <button onClick={() => void goFull()} style={ctl(s)}>{full ? "Exit fullscreen" : "Fullscreen"}</button>
        </div>
      </header>

      <div ref={gridRef} style={{ flex: 1, minHeight: 0, padding: pad, display: "flex", flexDirection: "column", gap }}>
        {data == null ? (
          <div style={{ margin: "auto", fontSize: 32 * s, color: failed ? C.amber : C.dim, fontWeight: 700 }}>{failed ? "The feed could not be read. Retrying." : "Loading…"}</div>
        ) : (
          <>
            {layout === "b" && strip.length > 0 && (
              <div style={{ flexShrink: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${STRIP}, minmax(0, 1fr))`, gap, height: 150 * s }}>
                  {strip.map((card) => <Card key={card.thread_id} card={card} now={now} s={s} compact onTick={tick} />)}
                </div>
                {stripMore > 0 && <div style={more(s, moreH)}>+{stripMore} more needing an order or a reply</div>}
              </div>
            )}
            {shown.length === 0 && strip.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center", fontSize: 30 * s, color: C.dim, fontWeight: 700 }}>
                Nothing waiting.
                <div style={{ fontSize: 22 * s, marginTop: 8 * s, color: emailStale ? C.amber : C.faint }}>Last email {ageShort(emailAt, now)}</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: cardH, gap, alignContent: "start", flex: 1, minHeight: 0 }}>
                {shown.map((card) => <Card key={card.thread_id} card={card} now={now} s={s} onTick={tick} />)}
              </div>
            )}
            <div style={more(s, moreH)}>
              {hidden > 0 ? `+${hidden} more` : ""}
              {c && c.older_unchecked > 0 ? `${hidden > 0 ? " · " : ""}older, unchecked: ${c.older_unchecked}` : ""}
            </div>
          </>
        )}
      </div>

      {undo && undo.until > now && (
        <div role="status" style={{ position: "absolute", left: "50%", bottom: 28 * s, transform: "translateX(-50%)", background: "#f3f4f6", color: "#111827", borderRadius: 10 * s, padding: `${12 * s}px ${18 * s}px`, fontSize: 22 * s, fontWeight: 700, display: "flex", gap: 18 * s, alignItems: "center", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
          Marked checked{undo.card.company ? `: ${undo.card.company}` : ""}
          <button onClick={() => { const u = undo; setUndo(null); void tick(u.card, u.item, false); }} style={{ ...ctl(s), background: "#111827", color: "#fff" }}>Undo</button>
        </div>
      )}
    </div>
  );
}

function ctl(s: number): React.CSSProperties {
  return { fontSize: 18 * s, fontWeight: 700, padding: `${8 * s}px ${14 * s}px`, borderRadius: 8 * s, border: "1px solid #3a414d", background: "#1c212a", color: "#ffffff", cursor: "pointer", whiteSpace: "nowrap" };
}
function more(s: number, h: number): React.CSSProperties {
  return { height: h, flexShrink: 0, display: "flex", alignItems: "center", fontSize: 22 * s, fontWeight: 700, color: C.dim };
}
