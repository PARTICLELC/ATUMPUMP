#!/data/data/com.termux/files/usr/bin/bash

cd "$HOME/ATUMPUMP" || exit 1

PID_FILE="logs/atumpump_watchdog.pid"
ENGINE_PID_FILE="logs/championship_engine.pid"
LOG="logs/championship_engine.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  exit 0
fi

echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

echo "[$(date)] ATUMPUMP 24/7 WATCHDOG ONLINE" >> "$LOG"

while true; do
  if ! pgrep -f '[n]ode src/championship_engine.mjs' >/dev/null; then
    echo "[$(date)] ENGINE DOWN — RESTARTING" >> "$LOG"
    node src/championship_engine.mjs >> "$LOG" 2>&1 &
    echo $! > "$ENGINE_PID_FILE"
  fi

  sleep 5
done
