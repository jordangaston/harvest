# Spec 06 — Video-derived recipes are rich and usable; no steps-less "success"

## Background
- **Too terse:** `extractor.ts SYSTEM_PROMPT` says only "extract a recipe … steps (string[])" with
  no instruction to keep times/temperatures/quantities/doneness cues; `vision.ts` is
  transcription-only. So from an already-thin transcript+OCR, steps collapse to bare imperatives.
  Repro: https://www.tiktok.com/t/ZTAsQgLAx
- **Missing steps:** `hasRecipe` (import-pipeline) accepts a recipe with only title + ≥1 ingredient —
  a `steps:[]` extraction (caption-only, or an LLM that dropped steps) persists as "ready". Repro:
  https://www.tiktok.com/t/ZTAsQb743

## Objective
Video-derived recipes carry real cooking richness, and an import never succeeds with empty steps.

## Acceptance criteria
- AC1: Augment `extractor.ts SYSTEM_PROMPT` to require each step preserve, verbatim from the source,
  exact cook times, temperatures, quantities, pan/heat settings, and visual/textural doneness cues
  ("until the beef is browned and the edges crisp"), and to NOT summarize or merge steps. Broaden
  `vision.ts PROMPT` to also capture on-screen timers, temperatures, and measurements (not just text).
- AC2 (REVISED per pre-mortem): **Gate the escalation, not the persistence.** The e2e suite
  deliberately allows steps-less "link-in-bio" captions, so do NOT globally require `steps>0`.
  Instead: when a caption extraction is steps-less AND a media/video fallback is available for this
  source, escalate to the video (transcribe/OCR) instead of accepting the caption; when the only
  source is a caption/outbound-link (no video), keep the existing title+ingredients bar so
  link-in-bio recipes still persist. This fixes TikTok-video-missing-steps (has a video → escalate)
  without regressing caption-only imports. Repair the caption `catch {}` that silently swallows a
  caption-extract error before the video path.
- AC3: A TikTok video import (ZTAsQb743) returns non-empty, usable steps (or a clean failure if the
  content truly has none) — not a silent ingredients-only recipe.
- AC4: A TikTok video import (ZTAsQgLAx) returns steps with times/temperatures/doneness cues.
- AC5: Existing import integration tests still pass (offline stubs); add a test that a steps-less
  extraction does not persist as ready.

## Touches
- `server/src/parse/extractor.ts` (SYSTEM_PROMPT), `server/src/parse/vision.ts` (PROMPT),
  `server/src/pipeline/import-pipeline.ts` (`hasRecipe` requires steps; caption catch).
- Tests under `server/tests/`.

## Test cases
1. Unit: `hasRecipe` returns false for `steps: []`.
2. Live: import ZTAsQb743 → steps present (or clean failure). Import ZTAsQgLAx → rich steps.

## Verification
Backend change; verify against both real links on the running server.
