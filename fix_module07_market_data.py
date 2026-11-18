from pathlib import Path

path = Path("src/control_center.mjs")
source = path.read_text()

old = '''    SELECT o.mint, t.name, t.symbol,
      t.volume_h24, t.market_cap,
      o.opening_price, c.current_price,
      c.current_price-o.opening_price AS movement_sol
    FROM opening o
    JOIN closing c USING(mint)
    LEFT JOIN tokens t ON t.mint=o.mint'''

new = '''    SELECT o.mint, t.name, t.symbol,
      (
        SELECT mp.volume_h24
        FROM market_pairs mp
        WHERE mp.mint = o.mint
        ORDER BY COALESCE(mp.liquidity_updated_at, mp.last_seen_at, mp.first_seen_at) DESC
        LIMIT 1
      ) AS volume_h24,
      (
        SELECT mp.market_cap
        FROM market_pairs mp
        WHERE mp.mint = o.mint
        ORDER BY COALESCE(mp.liquidity_updated_at, mp.last_seen_at, mp.first_seen_at) DESC
        LIMIT 1
      ) AS market_cap,
      o.opening_price, c.current_price,
      c.current_price-o.opening_price AS movement_sol
    FROM opening o
    JOIN closing c USING(mint)
    LEFT JOIN tokens t ON t.mint=o.mint'''

if old not in source:
    raise SystemExit("[STOP] Expected Module 07 SQL not found. No changes written.")

source = source.replace(old, new, 1)
path.write_text(source)
print("[FIXED] Module 07 now reads volume and market cap from market_pairs.")
