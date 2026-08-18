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
  superseded?: Array<{ job_id: number | null; order_number: string | null }>;
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
type TagTone = "neutral" | "accent" | "green" | "amber" | "red" | "blue" | "teal" | "violet";
const TAG_TONES: Record<TagTone, string> = {
  neutral: MUT,
  accent: A,
  green: "var(--ok)",
  amber: "var(--warn)",
  red: "var(--danger)",
  // The identity hues. A J number and an R number are different KINDS of thing, and
  // "new job" and "a change to one" are the distinction an operator scans for first —
  // so each gets a colour that cannot be confused with a status (Ben, 2026-08-10:
  // "all of their tags including all of their numbers, J, R etc. all color coded").
  blue: "var(--viz-blue)",
  teal: "var(--viz-teal)",
  violet: "var(--viz-violet)",
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
        padding: "3px 8px", borderRadius: 4, fontSize: 11.5, fontWeight: 500,
        letterSpacing: 0, textTransform: "none", whiteSpace: "nowrap", lineHeight: 1.5,
        background: "transparent", color: SUB, border: `1px solid ${BORDER_STRONG}`,
      }}
    >
      <Swatch color={TAG_TONES[tone]} />
      {label}
    </span>
  );
}

/**
 * Every tag a row carries, in one order that never changes: what KIND of thread it
 * is, what STATE it is in, then the identifiers a person searches OnSinch with.
 *
 * A fixed order is the point. Scanning a list works when the same question is
 * answered in the same position on every row — so "New" and "Update" occupy one slot
 * whichever it is, and the J number is always the last thing before the reply mark.
 */
function rowTags(j: Job): { label: string; tone: TagTone; title: string; mono?: boolean }[] {
  const tags: { label: string; tone: TagTone; title: string; mono?: boolean }[] = [];

  // KIND. This was shown for an update only, as small grey uppercase text beside the
  // client name — so a new enquiry was identified by the ABSENCE of a marker, which
  // is not something you can scan for.
  if (!isDismissed(j)) {
    tags.push(j.classification === "update"
      ? { label: "Update", tone: "violet", title: "A change to a job that already exists" }
      : { label: "New job", tone: "teal", title: "A first request for crew on this thread" });
  }

  // STATE.
  const b = badge(j);
  tags.push({ label: b.label, tone: b.tone, title: b.title });

  // IDENTITY. Both numbers, both prefixed, both coloured — the J number is what a
  // client quotes back at us and the R number is what the order is called in OnSinch.
  if (j.job_id) tags.push({ label: `J${j.job_id}`, tone: "blue", title: "OnSinch job number — search this", mono: true });
  /**
   * The numbers this job used to have. A client quotes the old one back months later
   * and it exists nowhere in OnSinch, because an amendment cannot be applied in place —
   * the order is deleted and reposted under a new number. Shown rather than merely
   * searchable so whoever opens that email sees the connection without hunting for it.
   */
  for (const old of j.superseded ?? []) {
    if (!old.job_id) continue;
    tags.push({ label: `was J${old.job_id}`, tone: "neutral", title: "superseded by an amendment — the same job under its old number", mono: true });
  }
  if (j.order_number) tags.push({ label: `R${j.order_number}`, tone: "amber", title: "OnSinch order number", mono: true });
  // A staged order has no number yet, and saying so is worth a slot: it is the
  // difference between "not booked" and "booked, number pending".
  if (!j.job_id && !j.order_number && j.status === "proposed") {
    tags.push({ label: "No number yet", tone: "neutral", title: "Staged — OnSinch assigns the number when the order is written" });
  }
  return tags;
}

function CheckMark() {
  return (
    <span title="AI reply drafted" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 9999, background: "rgba(52,211,153,0.14)", border: "1px solid rgba(52,211,153,0.4)" }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={OK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
    </span>
  );
}

/**
 * One thread, as a card.
 *
 * It was a single squeezed line — client, subject, meta on the left and two items in a
 * fixed right-hand column — which left room for exactly ONE tag and one identifier, so
 * everything else about the thread was invisible until you opened it. It is a card
 * with a full tag line now: kind, state, and both OnSinch numbers, every one coloured
 * (Ben, 2026-08-10).
 */
