# Profile — Reference Analysis (CLARIFY gate)

Task 5 of Harvest v1: **avatar icon (top-right of the recipes screen) → profile screen with username,
logout (→ welcome), delete-data (→ welcome).** Reference: Recime `settings-details.MP4` +
`recipes-details.MP4`.

## Reference: what Recime does (settings-details.MP4)

Recime's avatar (top-right of its library screen) opens a **pushed full-screen** "profile/settings" screen:

- **Header card:** round avatar placeholder + generated username **`honey-ramen-231`** (a random
  `adjective-noun-NNN` slug, same shape as an anonymous account) + a blue **"Create account"** link.
- Rows: **Upgrade to Plus**, **Settings** (chevron), a **"Get Set Up"** group (Add shortcut / Read import
  guides / Use on desktop), a **"Connect"** group (Invite / Gift / Redeem / Help), and a footer version string.
- **Settings** (one level deeper) holds: Create an account, My subscription, Language, Preferences, App icon,
  Help, and a blue **"Log out"** button at the bottom. **There is no delete-data control anywhere in the video.**

`recipes-details.MP4` is a **recipe-detail / meal-plan walkthrough** (recipe card actions, add-to-meal-plan
sheet, ingredients, add-to-groceries). It does **not** show the library screen's avatar entry point and is
only tangentially relevant to Profile.

## Where we diverge (drastically simpler)

Our Profile is **three things**: username, logout, delete-data. Everything else in Recime's settings
(subscription, language, app icon, invite/gift, shortcut setup) is **out of scope** — the onboarding sprint
owns "Get Set Up", and there is no billing tier in v1. So our profile screen is a short page, not Recime's
long menu. We add **delete-data**, which Recime does not surface here.

## Live code — what already exists (verified)

**Server auth (`server/src/services/auth-service.ts`, `user-service.ts`):** stateless ES256 JWT pairs
(access 15m / refresh 30d), a **per-user keypair** + `access/refreshTokenNonce` for revocation (bump nonce =
revoke). No session table. `authGuard` (`api/middleware/auth-guard.ts`) reads `Authorization: Bearer` →
`request.authUserId`. `GET /v1/users/me` returns the caller.

**Mobile session (`lib/api/session.ts`):** `expo-secure-store` key `harvest.session` = `{ accessJwt,
refreshJwt, userId, phone }`. **`clearSession()` already exists** (deletes the key). `lib/api/auth.ts`
`ensureSession()` provisions an anonymous user (fake `+1555555xxxx` phone) on first launch and after logout.

**Routing (`app/index.tsx`, `app/_layout.tsx`):** entry **always** `Redirect`s to `/(onboarding)/welcome`
(no session gate on cold launch beyond restoring the token). So **"return to welcome" = `router.replace(
"/(onboarding)/welcome")`** — trivial. `welcome.tsx`'s "Log in" link currently just routes to `/(app)/recipes`
(no real login; phone-auth is a separate Wave-2 task).

**Recipes header entry point (`app/(app)/recipes.tsx:85-88`):** the top-right already has a placeholder
**`<View className="h-8 w-8 rounded-full bg-sand" />`** — a non-interactive tan circle sitting exactly where the
avatar goes. We make it a `Pressable` → profile.

**Data model for delete (verified):**
- `users` — no username/display-name column (only phone + onboarding enums + JWT keys). Nothing points **to**
  users except FKs below.
- `cookbooks.userId` **has `onDelete: cascade`**; `cookbook_recipes` both FKs cascade.
- **`recipes.userId` has NO cascade; `import_jobs.userId` has NO cascade.** → deleting a user row would violate
  those FKs. Delete-data must remove the user's recipes (ingredients/steps cascade off recipes) and import jobs
  first, then the user (cookbooks cascade). No delete-user endpoint exists yet; the pattern to mirror is
  `recipe-repository.deleteOwned` + `DELETE /v1/recipes/:id` (204).

## Implications for build (to confirm at DESIGN, not now)

- Profile is a **pushed full-screen route** `app/(app)/profile.tsx` (design-system `bg-cream`, rows `bg-card`).
- **Logout** = `clearSession()` + `router.replace("/(onboarding)/welcome")`. Purely client-side.
- **Delete-data** = new `DELETE /v1/users/me` (authGuard) that in one transaction deletes owned recipes +
  import jobs, then the user (cookbooks cascade) → client `clearSession()` → welcome.
- **Username** has no source column — needs a decision (see clarifying questions).
