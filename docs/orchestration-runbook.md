# Orca orchestration runbook

How this repo runs its multi-agent sprints with the Orca CLI (`orca orchestration …`). The workflow *rules*
live in `CLAUDE.md` ("Multi-agent sprint workflow"); this file is the *mechanics* — the sharp edges that each
cost a cycle during the Cleanup sprint (`docs/sprint-cleanup/POSTMORTEM.md`).

## Dispatch a Feature Lead into its own worktree

1. **Task worktree:** `orca worktree create --name <task> --no-parent --json` — independent, off `main`.
2. **Run + Task:** `orca orchestration run-create --objective "…"`, then `orca orchestration task-create --spec "…"`.
   For a long brief, write it to a file in the worktree and make the spec a short pointer to it (avoids
   shell-escaping a huge string).
3. **Start the worker in that worktree:**
   `orca orchestration worker-start --task <task_id> --worktree name:<task> --agent claude --json`.
4. **Submit the prompt** — see gotcha 1.
5. **Supervise:** `orca orchestration check --wait --types worker_done,escalation,question --timeout-ms <n>`.
   Treat a timeout as a checkpoint, not a failure (real builds run 15–60 min). `--ack <delivery_id>` after
   processing each delivery. Answer a `question` with `orca orchestration reply --id <msg_id> --body "…"`.

## Gotchas (each cost a cycle)

1. **`worker-start` stages the prompt but does not submit it.** The task text sits in the agent's input as
   `[Pasted text …]` and the worker looks idle (it isn't dead — just unstarted). Submit it:
   `orca terminal send --terminal <handle> --text "" --enter --json`. Get `<handle>` from
   `orca orchestration worker-show --dispatch <id> --json` (`terminal.handle`). Do this for **every** worker.
2. **Re-engaging a retained terminal needs an explicit `--worktree`.** `worker-start --task <new> --terminal <handle>`
   fails with `terminal_worktree_mismatch` — it defaults the worktree to the coordinator's context. Pass
   `--worktree name:<task>` alongside `--terminal`.
3. **`orca terminal read` can return a stale/pinned snapshot** — you cannot judge staged-vs-running from it.
   Use `orca orchestration worker-read --dispatch <id> --json` (the real hook transcript). The reliable
   completion signal is always `check --wait --types worker_done`, never terminal scraping.
4. **Keep a Lead alive across phases** (design → implement → follow-ups) with
   `orca orchestration worker-retain --dispatch <id> --json`, then re-engage it with the next task (gotcha 2's
   `--worktree`) rather than releasing and respawning — it keeps the Lead's context.

## After a task merges

Pull `main` into every worktree that builds on it before continuing (see `CLAUDE.md` — *pull before every
cycle*). Dependent waves branch from the merged `main`, not a stale base.