function JobRow({ j, onSelect }: { j: Job; onSelect: (id: string) => void }) {
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
    <div
      onClick={() => onSelect(j.thread_id)}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(j.thread_id); } }}
      style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 9, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: INK, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.contact}</span>
        {/* The reply mark stays right-aligned on its own axis: it is the one thing on
            the card that is about the ENGINE rather than the job. */}
        {j.ai_replied && <span style={{ flexShrink: 0 }}><CheckMark /></span>}
      </div>
      <div style={{ fontSize: 13.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.subject}</div>
      {meta && <div style={{ fontSize: 12, color: MUT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 1 }}>
        {rowTags(j).map((t) => <Tag key={t.label} label={t.label} tone={t.tone} title={t.title} mono={t.mono} />)}
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
 * Click to copy, because the point of the number is to leave with it. It carries the
 * SAME swatch colour the board's rows give it — blue for a J number, amber for an R —
 * so the thing you searched by on the list is the same colour on the ticket.
 */
function IdChip({ prefix, value, title }: { prefix: "J" | "R"; value: string | number; title: string }) {
  const [copied, setCopied] = useState(false);
  const text = `${prefix}${value}`;
  const tone: TagTone = prefix === "J" ? "blue" : "amber";
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
        padding: "3px 8px", borderRadius: 4, fontSize: 12, fontWeight: 500,
        // No fontFamily here: an inline value would beat the .mono class it needs.
        lineHeight: 1.5, whiteSpace: "nowrap",
        background: "transparent",
        color: copied ? "var(--ok)" : INK,
        border: `1px solid ${copied ? "var(--ok)" : BORDER_STRONG}`,
        transition: "color 160ms, border-color 160ms",
      }}
    >
      <Swatch color={copied ? "var(--ok)" : TAG_TONES[tone]} />
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
            {/* Same two tags in the same order as the row you clicked, so the ticket
                confirms what the list told you rather than restating it differently. */}
            {!isDismissed(d) && (d.classification === "update"
              ? <Tag label="Update" tone="violet" title="A change to a job that already exists" />
              : <Tag label="New job" tone="teal" title="A first request for crew on this thread" />)}
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

/** A row-shaped skeleton, so the list does not appear from nowhere and shove the
 *  filter bar down the page. Same geometry as JobRow. */
function RowSkeleton({ i }: { i: number }) {
  return (
    <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, opacity: 1 - i * 0.13 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="skel" style={{ height: 13, width: 150 }} />
        <span className="skel" style={{ height: 11, width: "42%" }} />
        <span className="skel" style={{ height: 10, width: "28%" }} />
      </div>
      <span className="skel" style={{ height: 12, width: 54 }} />
      <span className="skel" style={{ height: 20, width: 104, borderRadius: 4 }} />
    </div>
  );
}

export default function JobsScreen({ isActive }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
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
    const lane =
      filter === "dismissed" ? j.filter(isDismissed)
      : filter === "all" ? live
      : filter === "proposed" ? live.filter((x) => x.status === "proposed" && !x.needs_human)
      : filter === "needs_human" ? live.filter((x) => (x.needs_human || x.status === "needs-info") && x.status !== "error")
      : filter === "failed" ? live.filter((x) => x.status === "error")
      : live.filter((x) => x.order_id != null);

    // Search across everything a person would actually have in hand: the client, the
    // subject line, the venue, and — the reason this exists — the J or R number off a
    // PDF or a forwarded email. Type "J13905" and land on the thread.
    const q = query.trim().toLowerCase();
    if (!q) return lane;
    return lane.filter((x) => {
      const hay = [
        x.contact, x.subject, x.location,
        x.job_id ? `j${x.job_id}` : "",
        x.order_number ? `r${x.order_number}` : "",
        x.order_id ? String(x.order_id) : "",
        x.dates.join(" "),
      ].join(" ").toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [jobs, filter, query]);

  const wrap: React.CSSProperties = { height: "100%", overflowY: "auto", padding: "20px var(--panel-pad-x) 44px" };
  // Loads by drawing itself: the filter bar is real from the first frame (its counts
  // are the only thing waiting on data) and the rows arrive into their own shape.
  if (!jobs) return (
    <div style={wrap}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <header>
          <span className="skel" style={{ height: 24, width: 168 }} />
          <div style={{ marginTop: 8 }}><span className="skel" style={{ height: 12, width: 380 }} /></div>
        </header>
        <span className="skel" style={{ height: 35, width: 420, borderRadius: 10 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2, 3, 4].map((i) => <RowSkeleton key={i} i={i} />)}
        </div>
      </div>
    </div>
  );
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
    // "With an order", not "Booked". This lane selects threads that HAVE an OnSinch
    // order; the tag on a row says what the THREAD's own state is. Both are right and
    // the shared word was not: the lane held 30 rows of which none said "Booked",
    // because most were awaiting a confirm or already replied to. Naming the lane
    // after what it actually filters on removes the contradiction without moving a
    // single row between lanes.
    { id: "booked", label: `With an order ${counts.booked}` },
    { id: "dismissed", label: `Dismissed ${counts.dismissed}` },
  ];

  return (
    <div style={wrap}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <header>
          {/* No eyebrow: the window's title bar carries it. */}
          <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 2px" }}>Jobs Board</h1>
          <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Every conversation the engine has read. A green check means it drafted the reply.</p>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="seg" role="tablist" aria-label="Filter by lane">
            {tabs.map((t) => (
              <button key={t.id} className="seg__btn" role="tab" aria-pressed={filter === t.id} aria-selected={filter === t.id}
                onClick={() => setFilter(t.id)} style={{ padding: "7px 13px", fontSize: 12.5 }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Search by the identifier a person is holding — a J number off a PDF, a
              client name off a phone call. 52 rows is already past what an eye scans. */}
          <div style={{ position: "relative", flex: "1 1 210px", minWidth: 180, maxWidth: 320 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden
              style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUT, pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Client, subject, venue, J number…" aria-label="Search jobs"
              style={{ width: "100%", padding: "8px 30px 8px 32px", borderRadius: 9, border: `1px solid ${BORDER}`, background: "var(--surface-2)", color: INK, fontSize: 12.5, fontFamily: "inherit" }}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search"
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 20, height: 20, borderRadius: 5, border: "none", background: "transparent", color: MUT, cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
            )}
          </div>
        </div>

        {error && <div style={{ fontSize: 12.5, color: MUT }}>Couldn&apos;t load jobs. <button onClick={() => void load()} style={{ color: A, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Retry</button></div>}

        {shown.length === 0 ? (
          <div style={{ background: "var(--surface)", border: `1px dashed ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "40px 24px", textAlign: "center", color: MUT, fontSize: 13 }}>
            {query
              ? <>Nothing matches <b style={{ color: SUB }}>{query}</b> in this lane. <button onClick={() => setQuery("")} style={{ color: A, background: "none", border: "none", cursor: "pointer", fontWeight: 700, font: "inherit" }}>Clear the search</button></>
              : <>No jobs yet in this view. They appear as booking emails flow through the engine.</>}
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
