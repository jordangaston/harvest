# Phase 1 — Demo log (real iMessage e2e)

All checks were run from the test Mac against the live Chef line (`+14156055508`, shared
iMessage line), with the dev server restarted on the merged HEAD (`c32bd8d`, WI-A + WI-B) and
the ngrok tunnel live. Wire evidence = the raw Spectrum webhook envelope; persistence = the live
Turso `thread_messages` rows; on-device = observed reply/no-reply behavior.

## Spikes (real sends from this Mac)

- **Rich-link receipt** — dropped `youtube.com/watch?v=…`; webhook arrived as
  `content:{ type:"text", text:"https://…" }`; one `text` row, no `richlink`. → descoped, Phase 2
  URL-detects. (Full evidence: `phase-1-findings.md`.)
- **Markdown** — sent `markdown('**bold** _italic_ ~~strike~~\n- a\n- b')`; received text was
  `bold italic strike` + `• a` / `• b` with `attributedBody` carrying no font/bold/strike attrs →
  plain-text fallback, no styling. → descoped. (Evidence: `phase-1-findings.md`.)

## WI-A — inbound tapback (reaction) receipt ✅

**Gesture:** founder added a ❤️ tapback to a prior Chef message.

- **Wire:** `{"type":"reaction","emoji":"❤️","target":"spc-msg-e83bd6c1-7e26-47c5-8cb5-7927741fe2aa",
  "msg":"spc-msg-e83bd6c1-…:reaction:1006818565:0"}` — matches `parseInbound`'s
  `content.emoji` + `content.target.id` exactly.
- **Persisted:** `inbound · type=reaction · reaction_emoji="❤️" ·
  target_message_guid="spc-msg-e83bd6c1-…" · body=""` (21:05:41Z).
- **On-device:** **no reply** was sent in response to the tapback — the only outbound bubbles came
  later, answering the threaded reply. The doorbell-skip chokepoint holds on a real device.

**Result: PASS.** Spectrum delivers a tapback as a `reaction` arm; the substrate represents it
against the correct target and draws no reply.

## WI-B — inbound threaded-reply receipt ✅ (core) / ⚠️ (parent-snippet enrichment)

**Gesture:** founder swipe-replied "Yes - most of the time" to a Chef message.

- **Wire/persisted:** `inbound · type=reply · body="Yes - most of the time" ·
  target_message_guid="spc-msg-8b93ff1b-982…"` (21:05:49Z). The reply's own text was captured
  (the pre-WI-B bug silently dropped it) and the parent guid recorded.
- **On-device:** Chef answered coherently — `"Love that you two cook together most of the time…"` —
  proving the reply text reached reasoning.

**Result: core PASS.** Reply text capture + parent-guid persistence + coherent Chef reply all work
on a real device.

### ⚠️ Finding — parent-snippet briefing enrichment does not resolve for replies to Chef

The reply targeted a **Chef (outbound)** message. Outbound rows are persisted with a **random UUID**
`message_guid` (e.g. `4acd6ab7-…`), not the real Spectrum guid returned by `space.send()`. So
`findByMessageGuid(threadId, "spc-msg-8b93ff1b-…")` found **no** parent row, and the briefing's
`↳ replying to: "<snippet>"` line was **omitted** (graceful — no crash, and Chef still used the
reply text). The WI-B integration test passed because it seeded a parent with a matching guid;
production replies to Chef don't match. This is rooted in an **increment-1** design choice
(outbound Spectrum guid not backfilled), not a WI-B regression.

**Impact:** low. The critical behavior (reply text reaches Chef) works; only the extra
parent-context line is missing, and only for replies to Chef messages (replies to user messages,
which store the real guid, would resolve). The parent snippet is a Phase-4 personality nicety.

### ✅ Resolved by WI-C — persist the outbound Spectrum id as `external_id`

The founder called for the fix directly. **WI-C** (PR #57, merged) adds a nullable
`thread_messages.external_id` holding the platform (Spectrum) message id on **every** row —
inbound set at insert (= `message.id`), outbound captured from `space.send()`'s returned
`Message`(s) — and resolves reply/reaction targets **solely** off `external_id`.

**Verified on the live line (real gestures + real sends):**
- **Outbound id capture:** a fresh Chef turn's bubbles persisted real ids, e.g.
  *"Quick dinner idea: garlic butter shrimp…"* → `external_id = spc-msg-4acaeaed-…` (the stub
  couldn't prove `space.send()` returns real ids; the live line did). Pre-WI-C rows stay `null`
  (forward-only, no backfill).
- **Inbound id capture:** a fresh inbound text → `external_id = spc-msg-57788f9f-…` (= its platform id).
- **Reply-to-Chef resolves (the crux):** founder swipe-replied *"Can you make it dairy free"* to the
  shrimp bubble. The reply's `target = spc-msg-4acaeaed-…` **matched that Chef row's `external_id`**
  and resolved to *"Quick dinner idea: garlic butter shrimp…"*; Chef answered *"Happy to make that
  shrimp dairy-free…"* — the briefing parent-snippet fired. Proves Spectrum's reply-`target` id
  equals the send-returned id, and completes WI-B's parent-snippet for replies-to-Chef.

## Net

Phase 1 (WI-A tapback, WI-B threaded reply) plus the WI-C substrate addendum are **all verified on a
real device**. Both spikes descoped with evidence. The one limitation found during e2e was resolved
by WI-C and re-verified live. Nothing was faked.
