# Instrumentation — reference analysis (CLARIFY gate)

No reference video for this task. Instead this analyzes the **live app** to find the instrumentation
chokepoints: where a small amount of code captures "continue past onboarding," "click any button," and
"complete any action" app-wide, without hand-tagging every screen.

## What exists today

- **No analytics library.** Greenfield — no `mixpanel`, `amplitude`, `posthog`, or event bus anywhere in the
  tree. Nothing to migrate off.
- **Native app, not Expo Go.** Deps already include native modules (`expo-secure-store`, `expo-notifications`,
  `expo-haptics`, `expo-video`), so this already runs as a dev/prebuild — a native Mixpanel SDK is viable.
- **Worktree not installed yet** — `node_modules` and `server/node_modules` are both missing. First sprint
  step is `npm i` (root + `server/`) before anything runs.

## The three chokepoints (why "app-wide without hand-tagging" is achievable)

1. **Buttons — one shared primitive.** `components/ui/index.tsx` exports `Button`/`ButtonText`. Wrapping
   `Button`'s `onPress` (and reading its `ButtonText` child for a label) instruments the *primary* CTA on
   nearly every screen from one file. **Caveat:** many taps do **not** use `Button` — raw `Pressable`,
   `OptionRow`, `Checkbox`, `Radio`, and category chips. "Click any button" only means literally every tap if
   we also wrap `Pressable`. This is the main taxonomy fork (Q6).
2. **Onboarding "continue" — one shell.** 13 of 15 `(onboarding)` screens render `components/recime/
   OnboardingScreen.tsx` and advance via its pinned CTA (`onCta` → `router.push(...)`). Instrumenting
   `onCta` once emits a "continued past onboarding screen" event for the whole funnel; the screen name comes
   free from the expo-router route. (2 non-users: `_layout.tsx` and a custom screen — handle by hand.)
3. **Server actions — one fetch chokepoint.** `lib/api/client.ts` `apiFetch()` is the single path for every
   backend call (recipes, cookbooks, imports, auth). It already knows method + path + status, so
   "completed an action" (recipe imported, saved to cookbook, added to grocery list, meal planned) can be
   derived here or fired explicitly at each call site. Server-side, the DBOS pipeline is the equivalent
   chokepoint for import/parse outcomes.

## Identity

- `session.userId` is the server-provisioned user id (`lib/api/session.ts`), created at the **end of
  onboarding** via `POST /v1/users`. So there is a genuine **anonymous → identified** transition — the funnel
  before signup is anonymous, then we `identify()`/alias to `userId`. The parallel **Phone Auth** Wave-2 task
  moves *when* the real user is created, so the identify hook must not hard-code today's provisioning moment.
- Rich user-properties are available for free: onboarding enums on `users` (`goals`, `recipe_sources`,
  `cook_days`, `when_cook`, `cook_time`, `how_heard`, `age`) — natural Mixpanel people-properties.

## Env / token

- No env pattern exists — `API_BASE_URL` is a hardcoded constant in `lib/api/config.ts`. There is **no**
  `.env`, `app.config.ts extra`, or EAS-env wiring. Mixpanel project-token handling has to introduce one
  (recommend `app.json` → `expo-constants`), so it's a real decision (Q4).

## Where our design should diverge from "just autocapture everything"

- Mixpanel RN SDK has **no DOM-style autocapture** (that's web-only). On native, "instrument every button"
  is *always* explicit wiring — the leverage is wrapping the shared primitives above, not a magic autocapture
  toggle. So the honest scope is: auto-fire from the 3 chokepoints + a short list of high-value explicit
  events, not "every pixel."
- Firing a `button_click` on *every* `Pressable` (toggles, chips, back arrows) produces high-volume,
  low-signal noise and burns Mixpanel event quota. Recommend chokepoint coverage + named actions over
  literal every-tap (Q6).

## Open decisions → see clarifying questions in the worker_done report.
