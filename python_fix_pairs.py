#!/usr/bin/env python3
"""python3 python_fix_pairs.py /path/to/atumpump.sqlite"""
import sys, sqlite3
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 python_fix_pairs.py /path/to/atumpump.sqlite")
        sys.exit(1)
    db_path = Path(sys.argv[1])
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = con.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    print("Tables:", ", ".join(tables))
    target = next((t for t in ["market_pair_observations","market_pairs","observations","pairs"] if t in tables), None)
    if not target:
        print("No pair table found"); sys.exit(1)
    cols = [r[1] for r in cur.execute(f"PRAGMA table_info({target})")]
    print(f"Table {target} ({cur.execute(f'SELECT COUNT(*) FROM {target}').fetchone()[0]} rows)")
    print("Columns:", ", ".join(cols))
    def find(*n):
        for x in n:
            if x in cols: return x
        return None
    mint = find("mint","token_address","address","pair_address")
    pair = find("pair_address","pairAddress","mint")
    price = find("price_usd","price_sol","price","last_price")
    symbol = find("symbol","base_token_symbol","ticker")
    name = find("name","base_token_name","token_name")
    time = find("observed_at","created_at","timestamp")
    sql = f"""SELECT
  COALESCE({mint or 'NULL'}) AS mint,
  COALESCE({pair or mint or 'NULL'}) AS pair_address,
  COALESCE({symbol or "'UNKNOWN'"}) AS symbol,
  COALESCE({name or "''"}) AS name,
  {price or 'NULL'} AS price,
  {time or 'NULL'} AS observed_at,
  'ATUMPUMP' AS source
FROM {target}
WHERE {price or '1'} > 0
ORDER BY {time or 'rowid'} DESC
LIMIT :limit;"""
    Path("config").mkdir(exist_ok=True)
    Path("config/module21.generated.sql").write_text(sql)
    print("\nWrote config/module21.generated.sql")
    print("\nAdd to .env:")
    print(f"A_LIST_MODE=live")
    print(f"A_LIST_SCAN_LIMIT=30000")
    print(f"ATUMPUMP_DB_PATH={db_path.resolve()}")
    print("MODULE21_SQL_FILE=./config/module21.generated.sql")

if __name__ == "__main__":
    main()
