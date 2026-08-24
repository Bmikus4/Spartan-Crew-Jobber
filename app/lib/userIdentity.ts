// A person's handle, initials and colour.
//
// Three things the rail and the profile card both have to agree on, so they are derived
// here once rather than in each of them. Nothing here reads the database, which is what
// makes all of it testable.
//
// THE COLOUR IS ASSIGNED BY ARRIVAL ORDER, NOT HASHED. A hash of the email is stable for
// free, and it collides: two people in a five-person company landing on the same hue is
// exactly the thing a colour-per-user exists to prevent. So the index is "how many
// colleagues finished onboarding before you", which cannot collide inside an organisation
// until the palette runs out and deliberately starts again.

export interface DirectoryMember {
  email: string;
  contactEmail: string;
  displayName: string;
  organisation: string;
  handle: string;
  colourIndex: number;
  isSelf?: boolean;
}

/**
 * The wheel people are coloured from. Twelve hues, evenly spread and stepped so
 * neighbours in arrival order are never neighbours on the wheel — the first two people in
 * an organisation are the pair most likely to be seen side by side.
 */
export const USER_HUES = [18, 200, 96, 320, 44, 260, 168, 8, 224, 128, 300, 68];

/** The hue for an arrival index. Cycles, and tolerates a negative or absent index. */
export function userHue(colourIndex: number | null | undefined): number {
  const i = Number.isFinite(colourIndex) ? Math.trunc(colourIndex as number) : 0;
  const n = USER_HUES.length;
  return USER_HUES[((i % n) + n) % n];
}

export interface UserTint {
  /** The avatar disc. Solid enough to read at 22px, where a tint is invisible. */
  bg: string;
  /** Initials on that disc, and the person's own ink. */
  fg: string;
  /** A ring or edge in the same family. */
  border: string;
  /** A whisper of the hue over the themed surface, for a chip's ground. */
  subtle: string;
}

/**
 * A person's colour, MIXED INTO THEME TOKENS rather than stated outright: one markup, two
 * themes, and a fixed value that whispers on the tan ground smears on the near-black one.
 */
export function userTint(colourIndex: number | null | undefined): UserTint {
  const h = userHue(colourIndex);
  return {
    // 62% against the surface, not a flat hsl(): a fully saturated disc is the loudest
    // thing in a rail of grey glyphs, and this is an identity mark, not an alert.
    bg: `color-mix(in srgb, hsl(${h} 62% 48%) 62%, var(--surface))`,
    fg: `color-mix(in srgb, hsl(${h} 72% 45%) 78%, var(--text-primary))`,
    border: `color-mix(in srgb, hsl(${h} 70% 50%) 38%, var(--border))`,
    subtle: `color-mix(in srgb, hsl(${h} 70% 50%) 9%, var(--surface))`,
  };
}

/**
 * The `@name` a person is addressed by.
 *
 * FROM THE EMAIL LOCAL PART, NOT THE DISPLAY NAME. A display name is theirs to edit at any
 * time, and a handle that changes when somebody tidies their capitalisation is not a
 * handle. The local part is unique within a domain by definition, so inside one
 * organisation two colleagues cannot collide.
 *
 * Dots and dashes are stripped rather than kept: `@ben.mikus` would need a reader to decide
 * whether a trailing full stop is part of the handle or the end of the sentence.
 */
export function handleFor(email: string): string {
  const local = (email || "").trim().toLowerCase().split("@")[0] || "";
  return local.replace(/[^a-z0-9]+/g, "");
}

/** Up to two initials, from the name if there is one and the address if there is not. */
export function initialsFor(displayName: string, email: string): string {
  const from = (displayName || "").trim() || (email || "").split("@")[0] || "";
  const words = from.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * What to CALL somebody on screen.
 *
 * A display name can legitimately be empty: suggestedName() refuses to invent one from an
 * address that does not contain one, and a blank line where a person's name goes reads as
 * a bug. The handle is the fallback because it is the one thing everybody has.
 */
export function nameFor(m: Pick<DirectoryMember, "displayName" | "handle">): string {
  return (m.displayName || "").trim() || `@${m.handle}`;
}
