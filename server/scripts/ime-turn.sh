#!/bin/bash
# Real iMessage e2e turn: send a user message to the chef line from THIS Mac's number,
# then read the chef's reply from the Messages DB. Automates the "user" side of the smoke test.
#
#   bash scripts/ime-turn.sh "just me and my partner, two adults"
#
# Requires: Full Disk Access (read chat.db) + Automation→Messages (osascript send) for the host app.
set -euo pipefail
CHEF="+14156055508"
DB="file:$HOME/Library/Messages/chat.db?mode=ro"   # NO immutable — must respect the -wal
LIKE='%4156055508%'
MSG="$*"

before=$(sqlite3 "$DB" "SELECT COALESCE(MAX(m.ROWID),0) FROM message m JOIN handle h ON m.handle_id=h.ROWID WHERE h.id LIKE '$LIKE';")

osascript - "$CHEF" "$MSG" <<'OSA'
on run {target, msg}
  tell application "Messages"
    set svc to 1st service whose service type = iMessage
    send msg to buddy target of svc
  end tell
end run
OSA
echo "🧑 sent: $MSG  (marker $before)"

# Poll for the chef's reply. It sends several bubbles over a few seconds, so once the first
# arrives, wait a beat and re-read to capture the whole batch.
reply=""
for _ in $(seq 1 40); do
  sleep 2
  reply=$(sqlite3 "$DB" "SELECT m.text FROM message m JOIN handle h ON m.handle_id=h.ROWID WHERE h.id LIKE '$LIKE' AND m.ROWID>$before AND m.is_from_me=0 AND m.text IS NOT NULL ORDER BY m.ROWID;")
  [ -n "$reply" ] && break
done
if [ -z "$reply" ]; then echo "(no chef reply within ~80s)"; exit 1; fi
sleep 5   # let trailing bubbles land
sqlite3 "$DB" "SELECT m.text FROM message m JOIN handle h ON m.handle_id=h.ROWID WHERE h.id LIKE '$LIKE' AND m.ROWID>$before AND m.is_from_me=0 AND m.text IS NOT NULL ORDER BY m.ROWID;" | sed 's/^/🧑‍🍳 • /'
