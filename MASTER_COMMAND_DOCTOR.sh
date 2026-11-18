#!/usr/bin/env bash
# ATUMPUMP A-LIST MASTER COMMAND + DOCTOR
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data logs config run

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

CMD="${1:-help}"

doctor() {
  echo "=== A-LIST DOCTOR ==="
  echo "Node: $(node -v 2>/dev/null || echo MISSING)"
  echo "Mode: ${A_LIST_MODE:-demo (default)}"
  echo "Source DB: ${ATUMPUMP_DB_PATH:-NOT SET}"
  echo "SQL file: ${MODULE21_SQL_FILE:-./config/module21.example.sql}"
  echo "Scan limit: ${A_LIST_SCAN_LIMIT:-2000 (default)}"
  echo ""
  if [ "${A_LIST_MODE:-demo}" != "live" ]; then
    echo "WARNING: Not in live mode. Demo only has 36 synthetic pairs."
  fi
  if [ -z "${ATUMPUMP_DB_PATH:-}" ] || [ ! -f "${ATUMPUMP_DB_PATH}" ]; then
    echo "ERROR: ATUMPUMP_DB_PATH missing or file not found."
  else
    echo "Source DB exists."
    node -e "
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.env.ATUMPUMP_DB_PATH, {readOnly:true});
      const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r=>r.name);
      console.log('Tables:', tables.join(', '));
      for (const t of ['market_pairs','market_pair_observations','pairs']) {
        if (tables.includes(t)) console.log('  '+t+':', db.prepare('SELECT COUNT(*) n FROM '+t).get().n);
      }
      db.close();
    " || true
  fi
  echo ""
  echo "Recommended:"
  echo "A_LIST_MODE=live"
  echo "A_LIST_SCAN_LIMIT=30000"
  echo "Run: ./MASTER_COMMAND_DOCTOR.sh fix"
}

fix() {
  echo "=== APPLYING FIXES ==="
  touch .env
  grep -q '^A_LIST_MODE=' .env || echo 'A_LIST_MODE=live' >> .env
  grep -q '^A_LIST_SCAN_LIMIT=' .env || echo 'A_LIST_SCAN_LIMIT=30000' >> .env
  mkdir -p config
  cat > config/module21.sql << 'SQL'
SELECT
  COALESCE(mint, token_address, address, pair_address) AS mint,
  COALESCE(pair_address, pairAddress, mint) AS pair_address,
  COALESCE(symbol, base_token_symbol, ticker, 'UNKNOWN') AS symbol,
  COALESCE(name, base_token_name, token_name, '') AS name,
  COALESCE(price_usd, price_sol, price, last_price) AS price,
  COALESCE(observed_at, created_at, timestamp) AS observed_at,
  'ATUMPUMP_MODULE_21' AS source
FROM market_pair_observations
WHERE COALESCE(price_usd, price_sol, price) > 0
  AND COALESCE(pair_address, mint, token_address) IS NOT NULL
ORDER BY COALESCE(observed_at, created_at) DESC
LIMIT :limit;
SQL
  echo "Created config/module21.sql"
  echo "Set ATUMPUMP_DB_PATH in .env then run: ./MASTER_COMMAND_DOCTOR.sh status"
}

case "$CMD" in
  doctor) doctor ;;
  fix) fix ;;
  install|check|demo|start|status|dashboard|test)
    node src/cli.js "$CMD" ;;
  *) echo "Usage: $0 {doctor|fix|install|check|demo|start|status|dashboard|test}" ;;
esac
