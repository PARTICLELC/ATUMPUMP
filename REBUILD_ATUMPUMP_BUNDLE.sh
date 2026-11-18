#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$HOME/ATUMPUMP"
GAME="$ROOT/ATUMPUMP_A_LIST"
OUT="$ROOT/ATUMPUMP_INSTALLER"
STAGE="$OUT/stage"
PACKAGES="$OUT/packages"

SERVICES_SOURCE="$ROOT/src/geckoterminal_liquidity.mjs"
GAME_SOURCE="$GAME/src/cli.js"

echo "=============================================="
echo " ATUMPUMP TWO-PRODUCT BUNDLE BUILDER"
echo "=============================================="

# ------------------------------------------------
# 1. VALIDATE SOURCE INSTALLATION
# ------------------------------------------------

[ -d "$ROOT" ] || {
  echo "ERROR: ATUMPUMP root not found."
  exit 1
}

[ -f "$SERVICES_SOURCE" ] || {
  echo "ERROR: GeckoTerminal service source missing."
  exit 1
}

[ -f "$GAME_SOURCE" ] || {
  echo "ERROR: A-LIST game source missing."
  exit 1
}

command -v dpkg-deb >/dev/null 2>&1 || pkg install -y dpkg
command -v sqlite3 >/dev/null 2>&1 || pkg install -y sqlite

# ------------------------------------------------
# 2. CREATE BUILD DIRECTORIES
# ------------------------------------------------

mkdir -p "$PACKAGES"

# Remove only previous build staging files.
# Never remove live application data.
rm -rf "$STAGE"

mkdir -p \
  "$STAGE/services/DEBIAN" \
  "$STAGE/game/DEBIAN"

SERVICE_ROOT="$STAGE/services/data/data/com.termux/files/home/ATUMPUMP"
GAME_ROOT="$STAGE/game/data/data/com.termux/files/home/ATUMPUMP/ATUMPUMP_A_LIST"

mkdir -p "$SERVICE_ROOT/src"
mkdir -p "$GAME_ROOT"

# ------------------------------------------------
# 3. PRODUCT ONE: SERVICES
# ------------------------------------------------

install -m 755 "$SERVICES_SOURCE" \
  "$SERVICE_ROOT/src/geckoterminal_liquidity.mjs"

cat > "$STAGE/services/DEBIAN/control" <<'EOF'
Package: atumpump-services
Version: 2.1.0
Architecture: all
Maintainer: ATUMPUMP
Depends: nodejs
Description: ATUMPUMP market data services
EOF

# ------------------------------------------------
# 4. PRODUCT TWO: A-LIST GAME
# ------------------------------------------------

# Copy application files, excluding live runtime state.
# Existing database/config/log files stay outside package.

tar -C "$GAME" \
  --exclude='./data' \
  --exclude='./logs' \
  --exclude='./node_modules' \
  --exclude='./.env*' \
  --exclude='*/.env*' \
  --exclude='./.git' \
  -cf - . | tar -C "$GAME_ROOT" -xf -

cat > "$STAGE/game/DEBIAN/control" <<'EOF'
Package: atumpump-alist-game
Version: 2.1.0
Architecture: all
Maintainer: ATUMPUMP
Depends: nodejs
Description: ATUMPUMP A-LIST championship game
EOF

# ------------------------------------------------
# 5. PACKAGE PERMISSIONS
# ------------------------------------------------

chmod 755 "$STAGE/services/DEBIAN"
chmod 755 "$STAGE/game/DEBIAN"

chmod 644 "$STAGE/services/DEBIAN/control"
chmod 644 "$STAGE/game/DEBIAN/control"

# ------------------------------------------------
# 6. BUILD TWO INDEPENDENT PACKAGES
# ------------------------------------------------

echo
echo "BUILDING SERVICES PACKAGE"

dpkg-deb --build --root-owner-group \
  "$STAGE/services" \
  "$PACKAGES/atumpump-services.deb"

echo
echo "BUILDING A-LIST GAME PACKAGE"

dpkg-deb --build --root-owner-group \
  "$STAGE/game" \
  "$PACKAGES/atumpump-alist-game.deb"

# ------------------------------------------------
# 7. UPGRADE-SAFE SETUP PROGRAM
# ------------------------------------------------

cat > "$OUT/UPGRADE_SAFE_SETUP.sh" <<'UPGRADE'
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
UPGRADE

chmod 755 "$OUT/UPGRADE_SAFE_SETUP.sh"

# ------------------------------------------------
# 8. MAIN INSTALLATION CENTER
# ------------------------------------------------

cat > "$OUT/INSTALL_ATUMPUMP.sh" <<'INSTALL'
#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$HOME/ATUMPUMP"
OUT="$ROOT/ATUMPUMP_INSTALLER"
PACKAGES="$OUT/packages"
UPGRADE="$OUT/UPGRADE_SAFE_SETUP.sh"

