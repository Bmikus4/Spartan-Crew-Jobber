export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

// Report an issue, from the help panel. The report goes where Spartan's alarms go (errorReport's
// "help-report" route: the error_reports row is always written, and a deployment emails SamurAI),
// with the help conversation attached so nobody has to describe where they were. There is no
// second store: error_reports is already kept, counted and read.
//
// GUARDED like every write route (test/writeRoutesAuthorised.ts), and the reporter's name comes
// from the session, never from the body.

import { authorizeAction } from "../../../lib/apiAuth";
import { fingerprint, reportError } from "../../../lib/errorReport";
import { trimHistory } from "../../../lib/help/stream";

const MAX_TEXT = 5000;

export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { text?: unknown; messages?: unknown; screen?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return Response.json({ ok: false, error: "a report needs some text" }, { status: 400 });

  const who = caller.name || caller.actor || "unknown";
  const where = "help/report";
  const what = `${who}: ${text.split("\n")[0].slice(0, 120)}`;
  const transcript = trimHistory(body?.messages)
    .map((m) => `${m.role === "user" ? "Them" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  const detail = [
    text,
    "",
    `From: ${who}`,
    `Screen: ${typeof body?.screen === "string" ? body.screen.slice(0, 80) : "-"}`,
    "",
    transcript || "(no help conversation before the report)",
  ].join("\n");

  await reportError({ route: "help-report", where, what, detail });
  return Response.json({ ok: true, ref: fingerprint(where, what) });
}
