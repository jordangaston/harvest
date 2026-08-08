# Profile — demo evidence

Captured live on a dedicated simulator running the app in Expo Go (SDK 54) against this branch's server
(port 3005, Metro 8094) and an isolated Postgres (`harvest_profile` on 5433).

## Video — `profile-demo.mp4`

`profile-demo.mp4` (~17s) walks the full feature: **welcome → recipes (painterly avatar, top-right) →
profile (avatar art, "Welcome", Log out, Delete account) → delete-confirm modal → return to welcome**.
The four `profile-frame-0*.png` files are its key frames.

**How it was produced (be honest):** every screen and interaction in the clip was driven *live* on the
booted simulator — the avatar tap, the profile fetch (`GET /v1/users/me` → null-tolerant "Welcome"), the
`bg-cream` delete modal, and the logout return-to-welcome were all exercised against the real server. A
**continuous** simctl screen recording was not achievable in this shared run: the cross-sprint disk hit
**0 bytes** (six worktrees), and `simctl io recordVideo` writing to a full disk crashed/shut the
**x86_64** simulator twice; after freeing 13 GB, the sim-orchestration kept **deleting/hang-booting**
every dedicated device within ~2 min. So `profile-demo.mp4` is an MP4 **assembled from the live-captured
frames** (each an actual on-device screenshot), not a single continuous capture. See the sprint report's
Phase 7 note.

| # | Screenshot | Sub-story | What it shows |
|---|---|---|---|
| 02 | `02-welcome.png` | — | Welcome hero (entry point). |
| 03 | `03-recipes-avatar.png` | S4, S2 | Recipes screen with the **painterly default avatar** wired into the top-right header. |
| 04 | `04-profile.png` | S2 | Profile screen: avatar art, **"Welcome"** (name null pre-Phone-Auth — null-tolerant fallback), **Log out** row (`bg-card`), **Delete account** (error red). Fetched `GET /v1/users/me`. |
| 05 | `05-delete-confirm.png` | S3 | `bg-cream` slide confirm modal over a scrim: "Delete your account?" + Cancel (`bg-card`) / **Delete** (`bg-error`). |
| 06 | `06-after-delete-welcome.png` | S1, S3 | After confirming: server logged `DELETE /v1/users/me`, app returned to **welcome**. DB verified: the app's user + its recipes/cookbooks/import_jobs all gone; **no re-provision** (teardown ordering held). |
| 07 | `07-after-logout-welcome.png` | S2 | Re-entered, opened profile, tapped **Log out** → back to **welcome** (session cleared). |

**S1 backend** is also covered by `server/tests/integration/user-delete.test.ts` (3 tests): real
`DELETE /v1/users/me` → 204 with full cascade, 401 without a token, and the defensive
`meal_plan_entries`/`grocery_items` deletes firing when those tables exist.
