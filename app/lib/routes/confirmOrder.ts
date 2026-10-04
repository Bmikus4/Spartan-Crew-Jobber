// The /api/confirm-order handler after its auth gate, IO injected for tests (SP-50).

import { confirmOrder } from "../engine/pipeline";
import { buildDeps } from "../deps";
import { upsertTicketFromState } from "../ticketsDb";

export interface ConfirmIO {
  buildDeps: typeof buildDeps;
  confirmOrder: typeof confirmOrder;
  upsertTicket: typeof upsertTicketFromState;
}

export const productionConfirmIO: ConfirmIO = { buildDeps, confirmOrder, upsertTicket: upsertTicketFromState };

export async function handleConfirmOrder(request: Request, actor: string | null | undefined, io: ConfirmIO = productionConfirmIO): Promise<Response> {
  let body: { thread_id?: string };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const thread_id = String(body.thread_id ?? "").trim();
  if (!thread_id) return Response.json({ ok: false, error: "thread_id required" }, { status: 400 });

  try {
    const deps = await io.buildDeps();
    const state = await io.confirmOrder(thread_id, deps);
    if (!state) return Response.json({ ok: false, error: "thread not found" }, { status: 404 });
    await io.upsertTicket(state); // reflect the confirm on the tickets board
    return Response.json({
      ok: true, thread_id, status: state.status,
      onsinch_order_id: state.onsinch_order_id ?? null,
      onsinch_order_number: state.onsinch_order_number ?? null,
      onsinch_job_id: state.onsinch_job_id ?? null, // the J number, what a human searches on
      confirmed_by: actor, // who approved it, for the audit trail
      notes: state.notes,
    });
  } catch (err) {
    console.error("[confirm-order] failed", err);
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
