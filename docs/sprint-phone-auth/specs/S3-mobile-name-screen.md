# S3 — Mobile name-entry screen

**Story.** As a new user, at the end of onboarding I enter my name, so the app can address me by it.

## Files
- `lib/onboarding.ts` — add `name?: string` to `Payload` and `setName(name: string)`; `getOnboarding`
  already drains the whole payload. `name` is passed to the create call, not stored as an enum column.
- `app/(onboarding)/name.tsx` — new screen.
- `app/(onboarding)/age.tsx` — route Continue to `/(onboarding)/name` instead of `/setting-up`.

## Behavior
- `OnboardingScreen` chrome (cream canvas, `bg-card` input via the `<Input>` primitive, Karla/Lora),
  progress ~0.82. Heading "What's your name?" (or similar).
- Single `<Input>`, `autoFocus`, `autoCapitalize="words"`. CTA "Continue" disabled until non-empty
  (trimmed). On Continue: `setName(trimmed)` → `router.push("/(onboarding)/phone")`.
- `KeyboardAvoidingView` so the CTA stays reachable (mirror the sheet pattern; full-screen variant).

## Acceptance criteria → tests
- AC1: Continue disabled until a non-empty name is typed. (demo)
- AC2: the entered name reaches the signup POST (asserted end-to-end via the S2 integration + the
  demo showing the created user's name in `/me`). (demo + typecheck)

## Notes
`name` is separate from the enum onboarding payload; it maps to `users.name`, not an enum column.
