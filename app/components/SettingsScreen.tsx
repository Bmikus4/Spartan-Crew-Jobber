"use client";

// Settings — the switches that decide how much the engine is allowed to do on its
// own. Every one of them saves the moment it is touched.
//
// The controls used to be four hand-written copies of the same segmented button
// group, and the copies had already drifted apart in padding. There is one now
// (Segmented, over .seg in globals.css), and one save indicator for the screen
// rather than the same "Changes save automatically." line repeated in three cards —
// which said it three times and still never said WHICH change had saved.

import { useCallback, useEffect, useState } from "react";
import InstallButton from "./InstallButton";

type OrderMode = "draft-only" | "auto";
type ReplyDelivery = "draft" | "send";
type ReplyScope = "all" | "enquiries";
interface Settings { order_mode: OrderMode; replies_enabled: boolean; reply_delivery: ReplyDelivery; reply_scope: ReplyScope; default_rate_card: number }

const SETTINGS_FALLBACK: Settings = { order_mode: "draft-only", replies_enabled: false, reply_delivery: "draft", reply_scope: "all", default_rate_card: 315 };

const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const FAINT = "var(--text-faint)";
const BORDER = "var(--border)";
const A = "var(--accent)";

/** One segmented control for the whole screen. */
function Segmented<T extends string | number | boolean>({ value, options, onChange, label }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" className="seg__btn"
          aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, blurb, children }: { title: string; blurb?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}>
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: INK, margin: 0 }}>{title}</h2>
        {blurb && <p style={{ fontSize: 12.5, color: MUT, margin: "5px 0 0", lineHeight: 1.55 }}>{blurb}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Both icons ship and `data-theme` decides which shows (.theme-toggle in
 * globals.css). There is no theme state in React: the attribute IS the state, set
 * before React exists by the boot script in layout.tsx, so a second copy here could
 * only ever disagree with it.
 *
 * It lives in the footer of THIS screen, where the quote tool keeps it (Ben,
 * 2026-08-10). It was in the header of every screen — chrome spent on a control
 * touched twice a year.
 */
function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    // One beat of .theme-anim crossfades the whole UI on one clock instead of each
    // component running its own inline transition, or none.
    root.classList.add("theme-anim");
    window.setTimeout(() => root.classList.remove("theme-anim"), 300);
    root.setAttribute("data-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#efe8da" : "#0e0e0e");
    try { localStorage.setItem("theme", next); } catch {}
  }
  return (
    <button onClick={toggle} className="theme-toggle" aria-label="Toggle light or dark theme" title="Toggle light or dark theme">
      <svg className="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
      <svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" /></svg>
    </button>
  );
}

/** A consequence worth reading before the switch is flipped. Tokens, not literal
 *  rgba of the dark-theme red — the callouts were hardcoded and stayed dark-red on
 *  the tan ground. */
