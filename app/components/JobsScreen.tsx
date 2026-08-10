"use client";

// Jobs — the tickets-style view of every conversation linked to (or heading
// toward) an OnSinch order. Backed by the tickets table via /api/jobs. Shows
// the thread -> order link, a status lane, and a green check when the engine
// drafted the reply.
//
// The one write action is confirming a STAGED order (status "proposed"), which
// is what draft-only mode exists for. Lanes separate a routine "needs a human"
// from an actual "Failed", so a real OnSinch write failure cannot hide among
// enquiries that are merely missing a company name.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props { isActive: boolean }

interface Job {
  thread_id: string; subject: string; contact: string;
  company_id: number | null; order_id: number | null; order_number: string | null;
  job_id?: number | null;
  classification: string; status: string; priority: string;
  needs_human: boolean; ai_replied: boolean; crew_size: number | null;
  is_client_inquiry?: boolean; gate_reason?: string | null;
  dates: string[]; location: string | null; updated_at: string;
}

const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const FAINT = "var(--text-faint)";
const A = "var(--accent)";
const OK = "var(--ok)";
const BORDER = "var(--border)";
const BORDER_STRONG = "var(--border-strong)";

type Filter = "all" | "proposed" | "needs_human" | "failed" | "booked" | "dismissed";

/**
 * How to name an order in prose: the J number if we have it, else R, else the api id.
 *
 * `#{order_number ?? order_id}` was wrong in a way nobody could see — the same `#`
 * printed a number from either space, so "order #10591" and "order #13682" could be
 * the same order and a human had no way to tell which one to search for.
 */
const idLabel = (j: { job_id?: number | null; order_number?: string | null; order_id?: number | null }) =>
  j.job_id ? `J${j.job_id}` : j.order_number ? `R${j.order_number}` : `api id ${j.order_id}`;

/**
 * A thread the engine judged not to be a client enquiry. These were filtered out
 * of the board entirely, so 45 stored threads showed as 25 rows and there was no
 * way to audit what had been rejected. They are laned here rather than hidden —
 * every other lane, "All" included, excludes them so the working set stays the
 * work.
 */
const isDismissed = (j: Job) =>
  j.classification === "not-a-job" || j.status === "ignored" || j.is_client_inquiry === false;

/**
 * Tag tones, ported from the quote tool's Opportunities screen so the two tools
 * speak one visual language — Ben, 2026-08-10: "look at the house of HUD quote
 * tool's opportunity menu tags, those are how your tags should look".
 *
 * A hue and nothing else. The quote tool pairs each tone with a fill it uses for
 * the SELECTED state, because its tags are filter buttons; these are not clickable,
 * so a fill here would be a colour with no state to mean. Every tone is a palette
 * TOKEN rather than a hex literal — a literal freezes the dark value, and then the
 * light theme cannot darken it (see --warn, which was exactly that).
 */
type TagTone = "neutral" | "accent" | "green" | "amber" | "red";
const TAG_TONES: Record<TagTone, string> = {
  neutral: MUT,
  accent: A,
  green: "var(--ok)",
  amber: "var(--warn)",
  red: "var(--danger)",
};

function badge(j: Job): { label: string; tone: TagTone; title: string } {
  // A real failure is called out separately from a routine needs-a-human. Both
  // used to read "Needs human", so an OnSinch write that actually threw looked
  // identical to "we could not find the company name".
  if (j.status === "error")
    return { label: "Failed", tone: "red", title: "An OnSinch write failed — read the notes" };
  if (j.needs_human || j.status === "needs-info")
    return { label: "Needs human", tone: "amber", title: "The engine needs something only a person can supply" };
  if (j.status === "proposed")
    return { label: "Awaiting confirm", tone: "accent", title: "An order is staged, waiting for a human to approve it" };
  if (j.status === "ordered")
    return { label: "Booked", tone: "green", title: "Written to OnSinch" };
  // Dismissed reads as its own quiet state rather than "Replied", which it never was.
  if (isDismissed(j))
    return { label: "Dismissed", tone: "neutral", title: "Judged not to be a client enquiry" };
  return { label: "Replied", tone: "neutral", title: "A reply went out; no order on this thread" };
}

/**
 * The swatch every tag wears: a small rounded SQUARE, not a circle. Same shape as
 * the quote tool's, so "this is the colour of the thing named next to it" reads as
 * one idea across both tools rather than two conventions that happen to be coloured.
 */
function Swatch({ color }: { color: string }) {
  return <span aria-hidden style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />;
}

