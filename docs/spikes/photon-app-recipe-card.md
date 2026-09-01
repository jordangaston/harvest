# Spike: can we send our recipe card as a real interactive Photon "app" card over iMessage?

**VERDICT: works-with-conditions** — the Photon SDK delivers a genuine native iMessage
**app card** (an `MSMessage` with a `MSMessageLiveLayout`), not a plain URL/link preview.
Empirically verified: a real message was sent and landed on this Mac as a native
Messages-extension balloon. The *live, tappable mini-app UI* only draws for a recipient
who has the **Spectrum iMessage app** installed; without it the same bubble degrades to a
static caption/URL preview. To ship a **branded Harvest recipe** card (Harvest name/icon,
our own mini-app) we would host a recipe web page and use `customizedMiniApp(...)` with our
own Apple Team ID + a shipped iMessage extension — a real iOS-native build effort.

## What I sent

- **Builder:** `app(url, { live: true })` from `@spectrum-ts/core` (v12.8.0), sent via
  `space.send(...)` — the exact path `SpectrumSender` already uses.
- **URL:** `https://www.simplyrecipes.com/recipes/homemade_pizza/` (a real public recipe page).
- **From:** the Photon shared line `+14156055508` (`PHOTON_PHONE_NUMBER`, i.e. Chef).
- **To:** this Mac's own number `+15128267702` (the "user"/recipient we can observe).
- **Script:** `server/scripts/spike-app-card.ts` — run `npx tsx scripts/spike-app-card.ts [url]`.

```ts
const im = imessage(await Spectrum({ projectId, projectSecret, providers: [imessage.config()], webhookSecret }));
const space = await im.space.get('any;-;+15128267702');
await space.send(app('https://www.simplyrecipes.com/recipes/homemade_pizza/', { live: true }));
```

### Two gotchas the spike surfaced (both fixed above)

1. **chat guid format.** `space.get()` wants `any;-;<address>` for a DM
   (`any;+;<id>` for a group), *not* the `iMessage;-;…` guid stored in `chat.db`. The SDK
   rejects the wrong shape with a `ValidationError` naming the correct format.
2. **You cannot send to the shared line itself.** Targeting `+14156055508` (the Photon line)
   fails with *"Target is a Photon-managed shared line, not a valid recipient. Send to the
   user's own number."* Chef sends **to the user**; the harness (`ime-turn.sh`) is the
   reverse direction (this Mac → Chef).

## What actually landed on the device

The SDK call returned a `customized-mini-app` content record (Photon internally routes
`app(url,{live})` through `sendCustomizedMiniApp` using its **own** Spectrum extension):

```
appName:            "Spectrum"
appStoreId:         6777616651
extensionBundleId:  codes.photon.Spectrum.MessagesExtension
teamId:             P8XT6232SL
layout:             { caption: "simplyrecipes.com", summary: "simplyrecipes.com" }
live:               true
```

**chat.db evidence** (new row `ROWID 126833`, `is_from_me = 0` — received on this Mac):

| field | value |
|---|---|
| `balloon_bundle_id` | `com.apple.messages.MSMessageExtensionBalloonPlugin:P8XT6232SL:codes.photon.Spectrum.MessagesExtension` |
| `text` | empty (it is a balloon, not a text bubble) |
| `payload_data` | present, 1257 bytes |
| `has_summary` | 1 |

Decoding `payload_data` (printable strings) shows Apple's native app-card structure:

```
MSMessageLiveLayout          ← live app session requested
MSMessageTemplateLayout      ← static fallback layout
sessionIdentifier / liveLayoutInfo / layoutClass
caption / subcaption / image-title / secondary-subcaption / …   ← the visible slots
https://www.simplyrecipes.com/recipes/homemade_pizza/
Spectrum
```

This is exactly the byte structure iMessage produces for an interactive app balloon —
**not** a `richlink`/URL preview (which would carry text + a link-preview payload under a
different bundle id). So at the delivery layer this is unambiguously a real app card.

### Visual confirmation — blocked by a macOS Spaces quirk (logged, not fatal)

