export const runtime = "nodejs";

// Jobs Board list — reads the first-class tickets table (thread -> order).
// Read-only; degrades gracefully to an empty list without a DB.
import { listTickets, getTicketDetail, ticketsDbEnabled } from "../../lib/ticketsDb";

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const ticket = await getTicketDetail(id);
    if (!ticket) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, ticket });
  }
  const jobs = await listTickets();
  return Response.json({ enabled: ticketsDbEnabled(), count: jobs.length, jobs });
}
