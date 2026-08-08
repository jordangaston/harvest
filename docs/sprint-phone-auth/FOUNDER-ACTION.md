# Founder action needed — provision a real Twilio number for live e2e

Everything in this sprint runs and is demoed **offline** against `StubOtpProvider` (fixed code
`123456`) — no Twilio needed for tests, the simulator, or CI. To exercise **real SMS** once (and to run
live in production), the founder must set up Twilio. The server auto-selects the live provider only when
all three `TWILIO_*` vars are set; otherwise it stays on the stub (`selectOtpProvider()`).

## Exact steps (Twilio console)

1. **Log into Twilio** and copy from the Console home:
   - **Account SID** → env `TWILIO_ACCOUNT_SID`
   - **Auth Token** → env `TWILIO_AUTH_TOKEN`
2. **Create a Verify Service** (Verify → Services → Create). Default settings, SMS channel on. Copy its
   **Service SID** (`VA…`) → env `TWILIO_VERIFY_SERVICE_SID`.
3. **Buy one SMS-capable phone number** (Phone Numbers → Buy a number) to act as the **agent test
   number** — the destination the live-smoke test sends to and reads the code from. It must support
   **inbound** SMS so the code can be read back via the Twilio Messages API. Set it as
   `TWILIO_TEST_NUMBER` (E.164) for the smoke test.
4. **US A2P 10DLC caveat:** app-to-person SMS to U.S. numbers needs 10DLC brand/campaign registration,
   which can take days–weeks and may filter unregistered traffic. To avoid blocking, use a **toll-free**
   number (lighter verification) or treat live SMS as a later one-time smoke — all automated testing
   uses the offline stub and needs none of this.

## Env vars the code reads

| Var | Used by | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | `TwilioVerifyOtpProvider` | required for live |
| `TWILIO_AUTH_TOKEN` | `TwilioVerifyOtpProvider` | required for live |
| `TWILIO_VERIFY_SERVICE_SID` | `TwilioVerifyOtpProvider` | required for live; **see mismatch below** |
| `TWILIO_TEST_NUMBER` | live-smoke script only (not yet wired) | the agent test number, E.164 |

## ⚠️ `.env` key-name mismatch (fix before going live)

The local `server/.env` defines **`TWILIO_VERIFY_SERVICE`**, but the code (`config/env.ts`,
`otp-provider.ts`) reads **`TWILIO_VERIFY_SERVICE_SID`**. As-is, the Verify Service SID is `undefined`
even with creds present, so `selectOtpProvider()` silently stays on the stub. **Rename the `.env` key to
`TWILIO_VERIFY_SERVICE_SID`.** (`.env` is git-ignored and skipped under `NODE_ENV=test`, so this never
affects the offline suite — it only bites the first live run.)

## How the live smoke would read the code (no human)

Send the OTP to `TWILIO_TEST_NUMBER`, then fetch the inbound SMS via the Twilio Messages API
(`client.messages.list({ to: TWILIO_TEST_NUMBER })`) and regex the 6 digits, then drive
`POST /v1/users` / `/v1/users/sign_in`. This script is intentionally **not** in the offline suite; it is
gated on the env vars above. (Not built this wave — the offline stub covers all automated testing.)
