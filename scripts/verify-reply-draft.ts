// ============================================================================
// Drive the REAL production executor against the live draft webhook.
// ----------------------------------------------------------------------------
// install-reply-draft-workflow.mjs --test proves the WORKFLOW works. It posts the
// engine's payload shape by hand, so the one link it cannot cover is the code that
// actually does the posting in production: executor().createReplyDraft in deps.ts,
// which is where the "any 200 is success" bug lived.
//
// This calls that exact function. A pass means the whole chain is real — engine ->
// n8n -> Gmail -> a draft id back — and the only thing left between here and
// working replies is Settings.replies_enabled on the dashboard.
//
// It creates ONE draft. Point it at a message bookings@ sent, so the draft is
// addressed internally and no client sees a test.
//
//   npx tsx scripts/verify-reply-draft.ts <gmailMessageId>
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";
import { executor } from "../app/lib/deps";
import { OnsinchClient } from "../app/lib/engine/onsinch";

loadEnv();

async function main() {
  const id = String(process.argv[2] || "").trim();
  if (!id) {
    console.error("usage: npx tsx scripts/verify-reply-draft.ts <gmailMessageId>");
    process.exit(2);
  }
  requireEnv("GMAIL_DRAFT_WEBHOOK");
  requireEnv("N8N_WEBHOOK_SECRET");

  // createReplyDraft touches no OnSinch endpoint; the client is only here to satisfy
  // the signature, and a transport that throws proves it is never reached.
  const exec = executor(
    new OnsinchClient(async () => { throw new Error("OnSinch must not be called to draft a reply"); })
  );

  console.log("posting the engine's own reply action to the live webhook...");
  const result = await exec.createReplyDraft({
    subject: "",
    html: "<p>Connectivity check from the Spartan engine, run by hand. This is a DRAFT and has not been sent. Safe to delete.</p>",
    in_reply_to: id,
  });

  console.log(`createReplyDraft returned: ${result}`);
  if (result === "draft-failed" || result === "return-to-caller") {
    console.error("\nFAILED - see the message above. Nothing was drafted.");
    process.exit(1);
  }
  console.log("\nPASS: engine -> n8n -> Gmail is wired. Flip replies_enabled on the dashboard to use it.");
}

main().catch((err) => { console.error(err); process.exit(1); });
