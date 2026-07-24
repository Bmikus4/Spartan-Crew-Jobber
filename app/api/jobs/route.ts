export const runtime = "nodejs";

// Jobs list — the tickets-style view of conversation_state (thread -> order).
// Read-only; degrades gracefully to an empty list without a DB.
import { listJobs, jobsDbEnabled } from "../../lib/jobsDb";

export async function GET(): Promise<Response> {
  const jobs = await listJobs();
  return Response.json({ enabled: jobsDbEnabled(), count: jobs.length, jobs });
}
