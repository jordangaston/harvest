# S1 — `users.name` column + surface in model / projection / `GET /v1/users/me`

**Story.** As Profile and Instrumentation, I can read the user's name from the domain model and the
`/me` endpoint, so I can address the user by name. (Architect must-fix.)

## Files
- `server/src/db/schema/users.ts` — add `name: text('name')` (nullable).
- `server/drizzle/0009_*.sql` — generated migration adding the column.
- `server/src/models/user.ts` — `UserSchema` gains `name: z.string().nullable()`;
  `toPublicUser` returns `{ id, phone, name }`.
- `server/src/repositories/user-repository.ts` — no change (insert already takes `NewUser`;
  `name` flows through).

## Acceptance criteria → tests
- AC1: `users` has a nullable `name text` column. → migration applies clean in `global-setup`.
- AC2: `UserSchema.parse` accepts a row with `name: null` and with a string. → covered by existing
  repository parse on insert; new integration asserts persisted name.
- AC3: `GET /v1/users/me` returns `{ user: { id, phone, name } }`. → update existing `/me` guard test
  to assert `name` (null for a user created without one; the string once S2 writes it).

## Notes
Nullable so the migration is backwards-compatible and the sign-in-provision edge (a never-registered
number hitting `sign_in`) yields a valid row. Consumers are null-tolerant until this merges.
