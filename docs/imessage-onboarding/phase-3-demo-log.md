# Phase 3 — Demo log (real iMessage e2e: outbound rich links + threaded replies)

Run from the test Mac against the live Chef line, dev server on the merged Phase-3 HEAD, ngrok live.
On-device evidence = the received messages' rows in `chat.db` (thread + rich-link columns).

## WI-3A — outbound threaded reply ✅

**Trigger:** dropped `https://www.halfbakedharvest.com/gochujang-butter-pasta/`; the import completed
and `ImportNotifier` sent the confirmation via `Sender.sendReply(chatGuid, target_external_id, …)`.

**On-device (chat.db):** the confirmation arrived as a **threaded reply** attached to the dropped
link:
```
Saved "Spicy Creamy Gochujang Butter Pasta"…   thread_originator_guid = 8A011C97-C0CF-4A18-A604-…
```
`thread_originator_guid` points at the user's dropped-link message — so Spectrum resolved the stored
platform id (`space.getMessage`) and threaded the reply to the correct message. Chef's ordinary
onboarding replies in the same window were **not** threaded (correct — only the confirmation threads).

**Result: PASS.** "Chef responds to a user's message as a threaded reply," attached to the right
message on-device. The graceful fallback (un-threaded send if the target can't be resolved) is
covered by unit tests.

## WI-3B — outbound rich link ✅ (render spike)

**Scope note:** per the founder, the recipe-**recommendation** feature (a lookup tool + a
`share_recipe` intent + responder rendering + a reason for Chef to recommend) was **descoped**. WI-3B
shipped the rich-link **send capability** only: `Sender.sendLink` + a `richlink` ChatEvent + the
consumer's per-event dispatch. The autonomous "reasoner decides to share" trigger is deferred.

**Spike (controlled, grounded send):** `Sender.sendLink(chatGuid, url)` was called with a **real
recipe `sourceUrl`** read from a `recipes` row (code-fed, not model-invented) — the halfbakedharvest
gochujang page.

**On-device (chat.db `payload_data` = LPLinkMetadata):** iMessage unfurled the URL into a full
**rich-link card**:
```
richLinkMetadataV$class … itemType · imageMetadata · title · summary · icon
twitterCard … summary_large_image … image/png … RichLinkImageAttachmentSubstitute
https://halfbakedharvest.com/gochujang-butter-pasta/
```

**Result: PASS.** The rich link rendered as a card with a **`summary_large_image`** (large-image)
preview + title/image on-device — exactly the mission's "renders with the large-image preview."

### Rich-link render finding

- `richlink(url)` sends **only the URL**; "Spectrum carries only the URL — it does not fetch OG
  metadata." iMessage's native unfurler fetches the target page's OpenGraph/Twitter tags and builds
  the card. **There is no SDK presentation control** (no `summary_large_image` knob) — the card type
  is entirely determined by the target page's metadata.
- A well-tagged recipe page (halfbakedharvest declares `twitter:card = summary_large_image` + a large
  `og:image`) therefore renders as a **large-image card**. A page without a large-image card type /
  `og:image` would render a smaller card or plain text. So "shows as much as possible" is achieved by
  pointing at pages with good OG image tags — which recipe sites reliably have.

## Net

Both Phase-3 send capabilities are verified on a real device: Chef sends a threaded reply that
attaches to the correct message, and a rich link that renders as a large-image preview card. The
rich link's presentation is OG-driven (no SDK knob). The autonomous reasoner-driven recipe share was
descoped by the founder; the `richlink` ChatEvent is in place for any future emitter. Nothing faked.
