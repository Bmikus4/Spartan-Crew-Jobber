export const runtime = "nodejs";
// 300, not 60: one email can now wait on the classifier (25s), the venue judge (30s) and
// two link-judge calls (45s each, linkJudge.ts). The Pro plan allows 300.
export const maxDuration = 300;

// Inbound trigger from n8n. The handler is app/lib/n8nInbound.ts, where its IO can be
// injected for tests: a route file may export only HTTP methods and route config.
import { authorizeMachineCall } from "../../lib/apiAuth";
import { handleInbound } from "../../lib/n8nInbound";

export async function POST(request: Request): Promise<Response> {
  // `if (secret && header !== secret)` meant an absent secret was an absent gate, and
  // this route is in the middleware SKIP list so nothing else stands in front of it. A
  // preview deployment has no secret and the production database, which made every
  // preview URL an unauthenticated way to inject an enquiry. The shared rule refuses an
  // unconfigured caller in a production build and keeps the local-dev allowance the
  // offline harnesses rely on. It stays in this file: test/machineRouteAuth.ts reads each
  // skipped route for it.
  if (!authorizeMachineCall(request).ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handleInbound(request);
}