function Warn({ children, tone = "danger" }: { children: React.ReactNode; tone?: "danger" | "accent" }) {
  const bg = tone === "danger" ? "var(--danger-subtle)" : "var(--accent-subtle)";
  const bd = tone === "danger" ? "var(--danger-border)" : "var(--accent-border)";
  return (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: "10px 13px", fontSize: 12, color: SUB, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

export default function SettingsScreen({ signedInAs }: { signedInAs?: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/settings");
        setSettings({ ...SETTINGS_FALLBACK, ...(await r.json()) });
      } catch { setSettings(SETTINGS_FALLBACK); }
    })();
  }, []);

  const save = useCallback(async (next: Settings) => {
    setSettings(next); setSaving(true); setFailed(false);
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      // A failed save used to be swallowed: the try only wrapped the fetch and a
      // non-2xx still fell through to "Saved." So the screen could report a switch
      // as saved that the server had refused.
      if (!r.ok) throw new Error(String(r.status));
      setSavedAt(Date.now());
    } catch { setFailed(true); }
    finally { setSaving(false); }
  }, []);

  // A column: the panels scroll, the footer bar does not.
  const wrap: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", padding: "20px var(--panel-pad-x) 44px" };
  const shell = (body: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {body}
      <SettingsFooter />
    </div>
  );

  if (!settings) return shell(
    <div style={wrap}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <header>
          <span className="skel" style={{ height: 22, width: 190 }} />
          <div style={{ marginTop: 8 }}><span className="skel" style={{ height: 12, width: 300 }} /></div>
        </header>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "18px 20px", opacity: 1 - i * 0.15 }}>
            <span className="skel" style={{ display: "block", height: 13, width: 130 }} />
            <span className="skel" style={{ display: "block", height: 11, width: "88%", marginTop: 9 }} />
            <span className="skel" style={{ display: "block", height: 35, width: 220, marginTop: 14, borderRadius: 10 }} />
          </div>
        ))}
      </div>
    </div>
  );

  const s = settings;
  return shell(
    <div style={wrap}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 2px" }}>Engine controls</h1>
            <p style={{ fontSize: 13, color: MUT, margin: 0 }}>How much the automation does on its own once n8n triggers it.</p>
          </div>
          {/* ONE indicator, for the screen. Every switch here writes to the same
              settings row, so a per-card status line was three views of one state. */}
          <span aria-live="polite" style={{ fontSize: 11.5, color: failed ? "var(--danger)" : saving ? MUT : savedAt ? "var(--up)" : FAINT, whiteSpace: "nowrap", fontWeight: failed ? 700 : 400 }}>
            {failed ? "Save failed — not applied" : saving ? "Saving…" : savedAt ? "Saved" : "Changes save as you make them"}
          </span>
        </header>

        <Panel
          title="Order mode"
          blurb={<><b style={{ color: SUB }}>Draft-only</b> stages every OnSinch order for one-click approval on the Jobs Board — nothing is written automatically. <b style={{ color: SUB }}>Auto</b> writes confident orders hands-free.</>}
        >
          <Segmented label="Order mode" value={s.order_mode} onChange={(v) => save({ ...s, order_mode: v })}
            options={[{ id: "draft-only" as OrderMode, label: "Draft-only" }, { id: "auto" as OrderMode, label: "Auto (hands-free)" }]} />
          {s.order_mode === "auto" && (
            <Warn>Auto mode writes orders to OnSinch with no human check. Only turn this on once the needs-human and failure rates have been low for a while.</Warn>
          )}
        </Panel>

        <Panel
          title="AI email replies"
          blurb={<>When on, the engine drafts a Spartan Crew reply to each inbound email, in Spartan&apos;s voice and with the whole thread as context. <b style={{ color: SUB }}>Off by default</b> — classification and order staging run without it.</>}
        >
          <Segmented label="AI email replies" value={s.replies_enabled} onChange={(v) => save({ ...s, replies_enabled: v })}
            options={[{ id: false, label: "Off" }, { id: true, label: "On" }]} />

          {/* The two settings below only mean anything once replies are on, so they
              stay out of the way until then. */}
          {s.replies_enabled && (
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 13 }}>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: INK, margin: 0 }}>Reply delivery</h3>
                <p style={{ fontSize: 12.5, color: MUT, margin: "5px 0 0", lineHeight: 1.55 }}>
                  <b style={{ color: SUB }}>Draft</b> leaves the reply in the Gmail thread for a person to read and send. <b style={{ color: SUB }}>Send</b> means the engine sends it itself.
                </p>
              </div>
              <Segmented label="Reply delivery" value={s.reply_delivery} onChange={(v) => save({ ...s, reply_delivery: v })}
                options={[{ id: "draft" as ReplyDelivery, label: "Draft" }, { id: "send" as ReplyDelivery, label: "Send" }]} />
              {s.reply_delivery === "send" && (
                <Warn>Send mode emails clients before anyone has read the reply. Only turn it on once drafted replies have been checked for a while.</Warn>
              )}

              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 13 }}>
                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: INK, margin: 0 }}>Which emails get a reply</h3>
                  <p style={{ fontSize: 12.5, color: MUT, margin: "5px 0 0", lineHeight: 1.55 }}>
                    <b style={{ color: SUB }}>All emails</b> includes plain acknowledgements like &quot;PO received, thanks&quot;. <b style={{ color: SUB }}>New enquiries only</b> is just the threads asking for crew. Around 45% of threads are acknowledgements, so this roughly halves the drafts waiting to be reviewed.
                  </p>
                </div>
                <Segmented label="Which emails get a reply" value={s.reply_scope} onChange={(v) => save({ ...s, reply_scope: v })}
                  options={[{ id: "all" as ReplyScope, label: "All emails" }, { id: "enquiries" as ReplyScope, label: "New enquiries only" }]} />
              </div>
            </div>
          )}
        </Panel>

        {/* The rate-card control is GONE from this screen (Ben, 2026-08-10). It asked
            an operator to hold a pricing decision in their head on a screen about
            switches — the number that gets charged is not a preference. The setting
            itself is untouched in the database and the engine still uses it exactly as
            before, including the rule that an order priced from it is never written
            hands-free. Nothing about pricing behaviour changed; the knob is not on the
            wall any more. */}

        <Panel title="Install app" blurb="Add Spartan Crew to a phone or desktop home screen for full-screen, one-tap access.">
          <InstallButton />
        </Panel>

        <Panel
          title="Trigger"
          blurb={<>The mailbox trigger lives in n8n. It POSTs each hydrated thread to <span className="mono" style={{ color: SUB }}>/api/n8n-inbound</span>; the engine runs here on Vercel. <span className="mono" style={{ color: SUB }}>N8N_WEBHOOK_SECRET</span> locks the endpoint.</>}
        />

        {signedInAs && (
          <Panel title="Account" blurb={<>Signed in as <b style={{ color: SUB }}>{signedInAs}</b>.</>}>
            <button
              onClick={async () => { try { await fetch("/api/auth", { method: "DELETE" }); } catch {} window.location.href = "/"; }}
              style={{ alignSelf: "flex-start", padding: "11px 22px", borderRadius: "var(--radius)", border: "1px solid var(--danger-border)", background: "var(--danger-subtle)", color: "var(--danger)", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
            >
              Sign out
            </button>
          </Panel>
        )}
      </div>
    </div>
  );
}

/**
 * Settings owns a real footer bar, the same one the quote tool has: the agency link
 * on the left, the sun/moon on the right, at --footer-bar-height with a top rule. It
 * does not scroll with the panels above it.
 */
function SettingsFooter() {
  return (
    <div style={{ height: "var(--footer-bar-height)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--panel-pad-x)", borderTop: `1px solid ${BORDER}` }}>
      <a href="https://www.samuraisolutions.co.uk/" target="_blank" rel="noopener noreferrer"
        style={{ color: FAINT, fontSize: 11, letterSpacing: "0.06em", textDecoration: "none" }}>
        samuraisolutions.co.uk
      </a>
      <ThemeToggle />
    </div>
  );
}
