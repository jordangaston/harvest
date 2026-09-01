# Phase 4 — Demo log (personality & polish)

## What shipped (all merged to `main`)

| PR | Item | Verification |
|---|---|---|
| #68 | **WI-4A** tapbacks + emoji personality | 526 tests; grounded emission (real trigger `external_id`, never `plan.address`); never-thumbs-up enforced structurally (`CHEF_TAPBACK_KINDS`) |
| #69 | **WI-4B** screen effects (confetti greeting, fireworks on onboarding-complete) + one-time-flag substrate | 529 tests; review fixed a fireworks drain-loop double-fire + a stale-green |
| #70 | **WI-4C** chat rename (group-guarded) + native contact card | 532 tests; `space.type` confirmed reachable at runtime so the group rename fires; DM correctly no-ops |
| — | Codified tapback/emoji style (`chef-tapback-emoji-style.md`) from `/deep-research` | — |

## Decisions (founder)

- **Fireworks** fire on **onboarding-complete** — there is no meal-plan-generation flow over iMessage
  (HTTP-only), so onboarding-complete is the real "first menu is coming" signal.
- **Chat rename** is built **guarded** — fires on group chats, no-ops on 1:1 DMs (iMessage rename
  throws on a DM). The test thread is a DM, so it correctly no-ops there.
- **Contact card** is the **native** `nativeContactCard()` (the line's Apple-account identity,
  configured as "Chef" in the Photon portal).
- **Markdown formatting** stays **descoped** (Phase-1 spike: no on-device styling on this line).
- **Reasoner-driven recipe recommendation** (for rich links, Phase 3) stays descoped.

## On-device e2e — status (honest)

A fresh onboarding run was driven from the test Mac on the merged Phase-4 HEAD. The server behaved
correctly end to end: it produced onboarding replies, fired the **confetti greeting** (thread
`greeted_at` stamped), created the household, and **sent every reply through the live Spectrum line —
15 outbound rows each with a real `spc-msg-…` platform id**, confirming the sends were accepted and
minted by Spectrum.

The **visual on-device confirmation of the effect/tapback/card sequence was not captured in a single
clean run**: mid-run the founder's device was asleep so the (successfully-sent) messages weren't
displayed, and the founder then elected to ship on the server-verified + unit/integration evidence
rather than re-run. So, unlike Phases 1–3 (fully device-observed), Phase 4's *visual* rendering of
confetti/fireworks/the native card was not eyeballed on-device in this session.

**What IS verified:** the send path works on the live line (real Spectrum ids for every reply); the
confetti/fireworks/rename/card **logic** is unit + integration tested (one-time flags, drain-loop
safety, DM no-op, group-reachable rename); and the effect/reaction/rename/`nativeContactCard` SDK
calls are confirmed against the installed `@spectrum-ts` types. The one-time gates were exercised live
(`greeted_at` stamped once on the greeting turn).

**To fully close the visual check later:** reset the thread (`docs`/the in-place reset), run onboarding
with the device awake, and observe in `chat.db`: `expressive_send_style_id` (confetti on the greeting,
fireworks at completion), `associated_message_type` (a Chef tapback of an allowed kind, no thumbs-up),
and the native contact-card balloon after the fireworks.

## Net

Phase 4 code is complete, reviewed, and merged; the personality/polish behaviors are wired at the
right lifecycle moments with exactly-once gates. The live send path is confirmed; the founder shipped
on that plus the unit/integration coverage, with the on-device *visual* pass deferred.
