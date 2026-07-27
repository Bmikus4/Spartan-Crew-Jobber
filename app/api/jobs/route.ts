export const runtime = "nodejs";

// Jobs Board list — reads the first-class tickets table (thread -> order).
// Read-only; degrades gracefully to an empty list without a DB.
import { listTickets, ticketsDbEnabled } from "../../lib/ticketsDb";

export async function GET(): Promise<Response> {
  const jobs = await listTickets();
  return Response.json({ enabled: ticketsDbEnabled(), count: jobs.length, jobs });
}
