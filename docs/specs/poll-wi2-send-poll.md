# WI-2: Send a poll via the chef's `chat__send` tool

## Background

The chef sends all outbound through the single `chat__send` tool (`server/src/chef/chef-agent.ts`,
`SendInput` ~line 64), flushed live via `turn.send()`. We add a poll content type. We send via
the advanced client's `polls.create()` (WI-1), not Spectrum `poll()`, because `create()` returns
the `pollMessageGuid` **and** the `optionIdentifier → text` map in one call — the vote anchor and
the "which option" map (design D2). We persist the poll as the outbound `thread_messages` row
(`type='poll'`, `external_id`=guid, `body`=JSON `{title, options:[{optionIdentifier,text}]}`); no
new poll table. Depends on WI-1.

## Objective

Let the model send a native iMessage poll in one `chat__send` call, and persist the poll record
(guid + option map) that WI-3 votes will anchor to.

## Acceptance Criteria

1. Given the model calls `chat__send({type:'poll', text:title, options:[…]})` with ≥2 options,
   when executed, then a native poll is sent to the chat and one `thread_messages` row is written
   with `type='poll'`, `external_id`=`pollMessageGuid`, `body`=JSON `{title, options:[{optionIdentifier,text}]}`.
2. Given `<2` options (or blank title), when executed, then the call is dropped/rejected without
   sending (mirrors the existing tapback-drop path).
3. `SendInput` gains `type:'poll'` and `options: string[]`; `thread_messages.type` enum widens to
   include `'poll'` (TS-enum only, no DB migration).
4. Given the send succeeds, then the tool returns `{sent:true}` and the poll appears natively on
   the recipient device (not as text).

## Test Cases

### Test Case 1: Poll send persists anchor row
**Preconditions:** WI-1 client available; test thread for `+15128267702`.
**Steps:** invoke `chat__send({type:'poll',text:'Dinner?',options:['Pizza','Tacos','Sushi']})`.
**Expected Outcomes:** `polls.create` called; a `type='poll'` row exists with `external_id` set and `body.options` holding 3 `{optionIdentifier,text}` pairs.

### Test Case 2: Too few options dropped
**Preconditions:** as above.
**Steps:** `chat__send({type:'poll',text:'x',options:['only one']})`.
**Expected Outcomes:** no `polls.create` call, no row, returns not-sent; unit-tested like the tapback drop.

### Test Case 3: Schema round-trips
**Steps:** parse a poll `SendInput` payload through the Zod schema.
**Expected Outcomes:** valid; `text` + `options` present; unknown fields rejected.

## Test Run
_To be determined._

## Deployment Strategy

Direct deploy behind the model's discretion (the prompt gains one line on when to prefer a poll).
Backwards-compatible: existing send types unchanged; new `'poll'` type is additive.

## Production Verification

### Production Verification 1: Real poll lands natively
**Preconditions:** deployed.
**Steps:** prompt the chef into sending a poll to a test device.
**Expected Outcomes:** native poll renders on-device; a `type='poll'` row with option map is in prod Turso.

## Production Verification Run
_To be determined._
