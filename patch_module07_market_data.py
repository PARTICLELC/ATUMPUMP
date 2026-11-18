from pathlib import Path

path = Path("src/control_center.mjs")
source = path.read_text()

old_sql = '''    SELECT o.mint, t.name, t.symbol,
      o.opening_price, c.current_price,
      c.current_price-o.opening_price AS movement_sol
    FROM opening o'''

new_sql = '''    SELECT o.mint, t.name, t.symbol,
      t.volume_h24, t.market_cap,
      o.opening_price, c.current_price,
      c.current_price-o.opening_price AS movement_sol
    FROM opening o'''

old_display = '''    field("SOL MOVEMENT", `${movementColor}${formatSol(row.movement_sol)} SOL${C.reset}`);
    field("FULL MINT ADDRESS", row.mint);'''

new_display = '''    field("SOL MOVEMENT", `${movementColor}${formatSol(row.movement_sol)} SOL${C.reset}`);
    field("24H TRADING VOLUME", `${money(row.volume_h24)} USD`);
    field("MARKET CAPITALIZATION", `${money(row.market_cap)} USD`);
    field("FULL MINT ADDRESS", row.mint);'''

if old_sql not in source:
    raise SystemExit("[STOP] Module 07 SQL target not found. No changes written.")

if old_display not in source:
    raise SystemExit("[STOP] Module 07 display target not found. No changes written.")

source = source.replace(old_sql, new_sql, 1)
source = source.replace(old_display, new_display, 1)

path.write_text(source)
print("[APPLIED] Module 07 now displays 24H volume and market capitalization.")
