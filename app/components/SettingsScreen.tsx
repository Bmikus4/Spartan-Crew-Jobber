"use client";

// Settings — the switches that decide how much the engine is allowed to do on its
// own. Every one of them saves the moment it is touched.
//
// The controls used to be four hand-written copies of the same segmented button
// group, and the copies had already drifted apart in padding. There is one now
// (Segmented, over .seg in globals.css), and one save indicator for the screen
// rather than the same "Changes save automatically." line repeated in three cards —
// which said it three times and still never said WHICH change had saved.

import FolderTab from "./FolderTab";
import AnalyticsPopup from "./AnalyticsPopup";
import { useCallback, useEffect, useState } from "react";
import InstallButton from "./InstallButton";

type ReplyDelivery = "draft" | "send";
type ReplyScope = "all" | "enquiries";
interface Settings { replies_enabled: boolean; test_data_autoclear?: boolean; create_lead_days?: number; create_lead_enabled?: boolean; create_lead_applies_to?: "creates" | "changes" | "both"; bot_writes_enabled?: boolean; reply_delivery: ReplyDelivery; reply_scope: ReplyScope; default_rate_card: number }

const SETTINGS_FALLBACK: Settings = { replies_enabled: false, reply_delivery: "draft", reply_scope: "all", default_rate_card: 315 };

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

  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const save = useCallback(async (next: Settings) => {
    setSettings(next); setSaving(true); setFailed(false);
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      // A failed save used to be swallowed: the try only wrapped the fetch and a
      // non-2xx still fell through to "Saved." So the screen could report a switch
      // as saved that the server had refused.
      if (!r.ok) throw new Error(String(r.status));
      setSavedAt(Date.now());
      // The rail and the TV read these switches too; they refetch on this.
      window.dispatchEvent(new Event("spartan:settings"));
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
        <FolderTab label="View analytics" onOpen={() => setAnalyticsOpen(true)} />
        {analyticsOpen && <AnalyticsPopup onClose={() => setAnalyticsOpen(false)} />}
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
          title="Bot orders and updates"
          blurb={<>The master switch for the bot&apos;s work in OnSinch: creating new orders in Orders To Confirm and updating existing ones. <b style={{ color: SUB }}>Off</b>, every email is still read and decided, and anything the bot would write shows on the TV for a person to do by hand. Off by default.</>}
        >
          <Segmented label="Bot orders and updates" value={!!s.bot_writes_enabled} onChange={(v) => save({ ...s, bot_writes_enabled: v })}
            options={[{ id: false, label: "Off" }, { id: true, label: "On" }]} />
          {s.bot_writes_enabled && <Warn tone="accent">On: the bot creates and updates orders for clients from the next email.</Warn>}
        </Panel>

        <Panel
          title="AI email drafts"
          blurb={<>One switch for every email the system writes in a Gmail thread for a person: a reply to an inbound email, in Spartan&apos;s voice with the whole thread as context, and a follow-up on a job the office TV marks <b style={{ color: SUB }}>Needs Follow Up</b> (nothing from anyone for 24 hours). <b style={{ color: SUB }}>Off by default</b>: orders are read and made without it.</>}
        >
          <Segmented label="AI email drafts" value={s.replies_enabled} onChange={(v) => save({ ...s, replies_enabled: v })}
            options={[{ id: false, label: "Off" }, { id: true, label: "On" }]} />
          {/* Said on the screen, not left to be discovered: a switch that changes nothing while
              looking like it worked is how the replies toggle failed before (settingsDb). */}
          {s.replies_enabled && <Warn tone="accent">Saved. No drafts are written yet: drafting is parked, and the current engine has no drafting step.</Warn>}

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

        <LeadDaysPanel days={s.create_lead_days ?? 14} enabled={s.create_lead_enabled !== false} appliesTo={s.create_lead_applies_to ?? "creates"}
          onSave={(v) => save({ ...s, create_lead_days: v })} onEnabled={(v) => save({ ...s, create_lead_enabled: v })}
          onAppliesTo={(v) => save({ ...s, create_lead_applies_to: v })} />

        <TestDataPanel autoclear={!!s.test_data_autoclear} onAutoclear={(v) => save({ ...s, test_data_autoclear: v })} />

        <Panel title="Install app" blurb="Add Spartan Crew to a phone or desktop home screen for full-screen, one-tap access.">
          <InstallButton />
        </Panel>

        {/* THE ACCOUNT PANEL IS ALWAYS HERE. It used to render only when a session
            existed, so with AUTH_REQUIRED off — which is how the board runs today —
            there was no sign-out control anywhere in the app, and looking for one told
            you the app did not have one. Whether you are signed in is a fact this panel
            STATES; it is not a reason to hide the panel. */}
        <Panel
          title="Account"
          blurb={signedInAs
            ? <>Signed in as <b style={{ color: SUB }}>{signedInAs}</b>.</>
            : <>Not signed in. The board is readable without an account until sign-in is enforced, so signing in is how you get your name on what you approve.</>}
        >
          {signedInAs ? (
            <button
              onClick={async () => { try { await fetch("/api/auth", { method: "DELETE" }); } catch {} window.location.href = "/"; }}
              style={{ alignSelf: "flex-start", padding: "11px 22px", borderRadius: "var(--radius)", border: "1px solid var(--danger-border)", background: "var(--danger-subtle)", color: "var(--danger)", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
            >
              Sign out
            </button>
          ) : (
            <a
              href="/api/auth/google"
              style={{ alignSelf: "flex-start", padding: "11px 22px", borderRadius: "var(--radius)", border: "1px solid var(--accent-border)", background: "var(--accent-subtle)", color: "var(--text-primary)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
            >
              Sign in with Google
            </a>
          )}
        </Panel>
      </div>
    </div>
  );
}

type Plan = { orders: { number: string; name: string }[]; companies: { name: string }[]; threads: number; rows: Record<string, number>; kept: string[]; over: string | null };
type Cleared = { at: string; trigger: string; orders: string[]; companies: string[]; rows: Record<string, number>; failed: string[]; refused?: string };
const total = (rows: Record<string, number>) => Object.values(rows ?? {}).reduce((a, b) => a + b, 0);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const summary = (c: Cleared) => `${c.orders.length} order${c.orders.length === 1 ? "" : "s"}, ${c.companies.length} compan${c.companies.length === 1 ? "y" : "ies"}, ${total(c.rows)} records`;
const BY: Record<string, string> = { sweep: "the 15-minute sweep", button: "this button", cli: "the script" };

/** A setting's line: what it is and what it does on the left, its control on the right (under it on a phone). */
function Row({ title, hint, children }: { title: string; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px 18px", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{title}</div>
        {hint && <div style={{ fontSize: 12.5, color: MUT, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

type LeadScope = "creates" | "changes" | "both";
function LeadDaysPanel({ days, enabled, appliesTo, onSave, onEnabled, onAppliesTo }: { days: number; enabled: boolean; appliesTo: LeadScope; onSave: (v: number) => void; onEnabled: (v: boolean) => void; onAppliesTo: (v: LeadScope) => void }) {
  const [draft, setDraft] = useState(String(days));
  useEffect(() => { setDraft(String(days)); }, [days]);
  const n = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 365;
  const changed = valid && n !== days;
  return (
    <Panel
      title="Short-notice jobs go to the office"
      blurb={<>A job that starts soon after its email is left for the office to handle in OnSinch; the bot only plans work further out. A PO is always handled. Only an admin can change this, and every change is logged.</>}
    >
      <Row title="Hand short-notice jobs to the office">
        <Segmented label="Hand short-notice jobs to the office" value={enabled} onChange={onEnabled}
          options={[{ id: false, label: "Off" }, { id: true, label: "On" }]} />
      </Row>
      {enabled && <>
        <Row title="Short notice means" hint={<>The job&apos;s day is this many days or fewer after the email.</>}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input aria-label="Days" inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && changed) onSave(n); }}
              style={{ width: 64, padding: "8px 10px", borderRadius: "var(--radius)", border: `1px solid ${valid ? BORDER : "var(--danger-border)"}`, background: "var(--surface)", color: INK, fontSize: 16, fontFamily: "inherit", fontVariantNumeric: "tabular-nums", textAlign: "right" }} />
            <span style={{ fontSize: 13, color: SUB }}>days</span>
            {changed && <button type="button" onClick={() => onSave(n)}
              style={{ padding: "8px 14px", borderRadius: "var(--radius)", border: "1px solid var(--accent-border)", background: "var(--accent-subtle)", color: INK, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Save</button>}
          </div>
        </Row>
        <Row title="Which jobs" hint="New bookings, changes to bookings that already exist, or both.">
          <Segmented label="Which jobs" value={appliesTo} onChange={onAppliesTo}
            options={[{ id: "creates" as LeadScope, label: "New bookings" }, { id: "changes" as LeadScope, label: "Changes" }, { id: "both" as LeadScope, label: "Both" }]} />
        </Row>
      </>}
    </Panel>
  );
}

/**
 * Clearing is two steps on purpose: what would go is listed first, and only the second press removes it. The rules
 * are lib/testData.ts; this screen only asks for them to run.
 */
function TestDataPanel({ autoclear, onAutoclear }: { autoclear: boolean; onAutoclear: (v: boolean) => void }) {
  const [last, setLast] = useState<Cleared | null>(null);
  const [removed, setRemoved] = useState<Cleared | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"preview" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/test-data").then((r) => r.json()).then((j) => { setLast(j?.last ?? null); setRemoved(j?.removed ?? null); }).catch(() => {});
  }, []);
  async function call(action: "preview" | "clear") {
    setBusy(action); setError(null);
    try {
      const r = await fetch("/api/test-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || String(r.status));
      if (action === "preview") setPlan(j.plan);
      else {
        setLast(j.result); setPlan(null);
        if (j.result.orders.length || j.result.companies.length || total(j.result.rows)) setRemoved(j.result);
      }
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(null); }
  }
  const empty = !!plan && !plan.orders.length && !plan.companies.length && !plan.threads && !total(plan.rows);
  const btn = (tone: "accent" | "danger"): React.CSSProperties => ({ padding: "9px 16px", borderRadius: "var(--radius)", border: `1px solid var(--${tone}-border)`, background: `var(--${tone}-subtle)`, color: tone === "danger" ? "var(--danger)" : INK, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1, whiteSpace: "nowrap" });
  const records = plan ? total(plan.rows) : 0;
  const found = plan && !empty ? [
    plan.orders.length ? `${plan.orders.length} order${plan.orders.length === 1 ? "" : "s"} (${plan.orders.map((o) => `R${o.number}`).join(", ")})` : "",
    plan.companies.length ? `${plan.companies.length} compan${plan.companies.length === 1 ? "y" : "ies"} (${plan.companies.map((c) => c.name).join(", ")})` : "",
    plan.threads ? `${plan.threads} email thread${plan.threads === 1 ? "" : "s"}` : "",
  ].filter(Boolean) : [];
  return (
    <Panel
      title="Test data"
      blurb={<>Removes what tests left in the live system: orders and companies the bot made for test emails or the TEST company, and the records of emails from test addresses. <b style={{ color: SUB }}>Orders staff made, and anything named &quot;do not delete&quot;, are never touched.</b></>}
    >
      <Row title="Clear it every 15 minutes" hint="Off: nothing is removed unless someone presses Check now.">
        <Segmented label="Clear test data every 15 minutes" value={autoclear} onChange={onAutoclear}
          options={[{ id: false, label: "Off" }, { id: true, label: "On" }]} />
      </Row>
      <Row title="Check now" hint={last
        ? <>Last check {when(last.at)}, by {BY[last.trigger] ?? last.trigger}: {last.refused ? `refused (${last.refused})` : removed?.at === last.at ? `removed ${summary(last)}` : "nothing found"}{last.failed?.length ? `, ${last.failed.length} could not be removed` : ""}.{removed && removed.at !== last.at && <> Last removal {when(removed.at)}: {summary(removed)}.</>}</>
        : "Lists what would be removed. Nothing goes until you confirm."}>
        {!plan && <button type="button" disabled={!!busy} onClick={() => call("preview")} style={btn("accent")}>{busy === "preview" ? "Checking…" : "Check now"}</button>}
      </Row>
      {plan && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, color: SUB, lineHeight: 1.55 }}>
          {empty ? <span>No test data found.</span> : <>
            <span><b style={{ color: INK }}>Found {records} record{records === 1 ? "" : "s"}:</b> {found.join("; ")}.</span>
            {plan.over && <Warn>More than one clear may remove ({plan.over}). Nothing will be removed until the rules are looked at.</Warn>}
          </>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!empty && !plan.over && <button type="button" disabled={!!busy} onClick={() => call("clear")} style={btn("danger")}>{busy === "clear" ? "Removing…" : `Remove ${records} record${records === 1 ? "" : "s"}`}</button>}
            <button type="button" disabled={!!busy} onClick={() => setPlan(null)} style={btn("accent")}>{empty ? "Close" : "Cancel"}</button>
          </div>
        </div>
      )}
      {error && <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700 }}>Not done: {error}</span>}
    </Panel>
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