/**
 * A small rectangle with a coloured dot, sentence case, quiet text.
 *
 * These were full pills in bold uppercase with a coloured fill, a coloured border
 * AND coloured text, at a fixed 118px — so every status shouted at the same volume
 * as the client name above it. The DOT carries the hue and the text stays in
 * ordinary ink: colour where it is read, not everywhere.
 */
function Tag({ label, tone, title, mono = false }: { label: string; tone: TagTone; title?: string; mono?: boolean }) {
  return (
    <span
      title={title}
      className={mono ? "mono" : undefined}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 500,
        letterSpacing: 0, textTransform: "none", whiteSpace: "nowrap", lineHeight: 1.5,
        background: "transparent", color: SUB, border: `1px solid ${BORDER_STRONG}`,
      }}
    >
      <Swatch color={TAG_TONES[tone]} />
      {label}
    </span>
  );
}

function CheckMark() {
  return (
    <span title="AI reply drafted" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 9999, background: "rgba(52,211,153,0.14)", border: "1px solid rgba(52,211,153,0.4)" }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={OK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
    </span>
  );
}

function JobRow({ j, onSelect }: { j: Job; onSelect: (id: string) => void }) {
  const b = badge(j);
  const dismissed = isDismissed(j);
  // For a dismissed thread the reason IS the information — "not a job" on its own
  // tells you nothing about whether the engine was right to drop it.
  const meta = dismissed
    ? (j.gate_reason || "no reason recorded")
    : [
        j.dates.length ? j.dates.join(", ") : null,
        j.crew_size ? `${j.crew_size} crew` : null,
        j.location,
      ].filter(Boolean).join("  ·  ");
  return (
    <div onClick={() => onSelect(j.thread_id)} style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.contact}</span>
          {j.classification === "update" && <Tag label="Update" tone="neutral" title="A change to a job that already exists" />}
        </div>
        <div style={{ fontSize: 12.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.subject}</div>
        {meta && <div style={{ fontSize: 11.5, color: MUT, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</div>}
      </div>

      {/* The status keeps its own right-hand column so it stays scannable down a long
          list — the tag inside it is now natural-width, where the pill was pinned to
          118px and centred, which is what made it read as a button. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {j.ai_replied && <CheckMark />}
        {/* The identifier is a tag too, in mono and toneless: it names the job rather
            than classifying it, so a coloured dot would imply a status it does not have.
            Prefixed, and the J number preferred — this was a bare "#10591", which reads
            as an id, is not one, and cannot be searched without knowing which of the
            three number spaces it belongs to. */}
        <span className="mono" style={{ fontSize: 11, color: j.job_id || j.order_number ? SUB : FAINT, minWidth: 62, textAlign: "right" }}>
          {j.job_id ? `J${j.job_id}` : j.order_number ? `R${j.order_number}` : j.status === "proposed" ? "staged" : "—"}
        </span>
        <span style={{ display: "flex", justifyContent: "flex-end", minWidth: 116 }}>
          <Tag label={b.label} tone={b.tone} title={b.title} />
        </span>
      </div>
    </div>
  );
}

const PROFESSION_LABEL: Record<number, string> = {
  1: "Crew", 3: "Carpenter", 4: "Telehandler", 9: "Driver", 11: "Forklift",
  16: "AV Tech", 17: "Rough Terrain", 32: "CSCS", 36: "Crew Chief",
};

/**
 * The identifiers a human types into OnSinch's search box: `J<Job.id>` for the job,
 * `R<order.number>` for the order. Neither is the api order id, which is what this
 * screen used to show — pasting 13645 into OnSinch finds nothing, while R10560 and
 * J13925 both find that one job. Verified against a price quote OnSinch generated
 * itself, and clients quote the J number back at us ("PO for Job J13918").
 *
 * Click to copy, because the point of the number is to leave with it. Wears the
 * tag shape with no swatch — it names the job rather than classifying it, and a
 * coloured dot would imply a status it does not carry. The tick on copy is the one
 * moment colour belongs on it.
 */
function IdChip({ prefix, value, title }: { prefix: "J" | "R"; value: string | number; title: string }) {
  const [copied, setCopied] = useState(false);
  const text = `${prefix}${value}`;
  return (
    <button
      title={`${title} — click to copy`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(
          () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
          () => {}
        );
      }}
      className="mono"
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
        padding: "2px 7px", borderRadius: 4, fontSize: 11.5, fontWeight: 500,
        // No fontFamily here: an inline value would beat the .mono class it needs.
        lineHeight: 1.5, whiteSpace: "nowrap",
        background: "transparent",
        color: copied ? "var(--ok)" : prefix === "J" ? INK : SUB,
        border: `1px solid ${copied ? "var(--ok)" : BORDER_STRONG}`,
        transition: "color 160ms, border-color 160ms",
      }}
    >
      {copied ? "Copied" : text}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "16px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: SUB, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 12.5, padding: "3px 0" }}>
      <span style={{ color: MUT, width: 120, flexShrink: 0 }}>{k}</span>
      <span style={{ color: SUB }}>{v}</span>
    </div>
  );
}

