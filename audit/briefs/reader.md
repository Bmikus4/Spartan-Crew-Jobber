AGENT: reader-<X><N>   PHASE: 0   MODE: read-only (dispatch gives X = A or B, N = 1 or 2)

GOAL: Say, for each client email, what it asks Spartan Crew to do, judged only from the email's own
words. Spartan supplies event crew. Clients email to book crew, change a booking, or cancel one. You
are one of two independent readers. The other reader gets the same emails and never sees your file,
and you never see theirs. Your labels will be compared with what the system did, so you must not
know what it did.

INPUTS: .tmp-v2/reads/emails-<N>.json only (200 emails). Each email has: message_id, date_iso (UTC),
subject, newest (the email cut to its own newest part), full_body (with any quoted history, cut at
6,000 characters), attachments, and earlier_in_thread (up to 3 earlier messages, newest parts).
Read `newest` first. Use the rest only to understand what the newest words refer to. A request that
appears only in quoted history, and that the newest words do not repeat or point to, is not asked by
this email.

OUTPUT: eval/reads/<X>-<N>.csv. Put a header row, then exactly one row per email, in file order:
message_id,asks,target_ref,days,crew,sure,note
- asks: one or more of the following, joined with "+":
  - new_booking: wants crew for a job not yet booked;
  - quote_or_availability: asks the price or whether crew are free, for a job;
  - change: change times, numbers, days, venue or roles of an existing booking, or add a shift or position to it;
  - po_only: only supplies or corrects a PO or reference;
  - cancel: cancels all or part of a booking;
  - question: needs an answer but asks for no booking action;
  - nothing: thanks, acknowledgements, a confirmation of what already stands, auto-replies, newsletters,
    invoices and remittances, or anything else that needs nothing from Spartan.
- target_ref: for change, cancel and po_only, write one of:
  - R<number> or J<number>, if the email names it;
  - day, if it names the booking only by its day or days;
  - thread, if it names it only by replying in the thread;
  - unclear, if none of these.
  Otherwise leave it empty.
- days: the ISO dates (YYYY-MM-DD) the request is for, joined with ";". Resolve "Friday", "next week",
  "tomorrow" and the like against the email's date, in London time. Leave it empty when no day is named.
- crew: the total number of crew asked for, if the email states one; otherwise leave it empty.
- sure: "sure" or "unsure". Say "unsure" whenever two readings are reasonable.
- note: at most 15 words, in generic terms, saying what it asks, e.g. "adds 2 crew to the named
  Saturday shift". Write no name, email address, company, venue, street or phone number.

SCOPE: You may read your INPUT file, and write scratch scripts under .tmp-v2/reads/<X><N>/ to help
you page through it, deleting them when you are done. You may NOT read any other file under .tmp-data/
or .tmp-v2/: no decisions, truth, week-review, adjudications, other readers' files, or the system's
code. Reading any of those unblinds the read. You may NOT read .env.local, make any network call,
call any model API, commit, or write any file except OUTPUT and your scratch scripts.

BLOCKED: If an email cannot be read (empty, unreadable or truncated), write asks=nothing,
sure=unsure and note="unreadable", and move on.

VERIFICATION: The orchestrator compares the two readers row by row and re-reads 10% of the
disagreements and 10% of the agreements. Make every row's note specific enough to check.
