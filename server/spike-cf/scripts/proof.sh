#!/usr/bin/env bash
# SPIKE proof — the Harvest import pipeline running as a Cloudflare Workflow,
# driven by a Worker route, reading/writing Turso (libSQL), with NO long-lived
# process. The DB is a LOCAL `turso dev` libSQL server (offline, no account); the
# Worker + Workflow run under `wrangler dev`. Providers are offline stubs.
#
# It proves two things:
#   1. an import reaches `ready` through durable Workflow steps (via a real
#      interactive libSQL transaction — no D1 batch workaround);
#   2. durable RECOVERY — a step fails once, the Workflow resumes (re-running
#      only the failed step, upstream steps memoized) and completes; it does not
#      restart from zero.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.turso:$PATH"

PORT=8799
DB_PORT=8080
export TURSO_DATABASE_URL="http://127.0.0.1:$DB_PORT"
B="http://127.0.0.1:$PORT"
H=(-H 'content-type: application/json')
DEVLOG=/tmp/harvest-cf-proof.log
DBLOG=/tmp/harvest-cf-turso.log

echo "== 0. start local libSQL server (turso dev) + apply schema =="
rm -rf .turso && mkdir -p .turso
turso dev --db-file .turso/local.db --port "$DB_PORT" >"$DBLOG" 2>&1 &
DB_PID=$!
# .dev.vars feeds the Worker its libSQL URL (as wrangler dev does in real dev).
printf 'TURSO_DATABASE_URL=%s\n' "$TURSO_DATABASE_URL" > .dev.vars
trap 'kill $DB_PID ${DEV_PID:-} 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf -m 2 "$TURSO_DATABASE_URL" >/dev/null 2>&1 && break; sleep 1; done
node scripts/apply-schema.mjs
echo "   libSQL up at $TURSO_DATABASE_URL (local file .turso/local.db, no account)"

echo "== 1. boot wrangler dev (Workers + Workflows, local; DB over HTTP to libSQL) =="
rm -f "$DEVLOG"
npx wrangler dev --port "$PORT" --ip 127.0.0.1 >"$DEVLOG" 2>&1 &
DEV_PID=$!
for i in $(seq 1 60); do curl -sf -m 2 "$B/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -sf -m 2 "$B/healthz" >/dev/null || { echo "dev server never came up"; tail -20 "$DEVLOG"; exit 1; }
echo "   ready on $B (no long-lived process — the isolate serves a request and stops)"

poll() { # $1=jobId -> echoes final job json, fails if it never terminates
  local id="$1" r st
  for _ in $(seq 1 60); do
    r=$(curl -s "$B/v1/imports/$id"); st=$(echo "$r" | jq -r .job.status)
    if [ "$st" = ready ] || [ "$st" = failed ]; then echo "$r"; return 0; fi
    sleep 1
  done
  echo "$r"; return 1
}

echo "== 2. CLEAN import → ready via durable steps (interactive libSQL txn) =="
U1=$(curl -s "${H[@]}" -XPOST "$B/v1/users" -d '{"phone":"+15555550100"}' | jq -r .user.id)
J1=$(curl -s "${H[@]}" -XPOST "$B/v1/imports" \
      -d "{\"userId\":\"$U1\",\"source\":{\"url\":\"https://recipes.example.com/creamy-garlic-chicken\"}}" | jq -r .job.id)
R1=$(poll "$J1"); echo "   $(echo "$R1" | jq -c .job)"
[ "$(echo "$R1" | jq -r .job.status)" = ready ] || { echo "FAIL: clean import not ready"; exit 1; }

echo "== 3. FAULTED import → recovers and reaches ready =="
U2=$(curl -s "${H[@]}" -XPOST "$B/v1/users" -d '{"phone":"+15555550199"}' | jq -r .user.id)
J2=$(curl -s "${H[@]}" -XPOST "$B/v1/imports" \
      -d "{\"userId\":\"$U2\",\"source\":{\"url\":\"https://recipes.example.com/creamy-garlic-chicken\"},\"faultStep\":\"extract\"}" | jq -r .job.id)
R2=$(poll "$J2"); echo "   $(echo "$R2" | jq -c .job)"
[ "$(echo "$R2" | jq -r .job.status)" = ready ] || { echo "FAIL: faulted import not ready"; exit 1; }
[ "$(echo "$R2" | jq -r .job.fault_attempts)" = 2 ] || { echo "FAIL: expected fault_attempts=2"; exit 1; }

echo "== 4. memoization: step execution counts for the faulted job =="
grep "\[step\].*$J2" "$DEVLOG" | sed 's/^/   /'
FETCH=$(grep -c "\[step\] fetch-source job=$J2" "$DEVLOG" || true)
EXTRACT=$(grep -c "\[step\] extract job=$J2" "$DEVLOG" || true)
PERSIST=$(grep -c "\[step\] persist-and-ready job=$J2" "$DEVLOG" || true)
echo "   fetch-source=$FETCH extract=$EXTRACT persist-and-ready=$PERSIST"
[ "$FETCH" = 1 ] && [ "$EXTRACT" = 2 ] && [ "$PERSIST" = 1 ] || { echo "FAIL: memoization counts wrong (want fetch=1 extract=2 persist=1)"; exit 1; }

echo "== 5. libSQL integrity: the faulted import persisted EXACTLY ONE recipe (no restart/dup) =="
N=$(node scripts/count-linked.mjs "$J2")
echo "   recipes linked to faulted job: $N"
[ "$N" = 1 ] || { echo "FAIL: expected exactly 1 recipe for the faulted job, got $N"; exit 1; }

echo
echo "== PROOF PASSED =="
echo "   clean import: ready.  faulted import: failed extract once → resumed → ready."
echo "   upstream steps ran once (memoized), only the failed step retried, one recipe persisted."
echo "   DB: Turso/libSQL via a real interactive transaction, no long-lived process."
