# Phone Auth — demo evidence

Offline throughout: server uses `StubOtpProvider` (fixed code `123456`); no Twilio, no network.

## Backend (live server exercise) — S1, S2, S5
`S1-S2-S5-backend-demo.md` — curl transcript against the running dev server:
- send OTP → `pending`
- create with **bad** code → `400 INVALID_OTP`, **no user row** (S2: verify precedes provision)
- create with **good** code + name + onboarding → `200` session, `isNew:true`, name persisted (S2)
- `GET /v1/users/me` → returns `name` (S1 must-fix)
- `POST /v1/users/sign_in` by OTP → same user id, `isNew:false` (S5)

## Mobile (iOS simulator, Expo Go, dedicated device `Harvest-phoneauth`)
- `01-welcome.png` — Welcome (golden-hour hero, amber "Get started", "Log in").
- `S3-name-screen.png`, `S3-name-typed.png` — **S3** name entry renders (`bg-card` input, Karla/Lora,
  cream canvas) and enables Continue on input.
- `S5-01-phone-signin.png`, `S5-02-phone-typed.png` — **S4/S5** phone screen renders and accepts input;
  "Send code" enables at ≥10 digits.
- `S5-03-verify-code.png` — **S4/S5** verify-code screen after a **real OTP send** (server logged
  `POST /v1/otps → 200`) and navigation carrying the phone; shows the resend cooldown.

### Known demo-harness gap (not an app defect)
The final **code-entry → recipes** hop was not captured on the simulator: the 6-digit input uses
`textContentType="oneTimeCode"`, and the iOS simulator's HID text injection does not land digits in that
autofill field (the field focuses — cursor blinks — but `ui_type` digits are dropped). The underlying
logic is proven by the **backend live demo** (`sign_in`/`createUser` succeed with `123456`) and a clean
`tsc` typecheck. On a real device / real keyboard this field behaves normally (and benefits from OS OTP
autofill). See `../POSTMORTEM.md`.
