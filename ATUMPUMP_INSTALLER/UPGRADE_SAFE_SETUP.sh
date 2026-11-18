#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$HOME/ATUMPUMP"
GAME="$ROOT/ATUMPUMP_A_LIST"
BACKUP="$ROOT/backups/installer"

STAMP="$(date +%Y%m%d_%H%M%S)"
BOOT="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT/atumpump-start.sh"

mkdir -p "$BACKUP"

pause() {
  echo
  read -r -p "Press ENTER to continue..."
}

# ----------------------------------------------
# CONSISTENT SQLITE BACKUP
# ----------------------------------------------

backup_one() {
  local DB="$1"
  local NAME="$2"
  local DEST="$3"

  [ -f "$DB" ] || {
    echo "[SKIP] Database not found: $DB"
    return 0
  }

  mkdir -p "$(dirname "$DEST")"

  echo "Backing up $NAME"

  sqlite3 "$DB" ".backup '$DEST'"

  sqlite3 "$DEST" "PRAGMA integrity_check;" |
    grep -qx "ok" || {
      echo "BACKUP INTEGRITY FAILURE: $DEST"
      return 1
    }

  echo "[BACKUP OK] $DEST"
}

backup_databases() {
  local DIR="$BACKUP/$STAMP"
  mkdir -p "$DIR"

  backup_one \
    "$ROOT/data/atumpump.sqlite" \
    "ATUMPUMP main database" \
    "$DIR/atumpump.sqlite"

  backup_one \
    "$GAME/data/a_list.sqlite" \
    "A-LIST game database" \
    "$DIR/a_list.sqlite"

  echo
  echo "BACKUP DIRECTORY: $DIR"
}

# ----------------------------------------------
# DATABASE VALIDATION
# ----------------------------------------------

validate_database() {
  local DB="$1"
  local NAME="$2"

  if [ ! -f "$DB" ]; then
    echo "[NOT PRESENT] $NAME"
    return 0
  fi

  echo
  echo "VALIDATING: $NAME"

  sqlite3 "$DB" "PRAGMA integrity_check;" |
    grep -qx "ok" || {
      echo "[FAILED] $NAME integrity check"
      return 1
    }

  echo "[OK] $NAME integrity check"
}

validate_databases() {
  validate_database \
    "$ROOT/data/atumpump.sqlite" \
    "ATUMPUMP main database"

  validate_database \
    "$GAME/data/a_list.sqlite" \
    "A-LIST database"

  echo
  echo "DATABASE VALIDATION COMPLETE."
  echo "No database schema was modified."
}

# ----------------------------------------------
# EXPLICIT AUTOSTART CONFIGURATION
# ----------------------------------------------

configure_autostart() {
  if [ ! -f "$ROOT/src/geckoterminal_liquidity.mjs" ]; then
    echo "ERROR: Services product is not installed."
    return 1
  fi

  if [ ! -f "$GAME/src/cli.js" ]; then
    echo "ERROR: A-LIST game product is not installed."
    return 1
  fi

  if [ ! -f "$GAME/.env" ]; then
    echo "ERROR: Existing A-LIST .env is missing."
    echo "Autostart was not configured."
    return 1
  fi

  mkdir -p "$BOOT"

  if [ -f "$BOOT_SCRIPT" ]; then
    cp -p "$BOOT_SCRIPT" "$BOOT_SCRIPT.backup.$STAMP"
  fi

  cat > "$BOOT_SCRIPT" <<'BOOTFILE'
#!/data/data/com.termux/files/usr/bin/bash
set -u

export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"

ROOT="$HOME/ATUMPUMP"
GAME="$ROOT/ATUMPUMP_A_LIST"

mkdir -p "$ROOT/logs" "$GAME/logs"

# GeckoTerminal exact-held-pair market service.
if [ -f "$ROOT/src/geckoterminal_liquidity.mjs" ]; then
  if ! pgrep -f '[g]eckoterminal_liquidity.mjs' >/dev/null 2>&1; then
    (
      cd "$ROOT"
      nohup node src/geckoterminal_liquidity.mjs \
        >> "$ROOT/logs/geckoterminal_liquidity.log" 2>&1 </dev/null &
    )
  fi
fi

# A-LIST live game engine.
if [ -f "$GAME/src/cli.js" ] && [ -f "$GAME/.env" ]; then
  if ! pgrep -f '[s]rc/cli.js start' >/dev/null 2>&1; then
    (
      cd "$GAME"
      nohup node --env-file=.env src/cli.js start \
        >> "$GAME/logs/live_engine.log" 2>&1 </dev/null &
    )
  fi
fi

# DexScreener-dependent discovery intentionally excluded.
BOOTFILE

  chmod 700 "$BOOT_SCRIPT"

  echo
  echo "AUTOSTART CONFIGURED:"
  echo "$BOOT_SCRIPT"
  echo
  echo "Termux:Boot Android application must be installed."
}

# ----------------------------------------------
# VERIFY PRODUCTS AND CONFIGURATION
# ----------------------------------------------

verify_installation() {
  echo
  echo "=============================================="
  echo " ATUMPUMP INSTALLATION VERIFICATION"
  echo "=============================================="

  [ -f "$ROOT/src/geckoterminal_liquidity.mjs" ] \
    && echo "[OK] ATUMPUMP Services" \
    || echo "[MISSING] ATUMPUMP Services"

  [ -f "$GAME/src/cli.js" ] \
    && echo "[OK] A-LIST Game" \
    || echo "[MISSING] A-LIST Game"

  [ -f "$ROOT/data/atumpump.sqlite" ] \
    && echo "[OK] Main database present" \
    || echo "[INFO] Main database absent"

  [ -f "$GAME/data/a_list.sqlite" ] \
    && echo "[OK] A-LIST database present" \
    || echo "[INFO] A-LIST database absent"

  [ -f "$GAME/.env" ] \
    && echo "[OK] A-LIST configuration present" \
    || echo "[MISSING] A-LIST configuration"

  [ -f "$BOOT_SCRIPT" ] \
    && echo "[OK] Autostart configured" \
    || echo "[NOT CONFIGURED] Autostart"
}

# ----------------------------------------------
# MENU
# ----------------------------------------------

while true; do
  clear

  echo "=============================================="
  echo " ATUMPUMP UPGRADE-SAFE SETUP"
  echo "=============================================="
  echo
  echo "  1. Configure service autostart"
  echo "  2. Backup existing databases"
  echo "  3. Validate existing databases"
  echo "  4. Backup + validate databases"
  echo "  5. Verify installed products"
  echo "  6. Exit"
  echo

  read -r -p "Select option: " CHOICE

  case "$CHOICE" in
    1) configure_autostart; pause ;;
    2) backup_databases; pause ;;
    3) validate_databases; pause ;;
    4)
      backup_databases
      validate_databases
      pause
      ;;
    5) verify_installation; pause ;;
    6) exit 0 ;;
    *) echo "Invalid selection."; sleep 1 ;;
  esac
done