install_product() {
  local PACKAGE="$1"
  local FILE="$PACKAGES/$PACKAGE"

  [ -f "$FILE" ] || {
    echo "PACKAGE NOT FOUND: $FILE"
    return 1
  }

  echo
  echo "INSTALLING: $PACKAGE"

  dpkg -i "$FILE"
}

verify_products() {
  echo
  echo "=============================================="
  echo " PRODUCT INSTALLATION STATUS"
  echo "=============================================="

  dpkg-query -W -f='${Package} ${Version} ${Status}\n' \
    atumpump-services atumpump-alist-game 2>/dev/null || true

  echo
  bash "$UPGRADE" --help >/dev/null 2>&1 || true

  [ -f "$ROOT/src/geckoterminal_liquidity.mjs" ] \
    && echo "[OK] Services files" \
    || echo "[MISSING] Services files"

  [ -f "$ROOT/ATUMPUMP_A_LIST/src/cli.js" ] \
    && echo "[OK] Game files" \
    || echo "[MISSING] Game files"

  [ -f "$ROOT/data/atumpump.sqlite" ] \
    && echo "[OK] Main database" \
    || echo "[INFO] Main database not present"

  [ -f "$ROOT/ATUMPUMP_A_LIST/data/a_list.sqlite" ] \
    && echo "[OK] A-LIST database" \
    || echo "[INFO] A-LIST database not present"

  [ -f "$ROOT/ATUMPUMP_A_LIST/.env" ] \
    && echo "[OK] Existing .env" \
    || echo "[MISSING] Existing .env"

  [ -f "$HOME/.termux/boot/atumpump-start.sh" ] \
    && echo "[OK] Autostart configured" \
    || echo "[INFO] Autostart not configured"
}

while true; do
  clear

  echo "=============================================="
  echo "       ATUMPUMP INSTALLATION CENTER"
  echo "=============================================="
  echo
  echo " SOFTWARE PRODUCTS"
  echo
  echo "  1. Install ATUMPUMP Services"
  echo "  2. Install ATUMPUMP A-LIST Game"
  echo "  3. Install Complete Two-Product Bundle"
  echo
  echo " UPGRADE-SAFE OPERATIONS"
  echo
  echo "  4. Configure Autostart / Database Setup"
  echo "  5. Verify Installation"
  echo "  6. Exit"
  echo

  read -r -p "Select installation option: " CHOICE

  case "$CHOICE" in
    1)
      install_product atumpump-services.deb
      read -r -p "Press ENTER to continue..."
      ;;
    2)
      install_product atumpump-alist-game.deb
      read -r -p "Press ENTER to continue..."
      ;;
    3)
      install_product atumpump-services.deb
      install_product atumpump-alist-game.deb
      read -r -p "Press ENTER to continue..."
      ;;
    4)
      bash "$UPGRADE"
      ;;
    5)
      verify_products
      read -r -p "Press ENTER to continue..."
      ;;
    6) exit 0 ;;
    *)
      echo "Invalid selection."
      sleep 1
      ;;
  esac
done
INSTALL

chmod 755 "$OUT/INSTALL_ATUMPUMP.sh"

# ------------------------------------------------
# 9. VALIDATE ALL BUILT ARTIFACTS
# ------------------------------------------------

echo
echo "CHECKING SHELL SYNTAX"

bash -n "$OUT/INSTALL_ATUMPUMP.sh"
bash -n "$OUT/UPGRADE_SAFE_SETUP.sh"

echo "[OK] Installer syntax"
echo "[OK] Upgrade setup syntax"

echo
echo "CHECKING PACKAGE CONTENTS"

dpkg-deb --info "$PACKAGES/atumpump-services.deb"
dpkg-deb --info "$PACKAGES/atumpump-alist-game.deb"

echo
echo "CHECKING DATABASE/SECRET EXCLUSIONS"

if dpkg-deb -c "$PACKAGES/atumpump-alist-game.deb" |
  grep -E '(\.sqlite|/\.env|/logs/|/node_modules/)'; then
  echo "ERROR: Runtime state or secrets found in game package."
  exit 1
else
  echo "[OK] No database, .env, logs, or node_modules packaged."
fi

echo
echo "=============================================="
echo " ATUMPUMP BUNDLE BUILD COMPLETE"
echo "=============================================="
echo
echo "PRODUCT 1:"
echo "$PACKAGES/atumpump-services.deb"
echo
echo "PRODUCT 2:"
echo "$PACKAGES/atumpump-alist-game.deb"
echo
echo "INSTALLER:"
echo "$OUT/INSTALL_ATUMPUMP.sh"
echo
echo "UPGRADE SETUP:"
echo "$OUT/UPGRADE_SAFE_SETUP.sh"
echo
echo "DATABASES PRESERVED."
echo "AUTOSTART REMAINS OPT-IN."
echo "DEXSCREENER DISCOVERY NOT STARTED."
