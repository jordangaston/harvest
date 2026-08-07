# Spec 01 — YouTube imports produce a complete recipe (thumbnail + video-content steps)

## Background
Two root causes (Phase 0 investigation):
- **Thumbnail:** `youtube-fetcher.ts player()` reads `videoDetails.thumbnail`, which the minimal
  InnerTube WEB context usually omits → `thumbnailUrl` undefined → `recipes.imageUrl` null.
- **Video content:** `import-pipeline.ts fromYouTube` returns only caption text (description +
  pinned comment) and never sets `Material.videoUrl`, so the ASR/vision escalation (gated on
  `material.videoUrl`) never runs. For a Short whose caption has ingredients/reheating but whose
  cooking steps are only spoken/on-screen, the caption path returns a steps-thin recipe.

Phase-2 decision: **best-effort YouTube audio → ASR** (ANDROID InnerTube context for an
un-ciphered audio stream), plus the timed-text transcript if present; fall back to
transcript-then-caption and log if stream extraction proves infeasible in this environment.

## Objective
A YouTube/Shorts import returns a recipe with a real thumbnail `image_url` AND cooking
instructions drawn from the video's spoken/on-screen content, not just the caption.

## Acceptance criteria
- AC1: A YouTube import yields `image_url` = `https://i.ytimg.com/vi/{id}/maxresdefault.jpg`
  (fallback `hqdefault.jpg`), deterministically from the video id — never null. Repro:
  https://www.youtube.com/shorts/JESPUqVMJpU
- AC2 (REVISED per pre-mortem): When the caption lacks cooking steps, the import pulls the YouTube
  **`timedtext` transcript** (caption track) and feeds it to the extractor as video content, so the
  spoken cooking method is captured. (WEB `streamingData` stream URLs are signature-ciphered — audio
  download→ASR is a rabbit hole and is NOT attempted this sprint.)
- AC3: If no timed-text transcript exists for the video, fall back to caption-only and LOG the
  audio-stream/no-transcript gap in the post-mortem; the run does not fail and still returns the best
  available recipe + thumbnail.
- AC4: Existing YouTube e2e/integration tests still pass (offline stubs); a unit test covers the
  deterministic thumbnail URL and the "escalate when steps are thin" branch (mock the fetcher/ASR).

## Touches
- `server/src/fetch/youtube-fetcher.ts` (thumbnail URL from id; ANDROID context `player` for
  `streamingData` audio URL + timed-text transcript).
- `server/src/pipeline/import-pipeline.ts` (`fromYouTube` sets `videoUrl`/audio material and/or
  transcript; ensure the media escalation path runs for YouTube).
- Tests under `server/tests/`.

## Test cases
1. Thumbnail: import a YouTube id (stubbed fetch) → recipe.image_url is the derived ytimg URL.
2. Escalation: caption yields ingredients but empty steps → pipeline requests audio/transcript and
   the extractor is fed the video content (assert ASR/transcript path invoked).
3. Live: import JESPUqVMJpU on the running server → recipe has a thumbnail and non-trivial cooking
   steps (or logged fallback).

## Deployment / verification
Backend change; verify against the live link on the running server (imports can take minutes).
