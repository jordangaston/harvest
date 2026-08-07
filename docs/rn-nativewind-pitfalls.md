# React Native / NativeWind / Expo — pitfalls to avoid

Hard-won gotchas from Harvest development. Each one cost a debug cycle at least once; encode
them so the next person (or agent) doesn't repeat it. Fuller rationale in
[`harvest-principles.md`](./harvest-principles.md).

## Animation

### JS driver for a fresh-mount entrance
A native-driver (`useNativeDriver: true`) entrance animation on a **just-mounted** view
silently stalls — the value never leaves its start (e.g. opacity stuck at 0, so the element
is invisible). For a mount-in fade/rise, use the **JS driver** (`useNativeDriver: false`).
*(This is why the "Saved" toast was invisible until switched.)*

### Explicit colour inside `Animated.View`
NativeWind's last-wins colour-class resolution does **not** apply inside an `Animated.View`,
so a component's default colour can win over the class you passed (e.g. a `Text` whose
default is `text-ink` renders dark even with `text-cream`). Set the colour with an explicit
inline `style={{ color: … }}`, not only a className. *(This is why the toast pill showed a
check but no text — dark-on-dark.)*

### Prefer `Modal` over hand-rolled sheets
`Modal animationType="slide"` gives a consistent slide-up + scrim fade for free. A hand-rolled
`{open ? <absolute scrim>… : null}` pops in instantly and drifts out of sync with the real
sheets. Use `Modal` for every bottom sheet / menu / dialog.

## Component state

### Reset a reused component instance on open
A component written to mount-per-use will **leak state** when reused as one persistent
instance across items (driven by a `visible` prop instead of mount/unmount). Reset its
internal state in an `useEffect` keyed on open. *(The cookbook picker, reused per carousel
recipe, carried `selected`/`busy` over → a recipe saved to two cookbooks and the button stuck
on "Saving…".)*

### Read-once module signal for stack→tab hand-offs
To pass a one-shot signal across a navigation boundary (a stack screen → an already-mounted
tab), use a tiny read-once module, **not** a route param — route params race timers and don't
reliably reach an already-mounted tab. Reference: `lib/savedToast.ts`. *(The toast's route-param
version raced its own dismiss timer and didn't fire.)*

## Dependencies & environment

### "Installed" ≠ "wired"
A package in `package.json` may not be operational. `react-native-reanimated` was installed
but its worklets babel plugin wasn't in `babel.config.js` — so it would have failed at runtime.
Verify build/runtime wiring before building on a dependency. (Harvest currently animates with
RN's built-in `Animated`; if you adopt reanimated, wire `react-native-worklets/plugin` first.)

### A dead Metro / stale bundle looks like "the fix didn't work"
When changes don't appear, suspect the toolchain before the code: restart Metro (`--clear`)
and reload the app in the simulator. A disconnected dev server serves a stale bundle.

## Verifying UI

### Transient/animated states need video, not screenshots
A sub-3-second toast or a mount animation can't be caught with discrete screenshots (latency
loses it). Record video, extract frames at **native resolution**, and crop — a downscaled
frame also hides thin low-contrast text.
