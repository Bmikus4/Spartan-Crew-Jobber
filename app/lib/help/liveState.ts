import type { Settings } from "../onsinch/types";

/**
 * The switches as they stand, in words, for the help assistant's second system block. Read on every
 * question by /api/help (never sent by the browser), so a paused system is said to be paused and an
 * assistant cannot be told by a page that the bot is writing when it is not.
 *
 * The bot writes only when BOTH switches are on (botWrites, v2/process.ts): Settings' "Bot orders and
 * updates" and the server's SPARTAN_WRITES=live. A Settings row that cannot be read counts as off,
 * as it does for the bot itself.
 */
export function liveState(s: Settings | null, serverLive: boolean): string {
  const settingOn = !!s?.bot_writes_enabled;
  const writes = serverLive && settingOn
    ? "on: the bot creates and updates real clients' orders in OnSinch"
    : `off, so the bot is not changing any real order (${!settingOn ? "Settings, Bot orders and updates, is off" : "the server's own switch is off"}): every email is still read and decided, and what the bot would have written shows on the board as a card to do by hand`;
  const lines = [`- Bot writes in OnSinch: ${writes}`];
  if (s) {
    lines.push(`- Email intake: ${s.intake_paused ? "paused on purpose (Settings, Email intake paused): new emails are not being read, and the board shows Intake Paused" : "on"}`);
    lines.push(`- AI email drafts: ${s.replies_enabled ? `on, ${s.reply_delivery === "send" ? "sent outright" : "left as Gmail drafts for a person to send"}, for ${s.reply_scope === "enquiries" ? "new enquiries only" : "all emails"}` : "off"}`);
    lines.push(`- New orders: ${s.create_lead_enabled === false ? "the bot may create any new booking, however soon" : `the bot creates a new order only when its first day is more than ${s.create_lead_days ?? 14} days after the email`}`);
    lines.push(`- Jobs Board in the menu: ${s.jobs_board_enabled ? "on" : "off"}`);
  } else {
    lines.push("- The other switches could not be read just now: say so if asked about them.");
  }
  return `<live_state>\nThe tool's switches, read moments ago. Answer questions about whether the system is on, paused or writing FROM THIS, never from the guide alone.\n${lines.join("\n")}\n</live_state>`;
}
