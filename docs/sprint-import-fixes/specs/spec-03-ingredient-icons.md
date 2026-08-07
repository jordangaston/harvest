# Spec 03 — Full ingredient icon set + branded Harvest-H fallback; fix salt

## Background
The icon keyword map (`server/src/parse/icons.ts`) and client `ICON` map
(`components/recime/recipes.ts`) cover only ~22 ingredients (a beef-bourguignon / banana-bread
vocabulary). Real recipes (chicken, cheese, cream, soy sauce, chili, lemon, rice…) fall to
`default`, and the client renders a generic Ionicon placeholder that "looks bad." Salt reportedly
renders broken (the file is a valid JPEG, so likely a device-decode edge case or the
`Salt/Pepper`→`pepper` keyword precedence masking it).

Phase-2 decision: generate a **curated ~40** common cooking-ingredient icons + a **Harvest-H**
generic fallback, all matching the existing painterly golden-hour style (1024², warm palette,
oil-paint texture) via nano-banana.

## Objective
Every common ingredient shows a painterly icon; anything unmatched shows the branded Harvest-H icon
(not the ugly generic); the salt icon renders correctly.

## Acceptance criteria
- AC1: Generate ~40 icons for the most common missing ingredients (chicken, beef, pork, fish,
  shrimp, rice, pasta, potato, tomato, cheese/parmesan, cream, milk, sugar, honey, soy sauce,
  vinegar, chili/red-pepper, lemon, lime, ginger, scallion/green-onion, parsley, basil, cilantro,
  mushroom, bell pepper, broccoli, spinach, corn, cumin, paprika, oregano, chicken/veg stock,
  cornstarch, sesame oil, water, mustard, mayo, breadcrumbs, lettuce) into `assets/ingredients/`,
  matching the existing style exactly. Extend `icons.ts` KEYWORDS + the client `ICON` map with these
  keys and sensible keyword regexes (longer/more-specific first).
- AC2: Generate `assets/ingredients/harvest-h.jpg` — the Harvest "H" wordmark letter in the same
  painterly golden-hour style. `resolveIcon` returns it for `default`/unknown keys instead of null;
  `IngredientIcon` uses it as the fallback (drop the Ionicon placeholder for missing icons).
- AC3: The salt icon renders on-device; if `salt.jpg` truly fails to decode, regenerate it in-style.
  Ensure a plain "salt" ingredient shows salt (not masked by `Salt/Pepper`→pepper — acceptable, but
  verify a standalone "salt" line resolves to salt).
- AC4: If nano-banana quota is exhausted mid-set, ship the icons generated so far, point the rest at
  the Harvest-H fallback, and LOG exactly which were skipped.
- AC5: Design-token compliant; icons are the painterly assets, not flat vectors.

## Touches
- `assets/ingredients/*.jpg` (new icons + harvest-h.jpg; regenerate salt if needed).
- `server/src/parse/icons.ts` (KEYWORDS map additions; keep `default` for the true tail).
- `components/recime/recipes.ts` (`ICON` map additions; `resolveIcon` → harvest-h for null/default).
- `app/recipe/[id].tsx` `IngredientIcon` (fallback = harvest-h asset).

## Test cases
1. Import a chicken recipe → chicken/soy/etc. show real icons; any oddball shows the Harvest-H.
2. A recipe with a plain "salt" line → salt icon renders.
3. Server `mapIngredientIcon` unit test: new keywords map to the new keys; unknown → `default`.

## Verification
Generate icons (nano-banana), wire maps, verify in the simulator against a real chicken/TikTok import.
