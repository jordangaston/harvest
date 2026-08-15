---
tags: [instrumentation], tdd
summary: "Instrumentation (Mixpanel) technical design document"
locked: false
---

# Instrumentation (Mixpanel) — Design

Client-only product analytics for Harvest via `mixpanel-react-native`. One `analytics` facade wraps the SDK,
three chokepoints emit auto events (Onboarding Step Completed, Screen Viewed, Button Tapped), a short list of
named domain actions fire from the flows that own them, and the facade is a **no-op until a project token is
configured** so the sim, dev builds, and tests never send data. Built to founder decision #5.

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Scope

**In:** an `analytics` module (typed facade over the SDK + a no-op fallback); super-properties; anonymous →
`identify()` at signup with onboarding enums as people-properties; the 3 auto events; the named domain actions
whose call sites live on `main` today (Recipe Imported, Recipe Saved, Cookbook Created, Signup Completed); a
typed `track()` helper + event contract that sibling Wave-2 tasks call for the actions they own; a config
shape + a founder one-pager for the prod token.

**Out:** any server-side Mixpanel (decision #5 is client-only); new screens or schema (this feature has
neither); session replay / A-B / feature flags; instrumenting every raw `Pressable` (decision #5 caps
button capture at the shared `Button` primitive).

---

# Use Case Implementations

## UCI-1 — App launch & analytics init — Implements "every session is measured"

~~~mermaid
sequenceDiagram
    participant RootLayout as app/_layout.tsx
    participant A as analytics facade
    participant C as expo-constants
    participant MP as Mixpanel SDK

    rect rgb(240, 248, 255)
    note over RootLayout,A: on mount, once
    RootLayout->>A: analytics.init()
    A->>C: read extra.mixpanelToken
    alt token present
        A->>MP: new Mixpanel(token); init()
        A->>MP: registerSuperProperties(platform, app_version, build)
        note over A: real backend active
    else token unset (dev / sim / tests)
        note over A: bind no-op backend — send nothing
    end
    end
~~~

## UCI-2 — Anonymous → identify at signup — Implements decision #5 (identify at signup) + consumes Phone Auth create-user

~~~mermaid
sequenceDiagram
    participant Signup as create-user wiring (lib/api/auth.ts, Phone Auth owns)
    participant Server as Harvest API
    participant A as analytics facade
    participant MP as Mixpanel SDK

    note over Signup: user tapped through onboarding anonymously;<br/>Mixpanel distinct_id is the device id so far
    Signup->>Server: POST /v1/users { phone, onboarding }
    Server-->>Signup: { user.id, tokens }
    rect rgb(255, 248, 240)
    note over Signup,A: hook fires BEFORE resetOnboarding() drains the payload
    Signup->>A: analytics.onSignup(userId, onboardingPayload)
    A->>MP: identify(userId)
    A->>MP: people.set(goals, recipe_sources, cook_days, when_cook, cook_time, how_heard, age, signup_at)
    A->>MP: track("Signup Completed")
    end
~~~

## UCI-3 — Button Tapped (auto) — Implements decision #5 auto event

~~~mermaid
sequenceDiagram
    participant User
    participant Btn as Button primitive (components/ui)
    participant A as analytics facade
    User->>Btn: press
    Btn->>A: track("Button Tapped", { label, screen })
    note over A: fire-and-forget — never awaited, never blocks the press handler or its animation
    Btn->>Btn: call the caller's onPress (unchanged)
~~~

Onboarding Step Completed (wrap `OnboardingScreen.onCta`) and Screen Viewed (a `usePathname()` effect under the
root Stack) follow the same fire-and-forget shape and are not redrawn here.

## UCI-4 — Named domain action via the track() contract — Implements the ~8 named actions

