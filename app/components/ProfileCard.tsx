"use client";

// A person: their disc, and the card that names them.
//
// Both live in one file because they are one design. The colour on the disc in the nav
// rail and the colour on the card it opens have to be the same colour, or the colour has
// told the reader nothing — and the surest way to keep them the same is for them to be the
// same component reading the same tint.

import { userTint, initialsFor, nameFor, type DirectoryMember } from "../lib/userIdentity";

/** The colour disc. Initials, not a photograph: there is no avatar store and no uploader. */
export function Avatar({
  member,
  size = 26,
  title,
}: {
  member: Pick<DirectoryMember, "displayName" | "email" | "colourIndex">;
  size?: number;
  title?: string;
}) {
  const tint = userTint(member.colourIndex);
  return (
    <span
      aria-hidden
      title={title}
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: "50%",
        background: tint.bg,
        border: `1px solid ${tint.border}`,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        // Scaled off the disc rather than fixed, so the same component reads correctly at
        // 26px in the rail and at 40px on the card.
        fontSize: Math.round(size * 0.4), fontWeight: 600, letterSpacing: "0.02em",
        color: "var(--text-primary)",
        userSelect: "none",
      }}
    >
      {initialsFor(member.displayName, member.email)}
    </span>
  );
}

/** The panel: who they are, what to call them, and how to reach them. */
export default function ProfileCard({ member }: { member: DirectoryMember }) {
  const tint = userTint(member.colourIndex);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 240 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Avatar member={member} size={40} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          {/* nameFor, not displayName: somebody who has not finished onboarding has no
              name on record — suggestedName refuses to invent one from an address that
              does not contain one — and a blank line where a person's name goes reads as
              a bug. */}
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>
            {nameFor(member)}
            {member.isSelf && (
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-faint)" }}> · you</span>
            )}
          </span>
          <span className="mono" style={{ fontSize: 12, color: tint.fg }}>@{member.handle}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Row label="Email" value={member.contactEmail} />
        {member.organisation && <Row label="Organisation" value={member.organisation} />}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span className="eyebrow" style={{ fontSize: 10, color: "var(--text-faint)", flexShrink: 0, width: 74 }}>
        {label}
      </span>
      <span style={{ fontSize: 12.5, color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}
