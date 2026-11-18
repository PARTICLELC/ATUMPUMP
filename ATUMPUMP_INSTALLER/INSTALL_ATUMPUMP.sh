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
