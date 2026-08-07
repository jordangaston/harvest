---
tags: [harvest, cleanup, spec]
story: C1
summary: "Hide the Discover tab from the app tab bar with a one-line nav prop; keep the screen file."
source: docs/sprint-cleanup/DESIGN.md (Revision 2), docs/sprint-cleanup/ARCHITECT-REVIEW.md (C1, Verified)
---

# C1 — Hide the Discover tab

## Summary

Hide the **Discover** tab from the bottom tab bar by adding `href: null` to the `discover`
`<Tabs.Screen>` options in `app/(app)/_layout.tsx`. The route stays registered and the screen file
stays intact — only the tab-bar entry disappears. No migration, no server change.

This is the one-line prop the Architect verified (ARCHITECT-REVIEW.md, "Verified": *"C1 is the
one-line `href: null` on the `discover` tab (`app/(app)/_layout.tsx:53`). Correct; keep the screen
file."*).

## Acceptance Criteria

- The Discover tab is **not visible** in the bottom tab bar on the running app.
- The `discover` route is **still registered** (expo-router still knows the route; deep-linking /
  programmatic navigation to it still resolves).
- The screen file `app/(app)/discover.tsx` is **not deleted** and is otherwise unchanged.
- No other tab (`recipes`, `meal-plan`, `groceries`) changes.
- No server, schema, migration, or Zod change.

## Files & functions touched

| Path | Symbol | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | `AppTabsLayout` → the `<Tabs.Screen name="discover">` `options` (lines 53–59) | Add `href: null` to `options`. |

Do **not** touch:
- `app/(app)/discover.tsx` (keep it).
- The other three `<Tabs.Screen>` entries.

## Implementation notes

- In `app/(app)/_layout.tsx`, the `discover` screen currently reads:

  ```tsx
  <Tabs.Screen
    name="discover"
    options={{
      title: "Discover",
      tabBarIcon: ({ color }) => <Ionicons name="compass-outline" size={22} color={color} />,
    }}
  />
  ```

  Add `href: null` to the `options` object. `href: null` is expo-router's documented way to keep a
  route registered while removing it from the tab bar — this is exactly the "keep the screen, drop the
  tab" behaviour the design wants (DESIGN.md C1; ARCHITECT-REVIEW.md "Verified").
- Leave `title` and `tabBarIcon` as-is (harmless; they simply no longer render). No token / colour /
  motion work — nothing visual is added, so the `bg-white` and `lib/motion.ts` bindings are not
  engaged here.

## Test cases

| Acceptance criterion | Verification |
|---|---|
| Discover tab not visible; route still registered; screen file intact | **Visual check only** on a booted iOS simulator — confirm the tab bar shows only Recipes / Meal Plan / Groceries, and that `app/(app)/discover.tsx` still exists. |

No unit or integration test is warranted for a static navigation prop (DESIGN.md Test Coverage: *"C1
hide Discover — nav prop — (visual check only)"*). Do not add one.

## Out of scope / non-goals

- Deleting or editing `app/(app)/discover.tsx`.
- Removing the Discover route from the router or any deep links.
- Any server, schema, migration, Zod, or model change.
- Restyling the tab bar or the remaining tabs.
