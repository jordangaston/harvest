# Phase 1 — Spike findings (substrate)

Two Phase-1 items were **spikes** (go/no-go before building dependent work). Both were run as
real send/receive probes from the test Mac against the live Chef line (`+14156055508`, shared
iMessage line, cloud/remote Photon provider) and verified in `chat.db` + the raw webhook
envelope. Result: **both descoped**, with the reasons and the evidence below.

---

## Spike 1 — Inbound rich-link receipt → **DESCOPE (arrives as plain text)**

**Question:** does the Spectrum iMessage provider surface a dropped link's rich payload
(url/title/preview-image) to the consumer, so Chef can act on the link?

**Probe:** dropped `https://www.youtube.com/watch?v=dQw4w9WgXcQ` (a URL iMessage rich-previews)
from the test Mac; inspected the **raw webhook body** via the ngrok request inspector and the
persisted `thread_messages` row.

**Finding — the raw envelope carried the link as `text`, with no rich payload:**
```json
"content": { "text": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "type": "text" }
```
Persisted as a single row: `inbound | text | https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
No second `richlink`/`attachment` delivery accompanied it.

The SDK's inbound content union **does** define a `richlink` arm (`{ type: "richlink", url }`),
but our line delivers a user-dropped link as a `text` content arm containing the URL string —
so there is no separate rich-link payload to receive.

**What we did:** descoped the standalone "inbound rich-link receipt" substrate work. **Phase 2
(ingest-on-link-drop) keys off a URL in the inbound `text` body** — simpler, and matches what the
provider actually delivers. No faked `richlink` handling.

---

## Spike 2 — Markdown rendering → **DESCOPE styling (renders as plain text on this line)**

**Question:** does iMessage actually render Spectrum-TS `markdown()` as native rich text
(bold/italic/strike) on-device, or does it show literal `**`/`_`/`~~` characters?

**Probe:** sent `markdown('… **bold-word** and _italic-word_ and ~~strike-word~~\n- bullet-one\n- bullet-two')`
via the live Spectrum sender to the thread; read the **received** message from `chat.db` — both
its plain `text` and its `attributedBody` style blob.

**Finding — syntax stripped, but NO styling applied:**
- Received `text`: `MDSPIKE bold-word and italic-word and strike-word` + `• bullet-one` / `• bullet-two`
  — markdown syntax removed, list markers converted to native `•` bullets.
- `attributedBody` carried **only** `__kIMBaseWritingDirectionAttributeName` and
  `__kIMMessagePartAttributeName` — **no** `NSFont`/bold/italic/`NSStrikethrough` attributes.

So on our **shared** line, `markdown()` degrades to Spectrum's documented plain-text fallback:
readable (no leaked `**` asterisks) but **not visually bold/italic/strike on-device**. The docs'
"iMessage remote mode uses UTF-16 styled text ranges" did not hold for this shared line.

**What we did:** descoped **Phase 4 "format most of Chef's text with Markdown"** as a *styling*
feature — the device does not render it, and the mission forbids shipping a capability the device
did not render.

**Caveats / upgrade path:**
- The fallback is *safe* (no ugly asterisks; `- ` lists do render as `•`). If we ever want plain
  bulleted lists, `markdown()` is safe to use for that alone.
- Styling may render on a **dedicated / Business line** (Spectrum's remote styled-text path). If the
  line is upgraded, re-run this exact probe (check `attributedBody` for `NSFont`/strike attributes)
  before enabling Markdown styling.

---

## Net effect on the program

| Original Phase-1 item | Outcome |
|---|---|
| Inbound rich-link receipt | **Descoped** → Phase 2 URL-detects in `text` body |
| Markdown spike / formatting | **Descoped** (styling) → Phase 4 markdown formatting dropped; note the line caveat |
| Inbound tapback receipt | **Build** (WI, see specs) |
| Inbound threaded-reply receipt | **Build** (WI, see specs) |

Confirmed-supported substrate for the build items (from the SDK type defs, `@spectrum-ts/core/webhook`):
inbound **reaction** = `{ type: "reaction", emoji, target: Message }`; inbound **reply** =
`{ type: "reply", content, target: Message }` (parent guid = `target.id`).
