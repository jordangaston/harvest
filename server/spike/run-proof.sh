#!/usr/bin/env bash
# SPIKE proof runner — drives the FaaS-lifecycle emulation as SEPARATE OS
# processes so cold starts and the freeze are real, not simulated in one process.
#
# OFFLINE: NODE_ENV=test + no provider API keys => the test suite's stubs are
# selected, no network. Real local Postgres, real DBOS 4.25.14 recovery.
set -euo pipefail
cd "$(dirname "$0")/.."

# Offline env: local Postgres, no APIFY/GROQ/DEEPSEEK/etc. keys => stubs.
export NODE_ENV=test
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/harvest"
export DBOS_SYSTEM_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/harvest_dbos"
JOBFILE="$(mktemp)"
RUN="npx tsx spike/faas-emulation.ts"

echo "==================================================================="
echo " Harvest serverless spike — FaaS lifecycle proof (DBOS 4.25.14)"
echo "==================================================================="

echo; echo "## 0. reset (clean ledger + migrated app schema)"
$RUN reset

echo; echo "## 1. COLD START — what every FaaS cold invocation pays"
$RUN coldstart

echo; echo "## 2. FREEZE — intake starts the import workflow, then the function"
echo "##    is frozen the instant it returns 202 (process.exit, no shutdown)"
$RUN freeze "$JOBFILE"

echo; echo "## 3. OBSERVE — stranded state (no worker exists to run it)"
$RUN observe "$JOBFILE"

echo; echo "## 4. RECOVER — a long-lived worker boots; DBOS auto-recovers the"
echo "##    pending workflow and runs it to completion"
$RUN recover "$JOBFILE"

echo; echo "## 5. OBSERVE again — the worker finished the job"
$RUN observe "$JOBFILE"

rm -f "$JOBFILE"
echo; echo "== proof complete =="
