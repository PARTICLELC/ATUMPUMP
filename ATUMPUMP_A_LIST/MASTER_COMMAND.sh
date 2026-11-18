#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data logs

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

CMD="${1:-help}"
case "$CMD" in
  install)
    node src/cli.js install
    ;;
  check)
    node src/cli.js check
    ;;
  demo)
    A_LIST_MODE=demo node src/cli.js demo
    ;;
  start)
    node src/cli.js start
    ;;
  status)
    node src/cli.js status
    ;;
  dashboard)
    node src/cli.js dashboard
    ;;
  test)
    node --test
    ;;
  stop)
    if [ -f run/a_list.pid ]; then
      PID="$(cat run/a_list.pid)"
      kill "$PID" 2>/dev/null || true
      rm -f run/a_list.pid
      echo "A-LIST service stop requested."
    else
      echo "No A-LIST PID file."
    fi
    ;;
  pack)
    cd ..
    zip -qr ATUMPUMP_A_LIST.zip ATUMPUMP_A_LIST -x '*/data/*.sqlite*' '*/logs/*' '*/run/*' '*/.env'
    echo "Created ../ATUMPUMP_A_LIST.zip"
    ;;
  help|*)
    echo "ATUMPUMP A-LIST MASTER COMMAND"
    echo "Usage: ./MASTER_COMMAND.sh {install|check|demo|start|status|dashboard|test|stop|pack}"
    ;;
esac
