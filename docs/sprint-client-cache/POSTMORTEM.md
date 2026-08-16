# Postmortem — Client caching infra

## What went well

- **The migration shrank code.** Each converted screen lost its `useState` + `useEffect(fetch)` +
  focus-refetch and gained one hook line. The cache decision (long staleTime + invalidate) removed the
  hand-rolled focus-refetch in `recipes.tsx` outright.
- **The demo proved the real win.** A cold restart showing the cookbook with zero network calls is the
  whole point of the sprint, and it worked first try once pointed at a healthy backend.

## Blockers hit (decided-and-logged, no stop)

1. **Brief was wrong about AsyncStorage.** It claimed onboarding already used
   `@react-native-async-storage/async-storage`. It does not — onboarding persists via `expo-secure-store`,
   and async-storage was not installed. Decision: install it, pinned to the SDK-54 version (`2.2.0` from
   `expo/bundledNativeModules.json`).
2. **Fresh worktree, empty `node_modules`.** Ran `npm install` first. A pre-existing React 19 peer
   conflict (radix transitive) means adds need `--legacy-peer-deps`; the base install absorbs it via the
   lockfile.
3. **The shared backend on `:3000` was broken.** It is served from a *different* worktree
   (`recipe-import/server`) and returned 500 on every `/v1/users` provision — not this task's code. The
   local Postgres itself was healthy (8 tables, 1 user). Decision: run *this* worktree's server on `:3001`
   against that DB, point the app there for the demo via a **temporary** `config.ts` edit, capture
   evidence, then **revert** (verified the committed diff contains no `:3001`). Left the other worktree's
   server and Metro untouched.
4. **Expo Go served a stale bundle.** With `CI=1`, Metro does not watch files, so editing `config.ts`
   never rebuilt. Fix: restart Metro without `CI`, then cold-restart Expo Go (terminate + `openurl`) so it
   re-fetches the bundle. A foreground reload alone reused the cached JS.

## For the next Lead

- Deep-link straight to a screen in Expo Go with `exp://127.0.0.1:<port>/--/<route>`; `ensureSession`
  auto-provisions, so you skip onboarding.
- The sim's `idb ui tap` uses **points** (device is 402×874), not screenshot pixels — divide pixel coords
  by the 3× scale.
- If you must repoint the app at a different backend, change `lib/api/config.ts`, restart Metro **without**
  `CI=1`, and cold-restart Expo Go. Revert before committing.
