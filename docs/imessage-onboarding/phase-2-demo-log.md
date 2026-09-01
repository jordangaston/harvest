# Phase 2 — Demo log (real iMessage e2e: inbound recipe parsing)

All checks were run from the test Mac against the live Chef line, with the dev server on the merged
Phase-2 HEAD (WI-2A + WI-2B + the pipeline fix) and the ngrok tunnel live. Wire/state evidence = the
live Turso DB + the nitro workflow log; on-device = replies read from `chat.db`.

## Scope

The mission's e2e asks for a real link from each of the four sources. The founder scoped the live
e2e to the **web source** — the per-platform fetchers (Instagram/TikTok/YouTube) are pre-existing and
separately verified, and the drop→pipeline→Liked→reply **substrate** is source-agnostic, so proving
it on the web source (both success and failure) proves the feature. The classifier/routing was also
observed selecting `website` and `youtube` correctly.

## Blocker found + fixed (pre-existing, unrelated to Phase-2 features)

The very first e2e drop exposed a pre-existing bug that stalled **every** recipe import: the WDK
per-step bundler (rolldown via `workflow/nitro`) externalized `import … from cuisines.json with
{ type: 'json' }` and dropped the attribute, so Node 24 rejected it (`ERR_IMPORT_ATTRIBUTE_MISSING`)
when loading the first step (`markRunning`). Jobs sat at `status=queued` forever. Fixed by embedding
the cuisine hierarchy as a TS data module (`cuisines-data.ts`, byte-identical data) — no runtime file
or import attribute, works dev + deployed. **Likely a production bug too** (same bundler/Node path).
PR #61, merged. After the fix, imports run end-to-end.

## Web source — success ✅

**Drop:** `https://www.seriouseats.com/classic-panzanella-salad-recipe`

- **WI-2A:** the reasoner called `import_recipe`; an `imessage_import` link row was created
  (`job → thread`, `target_external_id` = the link message's platform id); a `website` job started.
- **Pipeline (unblocked):** `[step] persist-and-ready … recipes=1` → recipe persisted
  (`Classic Panzanella Salad (Tuscan-Style Tomato and Bread Salad)`), job `status=ready`.
- **WI-2B:** recipe **saved to the user's Liked cookbook** (`recipe in Liked? true`);
  `imessage_import.notified_at` stamped (exactly-once).
- **On-device:**
  - `On it — reading that panzanella recipe.` (WI-2A ack)
  - `Saved "Classic Panzanella Salad (Tuscan-Style Tomato and Bread Salad)" to your Liked cookbook.`
    (WI-2B success, names the recipe)

## Web source — failure ✅

**Drop:** `https://example.com` (classifies as `website`, no recipe → import fails)

- Job `source=website, status=failed, err=FETCH_FAILED`;
  `[step] mark-failed … code=FETCH_FAILED` → `[step] notify … outcome=failed`.
- **On-device:**
  - `On it — reading that recipe…`
  - `I couldn't save that recipe — we're looking into it.` (WI-2B failure message)
- No Liked write for the failed job.

## Failure path also confirmed on another source

A dropped YouTube video with no extractable recipe → job `failed / NO_RECIPE` →
`I couldn't save that recipe — we're looking into it.` on-device. (Same WI-2B failure branch, second
source — shows the classifier routed `youtube` and the failure notify fired.)

## Net

Phase 2's inbound-recipe-parsing works end-to-end on a real device: a dropped recipe link is ingested
through the existing pipeline, saved to the Liked cookbook, and confirmed with a message naming the
recipe; a broken/non-recipe link produces the failure message. Exactly-once notify verified
(`notified_at`). A pre-existing pipeline blocker was found and fixed along the way. The confirmation
is a normal message; **Phase 3** upgrades it to a threaded reply via the stored `target_external_id`.
Nothing was faked.
