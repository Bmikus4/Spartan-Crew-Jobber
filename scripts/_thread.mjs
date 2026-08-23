// Reconstructs what inbound_raw.payload used to hold: the envelope, with the messages put
// back. Rows captured before the restructure still carry a real payload and are returned
// unchanged, so a script works across both eras without knowing which it is looking at.
//
// This is the seam that let nine ops scripts keep their logic when the storage changed. The
// failure it exists to prevent is the quiet one: inbound_raw.payload still EXISTS after the
// restructure, so a script that was not ported reads null and reports "no enquiries"
// instead of throwing.

/** The thread's messages, in the wire shape the payload carried. */
export async function messagesFor(sql, thread_id) {
  if (!thread_id) return [];
  const rows = await sql`
    SELECT message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
    FROM thread_messages WHERE thread_id = ${thread_id}
    ORDER BY date_iso ASC, first_seen_at ASC`;
  return rows.map((m) => ({
    message_id: m.message_id,
    from: m.from_address,
    to: m.to_addresses ?? [],
    date_iso: m.date_iso,
    subject: m.subject,
    body: m.body ?? "",
    is_from_spartan: m.is_from_spartan,
  }));
}

/**
 * The payload for a row, whichever era it came from.
 *   storedPayload — inbound_raw.payload (null on rows captured after the restructure)
 *   envelope      — inbound_raw.envelope (null on rows captured before it)
 */
export async function payloadFor(sql, thread_id, storedPayload, envelope) {
  if (storedPayload) return storedPayload;        // pre-restructure row, unchanged
  const messages = await messagesFor(sql, thread_id);
  return { ...(envelope ?? {}), thread_id, messages };
}
