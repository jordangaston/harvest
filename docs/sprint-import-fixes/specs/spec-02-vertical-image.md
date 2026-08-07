# Spec 02 — Vertical (9:16) recipe images display without cutoff

## Background
Once story 1 supplies YouTube thumbnails, a Short's thumbnail is **9:16 (portrait)**. The recipe
detail hero renders `contentFit="cover"` in a full-width × 300pt box, so a portrait image is
cropped to a middle horizontal band — cutting off the dish. User: "it gets cutoff. I think we want
to zoom in here?"

## Objective
Show any hero image — portrait, square, or landscape — filling the frame attractively, with the
dish visible and nothing awkwardly clipped.

## Acceptance criteria
- AC1: A 9:16 hero fills the hero area without ugly clipping. Approach (decide-and-log): render a
  **blurred cover fill** of the image behind a **contained** copy of the full image, so the whole
  frame is filled (blur backdrop) and the dish is never cut (contained foreground). This reads as
  intentional for any aspect ratio. (Fallback approach if blur is costly: `cover` with the subject
  centered — a straight zoom-to-fill.)
- AC2: Landscape/square heroes still look right (contained sits flush; blur backdrop is unobtrusive).
- AC3: On image load error, the token placeholder (`bg-brand-light` + icon) shows — no white/broken.
- AC4: Uses design tokens only; `expo-image` for remote loading.

## Touches
- `app/recipe/[id].tsx` hero block. Possibly `expo-blur` (already? else use a scaled cover Image as
  the backdrop — no new dep) — prefer the no-dep scaled-cover backdrop.
- Reuse for the multi-recipe carousel (spec 04) previews.

## Test cases
1. Live: import JESPUqVMJpU → open the recipe → the 9:16 thumbnail fills the hero, dish visible,
   no hard clip.
2. Open a website recipe (landscape hero) → still looks correct.
3. Force a bad image_url → placeholder shows.

## Verification
Client change; verify in the simulator with a real YouTube (portrait) and a website (landscape) import.
