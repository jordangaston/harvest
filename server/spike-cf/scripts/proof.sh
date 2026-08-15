#!/usr/bin/env bash
# SPIKE proof — the Harvest import pipeline running as a Cloudflare Workflow,
# driven by a Worker route, reading/writing D1, with NO long-lived process.
# Everything runs in `wrangler dev` local emulation (workerd + miniflare D1);
# providers are offline stubs, so it's hermetic — no network, no paid account.
#
# It proves two things:
#   1. an import reaches `ready` through durable Workflow steps;
#   2. durable RECOVERY — a step fails once, the Workflow resumes (re-running
#      only the failed step, upstream steps memoized) and completes; it does not
#      restart from zero.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8799
B="http://127.0.0.1:$PORT"
H=(-H 'content-type: application/json')
LOG=/tmp/harvest-cf-proof.log

echo "== 0. reset local D1 + apply schema =="
rm -rf .wrangler/state
npx wrangler d1 execute harvest_cf --local --file="$(ls drizzle/*.sql | head -1)" >/dev/null 2>&1
echo "   applied $(ls drizzle/*.sql | head -1) to local D1"

echo "== 1. boot wrangler dev (Workers + Workflows + D1, local) =="
rm -f "$LOG"
npx wrangler dev --port "$PORT" --ip 127.0.0.1 >"$LOG" 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf -m 2 "$B/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -sf -m 2 "$B/healthz" >/dev/null || { echo "dev server never came up"; tail -20 "$LOG"; exit 1; }
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

echo "== 2. CLEAN import → ready via durable steps =="
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
grep "\[step\].*$J2" "$LOG" | sed 's/^/   /'
FETCH=$(grep -c "\[step\] fetch-source job=$J2" "$LOG" || true)
EXTRACT=$(grep -c "\[step\] extract job=$J2" "$LOG" || true)
PERSIST=$(grep -c "\[step\] persist-and-ready job=$J2" "$LOG" || true)
echo "   fetch-source=$FETCH extract=$EXTRACT persist-and-ready=$PERSIST"
[ "$FETCH" = 1 ] && [ "$EXTRACT" = 2 ] && [ "$PERSIST" = 1 ] || { echo "FAIL: memoization counts wrong (want fetch=1 extract=2 persist=1)"; exit 1; }

echo "== 5. D1 integrity: the faulted import persisted EXACTLY ONE recipe (no restart/dup) =="
N=$(npx wrangler d1 execute harvest_cf --local --json \
      --command "select count(*) as n from import_job_recipes where import_job_id='$J2'" 2>/dev/null | jq -r '.[0].results[0].n')
echo "   recipes linked to faulted job: $N"
[ "$N" = 1 ] || { echo "FAIL: expected exactly 1 recipe for the faulted job, got $N"; exit 1; }

echo
echo "== PROOF PASSED =="
echo "   clean import: ready.  faulted import: failed extract once → resumed → ready."
echo "   upstream steps ran once (memoized), only the failed step retried, one recipe persisted."
