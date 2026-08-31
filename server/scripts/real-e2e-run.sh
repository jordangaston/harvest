#!/bin/bash
set -uo pipefail
CHEF="+14156055508"; DB="file:$HOME/Library/Messages/chat.db?mode=ro"; LIKE='%4156055508%'
send() { osascript - "$CHEF" "$1" >/dev/null <<'OSA'
on run {target, msg}
  tell application "Messages"
    set svc to 1st service whose service type = iMessage
    send msg to buddy target of svc
  end tell
end run
OSA
}
turn() {
  local msg="$1"; local before
  before=$(sqlite3 "$DB" "SELECT COALESCE(MAX(m.ROWID),0) FROM message m JOIN handle h ON m.handle_id=h.ROWID WHERE h.id LIKE '$LIKE';")
  send "$msg"; local t0=$(date +%s) r=""
  echo ""; echo "🧑 $msg"
  for _ in $(seq 1 90); do   # up to ~270s
    sleep 3
    r=$(sqlite3 "$DB" "SELECT m.text FROM message m JOIN handle h ON m.handle_id=h.ROWID WHERE h.id LIKE '$LIKE' AND m.ROWID>$before AND m.is_from_me=0 AND m.text IS NOT NULL ORDER BY m.ROWID;")
    [ -n "$r" ] && break
  done
  sleep 6  # trailing bubbles
  sqlite3 "$DB" "SELECT m.text FROM message m JOIN handle h ON m.handle_id=h.ROWID WHERE h.id LIKE '$LIKE' AND m.ROWID>$before AND m.is_from_me=0 AND m.text IS NOT NULL ORDER BY m.ROWID;" | sed 's/^/🧑‍🍳 • /'
  echo "⏱  $(( $(date +%s) - t0 ))s"
}
turn "hey"
turn "It's me Jordan and my wife Sam, we cook together"
turn "We want quick healthy weeknight dinners. We shop at Whole Foods, budget about \$150 a week"
turn "We shop on Sundays, cook about 4 nights a week, plan for 5 dinners, and we like to keep dinners under 30 minutes"
turn "We have an instant pot and an air fryer, and we eat leftovers"
turn "For me, Jordan — peanut allergy, severe. No special diet. I love Thai food and grilled chicken, hate cilantro. Intermediate cook."
turn "Sam has no allergies. She is a flexible pescatarian — fish always, meat once in a while. Loves salmon and pasta, dislikes mushrooms. Beginner cook."
turn "That covers everyone, thanks!"
echo ""; echo "==== DONE ===="