// Ticket detail: the AI decision (transparency), the composed draft order, and
// the one action draft-only mode exists for — approving a staged order.
function Detail({ threadId, onBack, onChanged }: { threadId: string; onBack: () => void; onChanged?: () => void }) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(`/api/jobs?id=${encodeURIComponent(threadId)}`);
      const x = await r.json();
      setD(x.ticket || null);
      return true;
    } catch { setErr(true); return false; }
  }, [threadId]);

  useEffect(() => { void load(); }, [load]);

  const confirm = useCallback(async () => {
    setConfirming(true); setConfirmErr(null);
    try {
      const r = await fetch("/api/confirm-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: threadId }),
      });
      const x = await r.json().catch(() => ({}));
      if (r.status === 401) {
        // Writing to OnSinch needs a signed-in human. With AUTH_REQUIRED off
        // nobody is signed in by default, so say what to do instead of just
        // reporting "unauthorized".
        setConfirmErr("you need to be signed in to confirm an order — sign in with Google, or use the ?admin= break-glass link.");
      } else if (!r.ok || !x.ok) {
        setConfirmErr(x.error || `failed (${r.status})`);
      }
      await load();
      onChanged?.();
    } catch (e) {
      setConfirmErr(String((e as Error)?.message ?? e));
    } finally { setConfirming(false); }
  }, [threadId, load, onChanged]);

  const wrap: React.CSSProperties = { height: "100%", overflowY: "auto", padding: "24px clamp(16px, 4vw, 40px) 56px" };
  const back = <button onClick={onBack} style={{ alignSelf: "flex-start", background: "none", border: "none", color: A, cursor: "pointer", fontWeight: 700, fontSize: 13, padding: 0 }}>&larr; Jobs Board</button>;
  if (!d && !err) return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><span className="crm-shimmer" style={{ color: MUT }}>Loading…</span></div>;
  if (err || !d) return <div style={wrap}><div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{back}<p style={{ color: MUT, fontSize: 13 }}>Couldn&apos;t load this ticket.</p></div></div>;

  const b = badge(d);
  const order = d.extracted?.desired_order;
  const teams: any[] = order?.slot_teams ?? [];
  return (
    <div style={wrap}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        {back}
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, margin: 0 }}>{d.contact}</h1>
            <Tag label={b.label} tone={b.tone} title={b.title} />
            {d.ai_replied && <CheckMark />}
          </div>
          <p style={{ fontSize: 13, color: MUT, margin: "4px 0 0" }}>{d.subject}</p>
          {/* Sits in the header, not buried in Details, because "which job is this
              in OnSinch" is the first question asked of an open ticket. */}
          {(d.job_id || d.order_number) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {d.job_id ? <IdChip prefix="J" value={d.job_id} title="OnSinch job number" /> : null}
              {d.order_number ? <IdChip prefix="R" value={d.order_number} title="OnSinch order number" /> : null}
              <span style={{ fontSize: 11.5, color: FAINT }}>search this in OnSinch</span>
            </div>
          )}
        </header>

        <Panel title="AI decision">
          <Row k="Classification" v={d.classification} />
          <Row k="Priority" v={d.priority} />
          <Row k="Client inquiry" v={d.is_client_inquiry ? "yes" : "no"} />
          <Row k="Gate reason" v={d.gate_reason} />
          {!!d.notes?.length && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, color: MUT, marginBottom: 4 }}>Notes</div>
              <ul style={{ margin: 0, paddingLeft: 16, color: SUB, fontSize: 12.5, lineHeight: 1.6 }}>
                {d.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Draft order">
          {order ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {/* Sentence case, not PROVISIONAL/QUOTE: uppercase at bold weight made
                    the posture flags shout louder than the job name. These are the same
                    two OnSinch checkboxes either way. */}
                {order.provisional && <Tag label="Provisional" tone="accent" title="Raised as a draft, not a live booking" />}
                {order.quote && <Tag label="Quote" tone="neutral" title="Sits in Price Quotes rather than To Confirm" />}
                <span className="mono" style={{ fontSize: 11.5, color: MUT }}>rate card #{order.pricelist_category_id}</span>
              </div>
              <Row k="Job" v={order.job_name} />
              <Row k="Summary" v={order.specification} />
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11.5, color: MUT, marginBottom: 6 }}>Slot teams</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {teams.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, background: "var(--surface-2)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 12px" }}>
                      <span style={{ fontWeight: 700, color: INK, width: 90 }}>{PROFESSION_LABEL[t.profession_id] || `prof ${t.profession_id}`}</span>
                      <span className="tnum" style={{ color: SUB, width: 46 }}>×{t.size}</span>
                      <span style={{ color: MUT, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.beginning ? `${t.beginning.slice(0, 16).replace("T", " ")} – ${(t.end || "").slice(11, 16)}` : "date TBC"}
                      </span>
                      <span className="mono" style={{ color: FAINT, fontSize: 11 }}>place {t.place_id || "new"}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* The approval step. Only a STAGED order can be confirmed: once
                  it is written to OnSinch the button is replaced by its number,
                  so a second click can never create a duplicate job. */}
              {d.status === "proposed" ? (
                // A staged item is one of two very different actions, and the
                // button used to read the same for both. With an order already
                // linked, confirming EDITS a real OnSinch order; without one it
                // creates a new draft. The edit path also cannot apply crew or
                // times (nested slot teams have no ids and there is no
                // GET /slotTeams), so it must say so before it is clicked.
                (() => {
                  const isEdit = d.order_id != null;
                  return (
                    <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <button onClick={confirm} disabled={confirming}
                          style={{ padding: "10px 18px", borderRadius: 9, border: "1px solid var(--accent-border)", background: confirming ? "var(--surface-2)" : "var(--accent-subtle)", color: confirming ? MUT : A, fontWeight: 700, fontSize: 13, cursor: confirming ? "default" : "pointer", transition: "all 200ms" }}>
                          {confirming
                            ? "Sending to OnSinch…"
                            : isEdit
                            ? `Update order ${idLabel(d)}`
                            : "Create draft order"}
                        </button>
                        <span style={{ fontSize: 12, color: MUT }}>
                          {isEdit
                            ? "Updates the job summary on the existing order."
                            : "Creates a new provisional draft order in OnSinch."}
                        </span>
                      </div>
                      {isEdit && (
                        <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: SUB }}>
                          Crew numbers and times are <b>not</b> applied automatically on an existing
                          order — OnSinch gives no way to edit its shift blocks. Enter those by hand on
                          order <b>{idLabel(d)}</b>; the slot teams listed above are what
                          this thread asks for.
                        </div>
                      )}
                      {d.needs_human && (
                        <div style={{ fontSize: 12, color: MUT }}>Flagged for a human — read the notes above first.</div>
                      )}
                      {confirmErr && (
                        <div style={{ background: "var(--danger-subtle)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: SUB }}>
                          Couldn&apos;t confirm: {confirmErr}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : d.status === "ordered" ? (
                // "Written to OnSinch" was shown for an edit too, which is the
                // over-claim this pass exists to remove: on an existing order only
                // the summary went, and the notes say what is still by hand.
                <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4, paddingTop: 12, fontSize: 12.5, color: MUT }}>
                  {d.needs_human
                    ? <>Partly applied to OnSinch order <b style={{ color: SUB }}>{idLabel(d)}</b> — the notes above say what is left to do by hand.</>
                    : <>Written to OnSinch{d.order_number || d.job_id ? <> as <b style={{ color: SUB }}>{idLabel(d)}</b></> : null}.</>}
                </div>
              ) : null}
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: MUT, margin: 0 }}>
              {d.status === "error"
                ? <>An order action <b style={{ color: "var(--danger)" }}>failed</b> — see the notes above.</>
                : d.status === "needs-info"
                ? <>No order composed yet: the engine needs something a human has to supply — see the notes above.</>
                : <>No order composed yet — status <b style={{ color: SUB }}>{d.status}</b>.</>}
            </p>
          )}
        </Panel>

        <Panel title="Details">
          <Row k="Company id" v={d.company_id} />
          <Row k="Contact id" v={d.user_id} />
          <Row k="Place id" v={d.place_id} />
          {/* All three, labelled for what they are. The api id is the one the engine
              writes with and the one OnSinch's UI never shows, so it is listed last
              and never on its own — it was previously the only id here, under a
              label ("OnSinch order") that implied it was searchable. */}
          <Row k="Job number" v={d.job_id ? `J${d.job_id}` : null} />
          <Row k="Order number" v={d.order_number ? `R${d.order_number}` : null} />
          <Row k="Order api id" v={d.order_id} />
          <Row k="Dates" v={d.dates?.join(", ")} />
          <Row k="Location" v={d.location} />
          <Row k="Reply" v={d.reply_state} />
        </Panel>
      </div>
    </div>
  );
}

