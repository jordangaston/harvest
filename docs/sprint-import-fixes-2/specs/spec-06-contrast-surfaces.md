# Spec 06 — Fix low-contrast surfaces (WCAG 2.1 AA, golden-hour tokens)

## Story
Three surfaces read as white / low-contrast and fail WCAG AA. Rework with tokens (never `bg-white`),
guided by /practical-ui.

## Root cause + fix (per surface)
### (a) "Edit recipe" button — `app/recipe/[id].tsx:269`
`Button action="light"` = `bg-card` on the `bg-cream` bottom bar → card (#FBF6EC) ≈ canvas (#F1E6D2),
washed out; reads as a faint white bar. **Fix:** make the screen's single primary action a filled
`bg-brand` button (amber, white text) — matches the preview screen's "Save to cookbook" and gives a
clear ~4.5:1 affordance. (Edit is the primary CTA on this screen.)

### (b) Add-recipe FAB modal — `app/(app)/recipes.tsx`
The "Add a cookbook" row is `bg-card` + `border-hairline` sitting ON a `bg-card` sheet → card-on-card,
invisible boundary. **Fix:** lift the sheet to `bg-cream` (canvas) so its `bg-card` rows lift off it,
OR give the secondary row a `bg-sand`/`bg-brand-light` fill with a visible border. Keep the primary
"Import from a link" as `bg-brand`. Ensure the sheet surface contrasts the dim backdrop and its rows
contrast the sheet (≥3:1 UI).

### (c) Save-to-cookbook modal — `components/recime/CookbookPickerSheet.tsx`
Cookbook list rows are transparent on the `bg-card` sheet (no separation), selected state is only a
far-right checkbox. **Fix:** give each row a lifted `bg-cream`/`bg-sand` tile with a border; selected
row = `bg-brand-light` + `border-brand` (the design system's selected-tile pattern). Ensure text
`ink`/`muted` meet 4.5:1.

## Files
- `app/recipe/[id].tsx`, `app/(app)/recipes.tsx`, `components/recime/CookbookPickerSheet.tsx`

## Tests
Contrast checked against token hex values (documented in the postmortem); verified live with
before/after simulator screenshots.

## Acceptance / verify (live)
Each surface visibly lifts off its background and meets AA. Capture before/after screenshots for the
three surfaces. Never `bg-white`.
