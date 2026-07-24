# Tracy — rate-card export ask (draft for Ben to send)

**Why:** money on an OnSinch order lives on `Job.pricelist_category_id` (the
"rate card"). If we don't set it explicitly, OnSinch silently assigns a default
(we've seen card **245** get attached this way) — which is exactly the wrong-rate
problem. The engine resolves each client's correct card from their order history,
but a definitive admin export closes the gap for clients with thin or split
history, and gives us the human-readable card **names** (the API only exposes ids).

When the export lands, we load it as `source='ops'` — it outranks the
history-derived seed automatically.

---

## Draft message

> Hi Tracy,
>
> Two quick things to get the booking automation billing clients on the right
> rates:
>
> 1. **Rate-card export.** Could you send an export from the OnSinch admin of
>    each client (company) mapped to their **default pricelist / rate category** —
>    ideally with the category **name** next to its id? A CSV or even a screenshot
>    of the pricelist-categories list (id → name) plus the client→default mapping
>    is perfect. This is what lets us bill each client on their agreed rate every
>    time instead of relying on the system default.
>
> 2. **One question about the default.** When an order is created without a rate
>    category set, OnSinch seems to attach a default one (we've seen category
>    **245**). Is that default **the same for every client (global)**, or is it
>    **set per-client**? Knowing this tells us whether "no explicit card" is safe
>    to ever fall back on, or must always be flagged for a human.
>
> Thanks!
> Ben

---

## What to do with the reply

- **Export received:** save it, then load with a one-off loader that upserts
  each `{company_id, card}` into `rate_cards` with `source='ops'`
  (the `upsertRateCards` guard lets 'ops' overwrite 'history', never the reverse).
  Also capture the **id → name** map into `data/rate-card-names.json` so the
  dashboard/confirm-queue can show card names, not bare ids.
- **Default answer = global:** record it in the API reference; a missing card
  can then be reasoned about consistently. Still never rely on it for billing
  (I1 holds) — the point is diagnostics, not a fallback.
- **Default answer = per-client:** treat any "no explicit card" client strictly
  as needs-human until Tracy supplies their card.
