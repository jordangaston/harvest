# ReciMe Clone (skeleton)

A visual, navigable skeleton of the ReciMe recipe app — onboarding flow through the main app — reverse-engineered from a screen recording of the real app.

## Stack

- **Expo** (SDK 57) + **Expo Router** (file-based navigation)
- **React Native** 0.86
- **NativeWind 4** — Tailwind CSS classes in React Native
- **Gluestack-style component layer** (`components/ui`) — mirrors the gluestack-ui v2 API (`Box`, `VStack`, `HStack`, `Button`, `Checkbox`, `Switch`, …) built on NativeWind + `tailwind-variants`.

> **Why not the gluestack CLI / DaisyUI?**
> DaisyUI is web-only CSS and cannot render in React Native. The gluestack-ui v2 CLI needs an interactive TTY and its alpha packages conflict with Expo SDK 57's dependency graph, so the component layer was hand-authored to the same API. The Tailwind/NativeWind styling is identical.

## Run

```bash
cd recime-clone
npm install --legacy-peer-deps   # expo-router's dep graph needs this flag
npm run ios       # or: npm run android / npm run web
```

## Design tokens (`tailwind.config.js`)

| Token | Value | Use |
| --- | --- | --- |
| `cream` | `#F6EFE3` | Onboarding background |
| `brand` | `#2F6BF6` | Primary blue — buttons, links, progress, active tab |
| `plus` | `#964FC6` | ReciMe Plus purple — paywall |
| `ink` | `#1C1C1E` | Primary text |
| `muted` | `#8A8A8E` | Secondary text |

## Screen map

### Onboarding — `app/(onboarding)/`
`welcome → testimonials → goals → thats-great → goals-happen → when-cook → notifications → how-heard → recipe-sources → awesome → import-demo → recipe-imported → website-import → age → referral → setting-up → better-cook → paywall-intro → paywall-compare → trial-reminder → trial-choose → create-account`

### Main app — `app/(app)/` (bottom tabs)
`recipes` · `meal-plan` · `groceries` · `discover`

## Structure

```
app/
  _layout.tsx              root stack + providers
  index.tsx                → redirect to onboarding
  (onboarding)/            21 onboarding screens + stack layout
  (app)/                   4 tab screens + tabs layout
components/
  ui/                      gluestack-style primitives
  recime/                  Logo, ProgressHeader, OnboardingScreen, OptionRow
```

This is a UI skeleton: screens are static and navigate via buttons; there is no backend, auth, or persistence.
