---
title: "Harvest Core — Implementation Backlog"
feature: harvest-core
status: draft
date: 2026-08-02
source: docs/core-design.md, docs/core-use-cases.md, docs/test-fixtures.md
---

# Harvest Core — Sequenced Work Items

Each item is a shippable vertical slice. Dependencies in brackets. Specs live beside this file
(`WI-0N-*.md`). Implement in order; the backend (WI-01..05) unblocks the mobile work (WI-06..08).

| ID | Title | Delivers (use cases) | Depends on |
|----|-------|----------------------|------------|
| **WI-01** | **Server scaffold** — Fastify + composition root (no DI container), Neon Postgres + Drizzle schema (`users`, `recipes`, `ingredients`, `steps`, `import_jobs`) + migrations, DBOS bootstrap (in-process), `/healthz`, Vitest (unit + integration projects) | Foundation for everything | — |
| WI-02 | Phone auth vertical — `OtpProvider` (Twilio Verify + Stub), `OtpService`, `AuthService` (ECDSA P-256 / ES256 access+refresh / nonces), `authGuard`, endpoints `/v1/otps`, `/v1/otps/verify`, `/v1/users`, `/v1/users/sign_in`, `/v1/users/me` | F-01, F-02, O-07 | WI-01 |
| WI-03 | Import intake + job model — `POST /v1/imports` (`resolveSource` O-01), `import_jobs` writes as **DBOS transactions**, DBOS pipeline workflow skeleton (status/progress transitions), `GET /v1/imports/:id` polling | F-03 intake, F-06, O-08 skeleton | WI-01, WI-02 |
| WI-04 | Source fetch tiers — Tier-0 (TikTok oEmbed + website JSON-LD, O-03), Tier-1/2 Apify (`SourceFetcher`: `ApifyFetcher`/`WebsiteFetcher`), Option B ffmpeg audio+frames; provider stubs + recorded fixtures | O-01, O-02, O-03 | WI-03 |
| WI-05 | Parse + persist — Groq Whisper (O-04), frame sampling + Qwen-VL (O-05), Qwen extraction w/ structured output + escalation (O-06), icon mapping (O-09), thumbnail re-host (BR-07), persist recipe into O-08 | O-04, O-05, O-06, O-08, O-09 | WI-04 |
| WI-06 | Mobile phone-auth screen — new `(onboarding)/phone.tsx` before `setting-up`, OTP UI, API client, secure token storage, two-door + wrong-door routing | F-01/F-02 (client) | WI-02 |
| WI-07 | Mobile import wiring — replace faked import + in-memory store with API-backed; import sources (+ Pinterest, + Photos); iOS Share Extension; progress polling | F-03/F-04/F-05/F-06 (client) | WI-03, WI-05 |
| WI-08 | Cookbook reads — `GET /v1/users/me` cookbook + recipe detail from API; render `total_minutes`, remote hero images | G-02 reads (client) | WI-05 |

Open questions that gate specific items: Q-08 (DBOS+Neon pooling) → WI-01/WI-03; Q-09 (Option B ffmpeg) →
WI-04; Q-10 (Tier-0 sources) → WI-04; Q-11 (Qwen GA + threshold) → WI-05; Q-12 (IG media plan) → WI-04.
