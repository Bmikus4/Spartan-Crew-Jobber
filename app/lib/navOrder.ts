"use client";

// THE ORDER OF THE RAIL'S TOOLS, WHICH THE READER CHOOSES BY DRAGGING THEM (Ben, 2026-10-04:
// "just like kairo allow the order of dashboard tools to be re-arranged"). Ported from the
// quote tool's app/lib/navOrder.ts.
//
// THE STORED VALUE IS A LIST OF IDS, NOT A LIST OF ROWS. A saved copy of the rows goes stale
// silently the moment a tool is added or withdrawn. Ids are an instruction applied to whatever
// the app currently has: anything stored but no longer real is dropped, and anything real but
// not stored keeps its natural place, so a new tool still appears for someone who once dragged.
//
// localStorage, not the settings record: it is one person's preference about their own rail,
// nothing else reads it, and it is written from inside a drag where a request cannot wait.

const KEY = "spartan.navOrder.v1";

/** Apply a stored id order to the rows the app actually has. Safe against any stored value. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  for (const id of order) {
    const hit = byId.get(id);
    if (hit) { out.push(hit); byId.delete(id); }
  }
  // Rows never dragged keep their default order, appended: inventing a place for them moves a
  // row nobody asked to move.
  for (const i of items) if (byId.has(i.id)) out.push(i);
  return out;
}

/**
 * Move `dragId` to where `overId` sits. Removing the dragged id first measures the insertion
 * against the list WITHOUT it, which is what makes a downward drag land after the target.
 */
export function reorder(ids: string[], dragId: string, overId: string): string[] {
  if (dragId === overId) return ids;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return ids;
  const next = ids.filter((id) => id !== dragId);
  next.splice(next.indexOf(overId) + (from < to ? 1 : 0), 0, dragId);
  return next;
}

export function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Every element checked: a non-string here would reach a key prop as a row with no identity.
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? parsed : [];
  } catch {
    // Blocked storage throws on READ too. A rail in its default order beats no rail.
    return [];
  }
}

export function writeOrder(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* see readOrder */ }
}