~~~mermaid
sequenceDiagram
    participant Screen as owning flow (import / cookbook / meal-plan / grocery / profile)
    participant Api as lib/api/*
    participant A as analytics facade
    Screen->>Api: perform action (import, save, add to list, ...)
    Api-->>Screen: success
    Screen->>A: track("<Object Action>", { ...props })
    note over Screen,A: fired on SUCCESS only. Call sites on `main` are wired by this task;<br/>call sites owned by sibling Wave-2 tasks are wired by those Leads against this contract.
~~~

---

# Entities

Instrumentation persists nothing. The "entities" are the analytics vocabulary — an event, plus the two
property scopes the SDK maintains.

~~~mermaid
classDiagram
    class Event {
        +string name
        +Props properties
    }
    class SuperProperties {
        +string platform
        +string app_version
        +string build
    }
    class PeopleProperties {
        +string[] goals
        +string[] recipe_sources
        +string[] cook_days
        +string when_cook
        +string cook_time
        +string how_heard
        +string age
        +string signup_at
    }
    Event "*" --> "1" SuperProperties : merged onto every event
    PeopleProperties --> Event : set once at identify()
~~~

## Event catalog

| Event | Type | Fires from | Key props |
|---|---|---|---|
| `Onboarding Step Completed` | auto | `OnboardingScreen.onCta` | `step` (route name), `step_index` |
| `Screen Viewed` | auto | `usePathname()` effect at root | `screen` (route) |
| `Button Tapped` | auto | `Button` primitive | `label`, `screen` |
| `Recipe Imported` | domain (mine) | import success (`lib/api/imports.ts`) | `source`, `recipe_id` |
| `Recipe Saved` | domain (mine) | save→cookbook (`lib/api/cookbooks.ts`) | `recipe_id`, `cookbook_id` |
| `Cookbook Created` | domain (mine) | create cookbook | `cookbook_id` |
| `Signup Completed` | domain (mine) | `analytics.onSignup` | — (identify happens here) |
| `Recipe Added to Meal Plan` | domain (**Meal Planning** wires) | add-to-plan success | `recipe_id`, `meal`, `date` |
| `Added to Grocery List` | domain (**Grocery** wires) | add-items success | `item_count`, `source_recipe_id?` |
| `Logged Out` | domain (**Profile** wires) | logout | — |
| `Data Deleted` | domain (**Profile** wires) | account delete | — |

Names are Title-Case `Object Action`; property keys are `snake_case` (decision #5).

---

# Tables

**None.** Instrumentation is client-only (decision #5) — no new tables, no column changes, no `grocery_aisle`-style
enum. This task ships **no migration**. All state lives in the Mixpanel SDK (its own on-device queue) and the
existing onboarding accumulator.

---

# Modules

~~~mermaid
classDiagram
    class Analytics {
        <<interface>>
        +init() void
        +track(name, props?) void
        +onSignup(userId, onboarding) void
        +identify(userId) void
        +reset() void
    }
    class MixpanelBackend {
        +init() void
        +track(name, props?) void
        +onSignup(userId, onboarding) void
    }
    class NoopBackend {
        +init() void
        +track(name, props?) void
        +onSignup(userId, onboarding) void
    }
    Analytics <|.. MixpanelBackend
    Analytics <|.. NoopBackend
    RootLayout --> Analytics : init()
    ButtonPrimitive --> Analytics : track()
    OnboardingScreen --> Analytics : track()
    AuthModule --> Analytics : onSignup()
~~~

~~~mermaid
flowchart LR
    Const[expo-constants extra.mixpanelToken] -->|string or undefined| Fac[analytics facade]
    Fac -->|token set| MP[MixpanelBackend -> SDK on-device queue]
    Fac -->|token unset| Noop[NoopBackend -> discard]
    Onb[onboarding accumulator] -->|enum payload| Fac
~~~

- **`lib/analytics/index.ts`** — the facade. Chooses `MixpanelBackend` or `NoopBackend` at `init()` by whether
  `Constants.expoConfig.extra.mixpanelToken` is truthy. Every method is safe to call before `init()` (buffers
  a no-op). `track()` is synchronous fire-and-forget — it never returns a promise a caller could `await`, so it
  can't stall a press handler or an animation.
- **`lib/analytics/people.ts`** — pure mapper from the onboarding `Payload` (already `snake_case` enums, see
  `lib/onboarding.ts`) to the people-properties object. Pure and unit-testable with no SDK.
- **Backend selection is the no-op guarantee.** In dev/sim/tests the token is unset, so `NoopBackend` binds and
  nothing is sent (decision #5). No `if (__DEV__)` scattered at call sites.

---

# APIs

**No new HTTP endpoints.** The client talks to Mixpanel through the SDK, not our API. Two existing interfaces
are relevant:

- **Consumed — Mixpanel ingestion** via `mixpanel-react-native` (`track`, `identify`, `people.set`,
  `registerSuperProperties`). Read the installed SDK's own docs at build time; do not hand-roll HTTP.
- **Consumed — create-user (Phone Auth owns).** The `onSignup(userId, onboarding)` hook attaches at the point
  `lib/api/auth.ts` obtains a fresh `userId` from `POST /v1/users`, **before** `resetOnboarding()` drains the
  accumulator. Phone Auth is moving *when* the user is created; the hook rides along at that moment rather than
  hard-coding today's `provisionUser()`. Coordinate one line with the Phone Auth Lead at integration.

---

# Cross-task interfaces

**I own:** the `analytics` facade, its config shape, the 3 auto events, and the domain actions whose call sites
exist on `main` (Recipe Imported, Recipe Saved, Cookbook Created, Signup Completed).

**I provide, siblings consume:** a typed `track(name, props)` helper + the event contract in the catalog above.
Meal Planning, Grocery, and Profile each add **one** `track(...)` line at their own new success call site
(`Recipe Added to Meal Plan`, `Added to Grocery List`, `Logged Out`, `Data Deleted`). Wiring at the source
avoids editing files those Leads own in parallel — no collisions. If a sibling ships before this facade lands,
its `track()` line references a not-yet-merged import; the coordinator reconciles at integration order (same as
the migration-number reconciliation in decision-doc #Coordination).

**I consume:** Phone Auth's create-user moment (the `onSignup` hook) and its `users.name` (address-by-name is
Profile's concern, not an event; `name` is not sent as a people-property unless the founder wants `$name` set —
see Q-04).

---

# Mobile screens / flows

Instrumentation adds **no screens and no UI surface**, so the design-system rules (no `bg-white`, `bg-cream`
sheets, Lora/Karla, motion tokens) have nothing to style here. The one rule that binds is **motion
non-interference**: event emission is fire-and-forget and never wrapped around an `await`, so no press
animation, sheet slide, or toast timing (`lib/motion.ts`) is delayed by a track call. The auto-event wrappers
call the caller's original `onPress`/`onCta` unchanged.

---

# Testing

All tests run offline. The facade is a no-op without a token, and unit tests inject a fake backend — **the real
SDK and the network are never touched** (`server/CLAUDE.md`: tests never hit the network).

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| UCI-1 init / no-op selection | Op | x | | |
| UCI-2 onSignup identify + people-props | Flow | x | | |
| UCI-3 Button Tapped wrapper | Op | x | | |
| UCI-4 track() contract | Op | x | | |

## Test Approach

- **Unit — people mapper:** feed a sample onboarding `Payload`, assert the people-properties object (keys +
  values) — a pure function, no SDK.
- **Unit — no-op guarantee:** with the token unset, assert the facade binds `NoopBackend` and that `track` /
  `onSignup` make **zero** calls to any injected SDK spy. This is the decision-#5 safety test.
- **Unit — facade dispatch:** with a fake backend injected, assert `track("Button Tapped", …)` and
  `onSignup(id, payload)` forward the right event name, props, and identify/people calls in order.
- **Unit — auto-event wrappers:** assert the `Button` wrapper calls the caller's `onPress` exactly once
  whether or not analytics is active (no behavior change), and emits `Button Tapped` with a `label`.

## Test Infrastructure

A tiny in-memory fake backend (records `{name, props}` calls) injected via the facade's backend seam. No
factories, stub servers, or fixtures beyond one sample onboarding payload.

---

# Deployment

## Migrations

**None** — client-only, no schema.

## Deploy / config sequence

1. Ship the facade with **no token** → it is a no-op in every environment; zero risk, nothing sent.
2. Founder creates a Mixpanel project and sets the prod token (see the one-pager, Appendix B).
3. On the next build with the token present, `MixpanelBackend` activates. No code change to turn it on.

## Rollback Plan

Unset the token (or ship the build without it) → the facade reverts to no-op and stops sending. No data
migration to unwind; the SDK's local queue drains or is discarded.

---

# Monitoring

The events **are** the monitoring — this feature's output is the Mixpanel dashboard, not server metrics.

- **Onboarding funnel:** `Onboarding Step Completed` by `step` → step-to-step drop-off.
- **Activation:** `Recipe Imported`, `Recipe Saved` per identified user.
- **Signup conversion:** anonymous `Screen Viewed` → `Signup Completed`.

No new server metrics, alerts, or structured logs — nothing runs server-side. A founder-built Mixpanel
dashboard (funnel + activation) is the deliverable surface; building it is post-token and out of this task's
code scope.

---

# Decisions

## D-1 — Mixpanel SDK, not raw HTTP `/track`

**Framework:** Direct criterion — least code that keeps batching/retry/identify.
**Choice:** `mixpanel-react-native` (decision #5, founder-approved). The app is already a native/dev build, so
the SDK installs cleanly and gives offline queueing, retry, `identify`, super-properties, and people-properties
for free; a hand-rolled HTTP queue would be *more* code for the same result.
### Alternatives Considered
- **Raw HTTP `/track`:** rejected — re-implements the SDK's queue/retry by hand for no gain.

## D-2 — No-op facade keyed on token presence

**Framework:** Direct criterion — one seam beats scattered `__DEV__` guards.
**Choice:** the facade picks `NoopBackend` when `extra.mixpanelToken` is unset, so dev/sim/tests send nothing
(decision #5) without any call-site conditionals. One place to reason about "are we live?".

## D-3 — Auto events at three shared chokepoints, not per-screen tags

**Choice:** wrap the `Button` primitive, `OnboardingScreen.onCta`, and a root `usePathname()` effect. Three
edits cover most of the app; capping button capture at the primitive (not raw `Pressable`) is decision #5 and
keeps event volume/quota sane.

## D-4 — Domain actions wired at the source, split by task ownership

**Choice:** each named action fires from the flow that owns its success path; siblings add one `track()` line
against the published contract rather than this task editing their files. Avoids parallel-worktree collisions;
matches how the decision doc handles other shared surfaces.

## D-5 — identify() inside the create-user path, before the accumulator is drained

**Choice:** hook `onSignup` where `userId` and the onboarding payload coexist (before `resetOnboarding()`), so
people-properties are set in the same step as `identify()` with no extra server round-trip.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | `Button Tapped` label source: read a string `children`/`ButtonText` child, or require an optional `trackLabel` prop with `accessibilityLabel` fallback? | open | Lean: derive from string children, fall back to `accessibilityLabel`; skip the event if neither resolves (no `"[object Object]"` labels). |
| Q-02 | `Screen Viewed` from `usePathname()` effect vs an expo-router navigation listener — which fires once-per-view without duplicates on re-render? | open | Lean: `usePathname()` in a root child, dedupe on changed path. Confirm against expo-router v6 at build. |
| Q-03 | Do sibling Leads add their `track()` line **this wave**, or does a follow-up pass wire the 4 sibling actions after all Wave-2 merges? | open | Lean: follow-up pass by this task post-merge, so no sibling depends on an unmerged import mid-wave. |
| Q-04 | Set the user's real `name` as Mixpanel `$name` (aids Mixpanel UX, but stores PII), or keep the profile name-free? | open | Lean: do **not** set `$name`; keep people-properties to the non-PII onboarding enums. Founder call. |
| Q-05 | `app_version` / `build` source — `expo-constants` `nativeAppVersion`/`nativeBuildVersion`, or `expoConfig.version`? | open | Lean: `expo-constants` native fields; fall back to `expoConfig.version`. |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-07 | Instrumentation Lead | Initial draft, built to WAVE2-DECISIONS.md #5 |

---

# Appendix B — Founder one-pager: configuring the prod Mixpanel token

The facade is a no-op until a token exists. To go live:

0. **Install the SDK** — `npx expo install mixpanel-react-native`. It is a native module, so the app then
   needs a dev/prod build (managed prebuild via EAS or `expo run:ios`), not Expo Go. The code already loads it
   lazily, so nothing else changes in the source.
1. **Create a Mixpanel project** (mixpanel.com → Settings → Projects → *New Project*). Region: US or EU per
   preference — the SDK defaults to US; EU needs a server-URL option, tell the Lead if you pick EU.
2. **Copy the Project Token** (Settings → Project Settings → *Project Token*).
3. **Provide it to the build** as `extra.mixpanelToken`. Recommended: an env var read in `app.config.ts`
   (`extra: { mixpanelToken: process.env.MIXPANEL_TOKEN }`) so the token is not committed; set
   `MIXPANEL_TOKEN` locally and as an EAS build secret for release builds.
4. **Verify:** run a release build, tap through onboarding, and watch Mixpanel → *Events* (live view) for
   `Screen Viewed` / `Onboarding Step Completed`. Nothing appears in dev/sim builds by design.

**No separate dev project is used** — dev/sim send nothing, so there is no dev data to isolate. Add a second
project + token later only if you want staging analytics.
