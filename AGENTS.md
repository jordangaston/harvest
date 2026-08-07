# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Harvest Design System

The theme is **vintage golden hour** — warm, sun-faded, painterly. All colours are
defined as tokens in `tailwind.config.js`; use the tokens, never raw hex in screens.

## Surfaces — the white rule (IMPORTANT)

**Never use pure white (`bg-white`) for cards, tiles, list rows, chips, buttons, or
any elevated surface.** Use the warm off-white **`bg-card`** (`#FBF6EC`) instead.

- **Page canvas:** `bg-cream` (`#F1E6D2`) — the honey background (via the `Backdrop`).
- **Cards / tiles / rows / sheets sit *lighter* than the canvas:** `bg-card` (`#FBF6EC`),
  so they lift off the background (light-on-dark depth).
- **Selected tile:** `bg-brand-light` (`#F3E0CC`) with a `border-brand`.
- **Category chips:** the soft golden-hour pastel tints, not white.

### Modals & bottom sheets — use the canvas tone, not near-white
A sheet, menu, or dialog sits on a dim scrim (`bg-black/30`), and against that scrim
the near-white `bg-card` (`#FBF6EC`) reads as **white**. So the "no `bg-white`" rule
extends: **modal/sheet surfaces use `bg-cream`** (`#F1E6D2`, the canvas tone), and their
interactive **rows/tiles use `bg-card`** so they lift off the sheet. (This is why the
save/add-recipe modals looked "white" until the sheet was moved to `bg-cream`.)

### The one exception
Elements that intentionally mimic **native OS UI** stay pure white, because they
render white on the user's real screen — e.g. the iOS notification-permission
dialog mock on the `notifications` screen. This is the only allowed `bg-white`.

## Other conventions
- **Type:** wordmark = **Lora** (`Lora_700Bold`); everything else = **Karla**.
- **Brand/interactive:** amber `bg-brand` (`#A85E2B`); **premium tier:** olive `bg-plus`.
- **Backdrop:** every screen (except the Welcome hero photo) renders `<Backdrop />`
  first — a bottom-to-top golden-hour gradient + film grain, behind all content.
- **Empty-state / celebration art:** painterly oil/gouache golden-hour illustrations
  on transparent PNGs (cream background keyed out) so they blend onto the canvas.
- All colour pairings must meet WCAG 2.1 AA (4.5:1 text, 3:1 UI).

## Motion

Motion is part of the design system, not a garnish. Reference the shared scale in
**`lib/motion.ts`** — never hardcode durations/easing.

- **Every interactive surface animates.** No instant pop-ins. Bottom sheets/menus use
  `Modal animationType="slide"` (native slide + scrim) rather than a hand-rolled
  `{open ? … : null}`, so every sheet opens/closes the same way.
- **Opens are slower than closes** — an open is an invitation, a close gets out of the way
  (e.g. the toast rises in `~350ms`, drops out `~250ms`).
- **Default easing** is smooth-out `cubic-bezier(0.22, 1, 0.36, 1)` (`EASE.smoothOut`).
- **Always honour OS Reduce Motion** (`AccessibilityInfo.isReduceMotionEnabled()` → skip
  the travel/duration).
- **RN gotchas** when animating: use the **JS driver** (`useNativeDriver: false`) for a
  fresh-mount entrance (a native-driven one stalls at opacity 0), and set text colour with
  an **explicit inline `style`** inside an `Animated.View` (NativeWind's last-wins colour
  class doesn't resolve there). See `docs/rn-nativewind-pitfalls.md`.
