# Backend live demo — S1 (users.name in /me), S2 (server-enforced verify + create), S5 (sign-in)

Live exercise against the running dev server (`tsx src/index.ts`) on port 3010, DB on Postgres 5433,
`StubOtpProvider` selected (offline, fixed code `123456`). Commands + real responses:

```
### 1) POST /v1/otps  (send code)
→ {"otp":{"status":"pending"}}

### 2) POST /v1/users  with BAD code 000000  → S2: verify precedes provision
→ HTTP 400  {"error":{"code":"INVALID_OTP","message":"the code is incorrect or expired"}}
   (a follow-up SELECT shows no user row was created)

### 3) POST /v1/users  with GOOD code 123456 + name + onboarding  → S2: create
→ 200 {
     "user": { "id":"fa04997d-…","phone":"+15555559911","name":"Jordan" },
     "auth": { "access_token":{…}, "refresh_token":{…} },
     "isNew": true
   }

### 4) GET /v1/users/me  (Bearer access)  → S1 must-fix: name surfaced
→ {"user":{"id":"fa04997d-…","phone":"+15555559911","name":"Jordan"}}

### 5) POST /v1/users/sign_in  { otp: { phone, code:123456 } }  → S5: returning user
→ user: {id:"fa04997d-…", phone:"+15555559911", name:"Jordan"}  isNew: false   (same id)
```

**Verifies:** S2 rejects an unverified phone before any DB write (bad code → 400, no row); S2 creates
the account with the verified phone, name, and onboarding; S1 surfaces `name` in the model and `/me`
(Profile + Instrumentation read it); S5 signs a returning user back into the same account by OTP.

The same paths are covered by the offline suite (`server/tests/integration/phone-auth.test.ts`), 87/87
green — including the explicit "bad code creates no user" test.