export default function JobsScreen({ isActive }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    setError(false);
    try { const r = await fetch("/api/jobs"); if (!r.ok) throw new Error(); setJobs((await r.json()).jobs); }
    catch { setError(true); setJobs([]); }
  }, []);
  useEffect(() => { if (isActive && !loaded.current) { loaded.current = true; void load(); } }, [isActive, load]);

  const counts = useMemo(() => {
    const j = jobs ?? [];
    // Every count is over the LIVE set, so a tab's number always equals the
    // number of rows that tab shows. Dismissed is the one deliberate exception.
    const live = j.filter((x) => !isDismissed(x));
    return {
      all: live.length,
      proposed: live.filter((x) => x.status === "proposed" && !x.needs_human).length,
      needs_human: live.filter((x) => (x.needs_human || x.status === "needs-info") && x.status !== "error").length,
      failed: live.filter((x) => x.status === "error").length,
      booked: live.filter((x) => x.order_id != null).length,
      dismissed: j.filter(isDismissed).length,
    };
  }, [jobs]);

  const shown = useMemo(() => {
    const j = jobs ?? [];
    const live = j.filter((x) => !isDismissed(x));
    if (filter === "dismissed") return j.filter(isDismissed);
    if (filter === "all") return live;
    if (filter === "proposed") return live.filter((x) => x.status === "proposed" && !x.needs_human);
    if (filter === "needs_human") return live.filter((x) => (x.needs_human || x.status === "needs-info") && x.status !== "error");
    if (filter === "failed") return live.filter((x) => x.status === "error");
    return live.filter((x) => x.order_id != null);
  }, [jobs, filter]);

  const wrap: React.CSSProperties = { height: "100%", overflowY: "auto", padding: "24px clamp(16px, 4vw, 40px) 56px" };
  if (!jobs) return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><span className="crm-shimmer" style={{ color: MUT }}>Loading jobs…</span></div>;
  // onChanged refreshes the list so a confirmed order moves out of the
  // "Awaiting confirm" lane rather than sitting there until a manual reload.
  if (selected) return <Detail threadId={selected} onBack={() => setSelected(null)} onChanged={() => void load()} />;

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${counts.all}` },
    { id: "proposed", label: `Awaiting confirm ${counts.proposed}` },
    { id: "needs_human", label: `Needs human ${counts.needs_human}` },
    // Only shown when something has actually failed — an empty lane would just
    // be noise, but a non-empty one must be impossible to miss.
    ...(counts.failed ? [{ id: "failed" as Filter, label: `Failed ${counts.failed}` }] : []),
    { id: "booked", label: `Booked ${counts.booked}` },
    { id: "dismissed", label: `Dismissed ${counts.dismissed}` },
  ];

  return (
    <div style={wrap}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <header>
          <span className="eyebrow"><span className="slash">/</span>JOBS BOARD</span>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, margin: "4px 0 2px" }}>Jobs Board</h1>
          <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Every conversation linked to an OnSinch order. A green check means the engine drafted the reply.</p>
        </header>

        <div style={{ display: "inline-flex", background: "var(--surface-2)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3, gap: 3, alignSelf: "flex-start", flexWrap: "wrap" }}>
          {tabs.map((t) => {
            const active = filter === t.id;
            return (
              <button key={t.id} onClick={() => setFilter(t.id)}
                style={{ padding: "7px 13px", borderRadius: 8, border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`, background: active ? "var(--accent-subtle)" : "transparent", color: active ? A : SUB, fontWeight: 600, fontSize: 12.5, cursor: "pointer", transition: "all 200ms" }}>
                {t.label}
              </button>
            );
          })}
        </div>

        {error && <div style={{ fontSize: 12.5, color: MUT }}>Couldn&apos;t load jobs. <button onClick={() => void load()} style={{ color: A, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Retry</button></div>}

        {shown.length === 0 ? (
          <div style={{ background: "var(--surface)", border: `1px dashed ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "40px 24px", textAlign: "center", color: MUT, fontSize: 13 }}>
            No jobs yet in this view. They appear as booking emails flow through the engine.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map((j) => <JobRow key={j.thread_id} j={j} onSelect={setSelected} />)}
          </div>
        )}
      </div>
    </div>
  );
}