I brought Messages frontmost and tried to screenshot the rendered bubble, but the Messages
window sits on its own Mission-Control Space / fullscreen state and would not repaint into
the captured (active) Space — every `screencapture` returned only the desktop wallpaper
(`/tmp/spike-app.png`, `/tmp/spike-app4.png`, `/tmp/spike-fs.png`, `/tmp/spike-app6.png` all
show wallpaper only). Forcing position/size, `AXFullScreen` toggles, and rect-region capture
all hit the same Spaces boundary; the window even reported a collapsed `1710x38` body,
i.e. Messages was in a stuck windowing state this session. Per spike rules I did not force a
blocking GUI action. **The chat.db payload above is the authoritative on-device evidence**;
a human glance at the +1 (415) 605-5508 thread will show the Spectrum app bubble.

## Requirement to make the *live* card render

Per the Photon docs (`/docs/spectrum-ts/content/app`) and the SDK type
(`app()` layout "mirrors Apple's `MSMessageTemplateLayout`… the iMessage provider renders it
natively; other platforms ignore it and fall back to the bare URL"):

- `live: true` is a **rendering hint**. The bubble is delivered natively regardless.
- The **live mini-app UI shows only if the recipient has the Spectrum iMessage app installed**
  (App Store id `6777616651`; installable once, in-line inside Messages on first tap).
- Without it, the recipient sees the **static template layout** (caption + tap-to-open the
  App Store entry / URL). No crash, no missing message — graceful degradation.

So a live card needs, on the recipient side: iMessage on Apple hardware **+ the Spectrum
app installed**. Nothing extra server-side beyond the send we already do.

## What it would take to ship a real **Harvest** recipe card fed by our data

Two tiers:

- **Tier A — reuse Photon's Spectrum app card (cheapest, ships now).**
  Point `app(recipeUrl, { live: true })` at a hosted Harvest recipe web page. Feasible today:
  our recipe fields already exist (`ApiRecipe` in `lib/api/types.ts`: `title`, `image_url`,
  `servings`, `total_minutes`, `ingredients[]`, `steps[]` — the same data `app/recipe/[id].tsx`
  renders). We'd stand up a public `GET /r/:id` HTML page (server-rendered, matching the
  golden-hour card) and the card opens it live inside Messages. **Ceiling:** the bubble is
  branded **"Spectrum"**, not Harvest — appName/icon/caption come from Photon's extension, and
  the caption is auto-derived (here it defaulted to the URL host `simplyrecipes.com`). We do
  not control the caption/image slots through the generic `app()` builder.

- **Tier B — our own branded mini-app (`customizedMiniApp`, real iOS build).**
  `@spectrum-ts/imessage` exports `customizedMiniApp({ appName, appStoreId, extensionBundleId,
  teamId, layout, url, live })`. This lets us set **Harvest**'s name, our layout slots
  (`caption`, `subcaption`, `trailingCaption`, `image`+`imageTitle`, `imageSubtitle`, `summary`)
  and point taps at **our own** iMessage extension. Cost: we must (1) build & App-Store-ship a
  native iOS **iMessage app extension** under our Apple **Team ID** + `extensionBundleId`, whose
  SwiftUI/`MSMessagesAppViewController` draws the recipe from `url`, and (2) host the recipe page.
  That is a genuine native-iOS deliverable (Xcode target, review, distribution) — out of scope
  for a data/backend change but fully supported by the SDK. Note `image` in the layout is a
  raw `Uint8Array` (we'd fetch/encode the recipe hero), and `edit()` can update a card in place.

**Recommendation:** if we just want a rich, tappable recipe bubble now, Tier A via a hosted
`GET /r/:id` page is a small backend job and works with the exact send path we have. Reach for
Tier B only when the "Spectrum"-branded chrome is unacceptable and we're ready to ship an iOS
extension.

## Artifacts / cleanup

- **Script kept:** `server/scripts/spike-app-card.ts` (throwaway; harmless — sends one card to a
  hardcoded number. Delete when done or keep as a manual app-card probe.)
- **Screenshots:** `/tmp/spike-app.png` (+ `-app4/-app6/-fs`) — all wallpaper-only due to the
  Spaces quirk; the real evidence is the chat.db payload above.
- **Nothing committed.** Recipient number `+15128267702` = this Mac; sender = the Photon line.
