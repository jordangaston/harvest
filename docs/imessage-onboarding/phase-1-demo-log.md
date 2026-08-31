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

**Recommended follow-up (not done — founder's call):** a small substrate work item to store the
real Spectrum message id from `space.send()`'s returned `Message` on the outbound row (or a new
`spectrum_guid` column), so `target_message_guid` resolves for the common case. Fits naturally as a
Phase-2 prerequisite or a Phase-4 polish item.

## Net

Both Phase-1 substrate items are verified on a real device. Spikes descoped with evidence. One
honest limitation logged above with a proposed follow-up. Nothing was faked.
