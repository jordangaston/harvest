# WI-3B — Outbound rich link (reasoner-driven)

## Background

Chef should be able to **send a rich link** — a URL that renders as a native preview card on
iMessage — when it decides to share one (e.g. recommending a recipe). Per the founder, this is
**reasoner-driven** (Chef picks a link to share), not an echo of the user's own dropped link, and the
URL must be **grounded in real recipe data** (a recipe's `sourceUrl`), never hallucinated.

### Verified system context

- SDK: `richlink(url: string)` content helper (`@spectrum-ts/core`) — **URL only, no presentation
  options.** "Spectrum carries only the URL; iMessage unfurls it natively." The preview (large image
  vs small vs plain) is determined by the target page's OpenGraph metadata — **there is no
  `summary_large_image` knob.** So how it renders is an **on-device spike**.
- WI-3A added `Sender.sendReply` and the threaded-send pattern. `SpectrumSender` uses
  `this.im.space.get(chatGuid)` then `space.send(...contents)`.
- Response layer: `src/chef/response-agent.ts` renders a `ReplyPlan` → `ChatEvent[]`
  (`src/chef/types.ts` — a discriminated union, `text` today, `tapback` in schema). The consumer
  (`src/imessage/consumer.ts`) currently `if (event.kind !== 'text') continue` and batch-sends text
  bubbles; it captures each sent id via `setExternalId`.
- Recipes carry `recipes.sourceUrl` (`src/schema.ts`); `search_catalog` (`src/chef/tools/`) is an
  existing reasoner tool.

## Objective

Add `Sender.sendLink(chatGuid, url, threadParentId?)`, a `richlink` ChatEvent the consumer dispatches,
and enable the reasoner to share a **grounded** recipe URL as a rich link — plus verify on-device how
iMessage renders it.

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse the SDK `richlink` helper + the Sender/space pattern. No new tables.

1. **`Sender.sendLink(chatGuid: string, url: string, threadParentId?: string): Promise<string[]>`**
   on the interface + `SpectrumSender`: `space.send(richlink(url))`; if `threadParentId` is set,
   thread it (resolve the target like WI-3A and `reply(richlink(url), target)`). Return platform ids.
   Stub records `{ chatGuid, url, threadParentId }`.
2. **ChatEvent + consumer dispatch**: add `{ kind: 'richlink'; url: string }` to the ChatEvent union
   (`src/chef/types.ts`). In the consumer, replace the text-only send with **per-event dispatch**: a
   `text` event → `sender.send`; a `richlink` event → `sender.sendLink`. Persist the richlink outbound
   row (reuse `insertOutbound`; a `[richlink:<url>]` body marker or a lean type is fine — pick the
   lazy option) and capture its `external_id` via `setExternalId`, mirroring the text path.
3. **Reasoner emission + GROUNDED url**: enable the reasoner to emit a `richlink` event sharing a real
   recipe `sourceUrl` when relevant (e.g. the user asks for a recipe idea). **INVESTIGATE** the
   cleanest grounded source: does `search_catalog` return recipes carrying `sourceUrl`? If yes, have
   the reasoner/response layer emit a `richlink` for a found recipe's `sourceUrl`. If no existing tool
   surfaces a shareable `sourceUrl`, add the **smallest** read/tool that returns one. **If making this
   reasoner-driven grounded share requires building a whole recipe-recommendation flow that does not
   exist, STOP and report the scope** — fallback: ship `sendLink` + the `richlink` ChatEvent + a
   controlled test send, and defer the reasoner trigger to a follow-up.
   - Guard against hallucination: only emit a `richlink` for a URL that came from a real recipe row
     (`sourceUrl`), never a model-invented URL.

## Acceptance Criteria

1. Given a `richlink` ChatEvent, when the consumer processes the turn, then it sends the URL via
   `sender.sendLink`, persists the outbound row, and captures its `external_id`.
2. Given `sendLink(chatGuid, url)`, when it runs, then it sends `richlink(url)` and returns the
   platform id; with a `threadParentId`, it threads the link.
3. Given the reasoner decides to share a recipe, when it emits a `richlink`, then the URL is a real
   recipe `sourceUrl` (grounded), not a hallucinated URL.
4. Full suite green (`npx vitest run`, 0 failed); typecheck clean.

## Test Cases

### Test Case 1: consumer dispatches a richlink event (AC1)
**Preconditions:** `file:` DB; a stub chef returning a reply with a `{ kind: 'richlink', url }` event; `StubSpectrumSender`.
**Steps:** drive the consumer for that turn.
**Expected Outcomes:** the stub recorded a `sendLink(url)`; an outbound row persisted with the url; `external_id` set.

### Test Case 2: sendLink sends/threads a rich link (AC2)
**Steps:** `sendLink(chatGuid, url)` and `sendLink(chatGuid, url, 'spc-msg-PARENT')`.
**Expected Outcomes:** stub records the url (and target when threaded); ids returned.

### Test Case 3: reasoner shares a grounded url (AC3)
**Preconditions:** a recipe with a known `sourceUrl` reachable by the reasoner's tool.
**Steps:** exercise the reasoner/response path that emits a share.
**Expected Outcomes:** the emitted `richlink.url` equals the recipe's `sourceUrl` (from data, not invented).

### Test Case 4: suite (AC4)
**Steps:** `npx vitest run`; `npm run typecheck`.
**Expected Outcomes:** green; clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — a Sender method, a ChatEvent kind + consumer dispatch, and a grounded reasoner
emission. No schema change. Restart the dev server on the merged HEAD before the real-iMessage e2e.

## Production Verification

### Production Verification 1: rich-link render spike (REQUIRED)
**Preconditions:** WI-3B merged/deployed; dev server on the merged HEAD; ngrok live; test Mac paired.
**Steps:** Trigger Chef to share a rich link to a recipe page (a page with a good OpenGraph image).
**Expected Outcomes:** On-device, the link renders as a **preview card**. Record the finding: large-image
card, small card, or plain text — and note that the presentation is OG-driven (depends on the target
page's `og:image`), since there is no SDK presentation control. If it renders plain text, document
that as the finding.

### Production Verification 2: reasoner shares a grounded link on-device (REQUIRED)
**Preconditions:** as PV1.
**Steps:** From the test Mac, ask Chef for a recipe idea (a prompt that should make it share a link).
**Expected Outcomes:** Chef sends a rich link whose URL is a real recipe `sourceUrl`, rendering as a
preview on-device. (If the reasoner trigger was descoped per the scope note above, this PV is replaced
by the controlled test send from PV1, with a written note.)

## Production Verification Run

_To be filled during execution._

---

**Dependency:** **WI-3A** (merged) — branch from it. Builds on Phases 1+2 + WI-C on `main`.
