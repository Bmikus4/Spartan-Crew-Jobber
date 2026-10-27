// ============================================================================
// What the board shows, as the email-to-board harness compares it (addendum Prompt 13): the card kind a
// coordinator would see, its Gmail label, and the first stage where a decision parts from gold.
// ----------------------------------------------------------------------------
// A check card (the bot wrote; a person checks it) is the same board as its need: in shadow nothing is written,
// so a write shows as the need. A reply card that asks for no crew is not on the board.
// ============================================================================
import type { SystemRow } from "../real/system";

/** What the board should show. */
export type BoardCard = "none" | "needs-created" | "needs-updated" | "reply-with-work";
export type Change = { kind: "new_shift" | "change_times" | "change_crew" | "cancel" | "po"; date?: string; start?: string; end?: string; crew?: number };
export type BoardGold = { card: BoardCard; target: string; change: Change[]; label: string | null; by: string };


export const BOARD_OF: Record<string, BoardCard> = { "needs-created": "needs-created", "created-check": "needs-created", "needs-updated": "needs-updated", "updated-check": "needs-updated", "needs-reply+work": "reply-with-work", "needs-reply": "none" };
export const LABEL_OF: Record<BoardCard, string | null> = { "none": null, "needs-created": "Order Needs Created", "needs-updated": "Order Needs Updated", "reply-with-work": null };

/** The board kind of a TV card (harness/real/system.ts cardOf), or none when there is no card. */
export const boardOf = (card: string | null): BoardCard => BOARD_OF[card ?? ""] ?? "none";

export const STAGES = ["client", "asks", "grounding", "target", "ops", "card kind", "card text", "label"] as const;
export type Stage = (typeof STAGES)[number];

const OP_OF: Record<Change["kind"], string[]> = { new_shift: ["add_shift", "create_order"], change_times: ["set_position_times"], change_crew: ["set_position_size", "add_position", "cancel_position"], cancel: ["cancel_position"], po: ["set_po"] };

/** The first stage where the system's answer parts from board gold, or null when none does. */
export function firstMiss(row: SystemRow & { grounded?: { requests?: any[] } | null }, g: BoardGold, orderCompany: (r: string) => number | null, orderIdOf: (r: string) => number | null): { stage: Stage; why: string } | null {
  const d: any = row.decision;
  const grounded: any[] = row.grounded?.requests ?? [];
  // A board with nothing to do has no order to be about, whatever order the thread names.
  const goldTarget = g.card === "none" ? "NONE" : /^R\d+$/.test(g.target) ? `R${g.target.slice(1)}` : g.target;
  const goldCompany = /^R\d+$/.test(goldTarget) ? orderCompany(goldTarget) : null;
  if (goldCompany && row.company_id !== goldCompany) return { stage: "client", why: `client ${row.company_id ?? "none"}, the order's is ${goldCompany}` };
  const asked = grounded.length > 0 || (d.kind === "handoff" && !/^read together/.test(d.reasons?.[0] ?? ""));
  if ((g.card !== "none") !== asked && !(g.card === "none" && d.kind === "none")) return { stage: "asks", why: g.card === "none" ? "read a request where none is asked" : "read nothing asked" };
  const days = new Set(grounded.flatMap((r: any) => [r.date, r.target?.date]).filter(Boolean));
  const wantDays = [...new Set(g.change.map((c) => c.date).filter(Boolean))];
  if (g.card !== "none" && wantDays.some((x) => !days.has(x)) && d.kind !== "handoff") return { stage: "grounding", why: `days ${[...days].join(",") || "none"}, asked ${wantDays.join(",")}` };
  const target = d.kind === "write" ? (d.ops.some((o: any) => o.op.kind === "create_order") ? "NEW" : `order ${d.ops.find((o: any) => o.op.order_id)?.op.order_id ?? ""}`)
    : d.kind === "handoff" ? (d.order_id ? `order ${d.order_id}` : g.card === "needs-created" ? "NEW" : "unnamed") : (d.found?.length ? `order ${d.found[0]}` : "NONE");
  if (/^R\d+$/.test(goldTarget)) {
    const id = orderIdOf(goldTarget);
    if (target !== `order ${id}` && !(d.kind === "handoff" && !d.order_id)) return { stage: "target", why: `${target}, gold ${goldTarget}` };
  } else if (goldTarget === "NEW" && target.startsWith("order ")) return { stage: "target", why: `${target}, gold a new order` };
  if (d.kind === "write") {
    const kinds = new Set(d.ops.map((o: any) => o.op.kind));
    const missing = g.change.filter((c) => !OP_OF[c.kind].some((k) => kinds.has(k)));
    if (missing.length) return { stage: "ops", why: `writes ${[...kinds].join(",")}, gold asks ${missing.map((c) => c.kind).join(",")}` };
  }
  const card = BOARD_OF[row.card ?? ""] ?? "none";
  // A quote with its shifts is booked To Confirm, as ops book it (Ben 10-13): an order to create answers a
  // reply that carries work, and its label is the order's.
  const want = g.card === "reply-with-work" && card === "needs-created" ? "needs-created" : g.card;
  if (card !== want) return { stage: "card kind", why: `${row.card ?? "no card"}, gold ${g.card}` };
  const label = LABEL_OF[card];
  if (label !== LABEL_OF[want]) return { stage: "label", why: `${label}, gold ${LABEL_OF[want]}` };
  return null;
}

