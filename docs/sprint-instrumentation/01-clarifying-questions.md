# Instrumentation (Mixpanel) — clarifying questions

Each question is a genuine fork the stories leave open. Every one has my single **recommended answer**;
if the founder says nothing, I build the recommendation.

### Q1 — Client-only, or client + server-side?
The stories ("continue past onboarding, click any button, complete any action") are all UI-driven and fully
observable from the Expo client. Server-side Mixpanel would double-count, needs network calls inside the DBOS
pipeline (whose tests never hit the network — real friction), and adds token plumbing to the backend for no
new signal at v1.
**Recommend: client-only (Expo) for v1.** Revisit server-side only if we later need import/parse outcomes the
client can't see (e.g. a background job result).

### Q2 — Mixpanel SDK, or raw HTTP `/track`?
The app is already a native/dev build (it ships `expo-secure-store`, `expo-notifications`, etc.), so the
official `mixpanel-react-native` SDK is viable and gives offline batching, retry, `identify`, super-properties,
and people-properties for free — hand-rolling an HTTP queue is *more* code, not less.
**Recommend: `mixpanel-react-native` SDK.** Fall back to a thin HTTP `/track` wrapper only if the native
prebuild fights the Expo 54 dependency graph.

### Q3 — Event taxonomy / altitude
Proposed compact set from the three chokepoints (see `00-reference-analysis.md`):
- **Auto:** `Onboarding Step Completed` (OnboardingScreen CTA), `Screen Viewed` (expo-router),
  `Button Tapped` (shared Button primitive).
- **Named domain actions** (at `apiFetch` call sites): `Recipe Imported`, `Recipe Saved`,
  `Added to Grocery List`, `Recipe Added to Meal Plan`, `Cookbook Created`, `Signup Completed`,
  `Logged Out`, `Data Deleted`.
**Recommend this set.** Question for the founder: is that the right altitude, or do you want a literal
event on *every* interaction (see Q6)? I recommend compact-and-meaningful over exhaustive.

### Q4 — Naming convention
**Recommend Mixpanel house style: Title-Case `Object Action` event names** (`Recipe Imported`,
`Button Tapped`) **with `snake_case` property keys** (`screen_name`, `recipe_id`, `import_source`). Reads
cleanly in Mixpanel reports/Lexicon. Alternative is all-`snake_case` event names — I don't recommend it.

### Q5 — Super-properties & user-properties
- **Super-properties (every event):** `platform`, `app_version`, `build`, `is_onboarded`, `session_id`.
- **People/user-properties (set at identify):** the onboarding enums already on `users` — `goals`,
  `recipe_sources`, `cook_days`, `when_cook`, `cook_time`, `how_heard`, `age` — plus `username` (`$name`)
  and `signup_at`.
**Recommend attaching the onboarding enums as people-properties** (they're the whole point of segmentation).
Confirm that's acceptable from a privacy standpoint.

### Q6 — "Click any button" — how literal?
The shared `Button` primitive covers nearly every primary CTA from one file. But raw `Pressable`, `OptionRow`,
category chips, checkboxes, radios, and back arrows are *not* `Button`s. Firing on every one is high-volume,
low-signal noise that burns event quota and drowns the funnel.
**Recommend: instrument the shared `Button` primitive + the named domain actions in Q3, NOT every raw
`Pressable`.** Anything meaningful outside the primitive gets an explicit named event. (Native Mixpanel has no
web-style DOM autocapture, so every-tap would be manual wiring anyway.)

### Q7 — Anonymous funnel → identify, and Phone Auth coordination
`userId` is created at the **end** of onboarding (`POST /v1/users`); the pre-signup funnel is anonymous.
**Recommend: track anonymously through onboarding, then `identify(userId)` at signup** so the funnel stitches
to the created user. The parallel **Phone Auth** task changes *when* the user is created, so I'll keep the
identify hook at the signup chokepoint rather than hard-coding today's provisioning moment.
Confirm anonymous pre-signup tracking is acceptable (vs. no tracking before signup).

### Q8 — Mixpanel project & token provisioning (external service)
Instrumentation needs a real Mixpanel project token, stored in `app.json extra` and read via `expo-constants`
(matching how `API_BASE_URL` config works), with a **no-op mode when the token is unset** so the sim/tests
don't spam a real project.
**Recommend:** one shared project for now, token provided by the founder (or I create a project + token via
the Mixpanel MCP and hand it back). Do you want **separate dev/prod projects**, and do you already have a
token I should use?
