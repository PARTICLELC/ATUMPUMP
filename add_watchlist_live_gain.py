from pathlib import Path

file = Path("src/control_center.mjs")
source = file.read_text()

start = source.index("function watchlist() {")
end = source.find("\nfunction ", start + 1)

if end == -1:
    raise SystemExit("STOP: Could not locate watchlist function boundary.")

section = source[start:end]

marker = "      ) AS price_usd,"
if marker not in section:
    raise SystemExit("STOP: Could not locate price_usd query.")

addition = """      ) AS price_usd,
      (
        SELECT mpo.price_sol
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.price_sol > 0
          AND mpo.observed_at >= w.added_at
        ORDER BY mpo.observed_at ASC, mpo.id ASC
        LIMIT 1
      ) AS entry_price_sol,
      (
        SELECT mpo.price_sol
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.price_sol > 0
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS latest_price_sol,"""

section = section.replace(marker, addition, 1)

display_marker = '    console.log(`CURRENT TOKEN VALUE: ${money(row.price_usd)}`);'
if display_marker not in section:
    raise SystemExit("STOP: Could not locate CURRENT TOKEN VALUE display.")

display_addition = display_marker + """
    const entryPrice = Number(row.entry_price_sol);
    const latestPrice = Number(row.latest_price_sol);
    const liveGain = Number.isFinite(entryPrice) && entryPrice > 0 &&
      Number.isFinite(latestPrice) && latestPrice > 0
      ? ((latestPrice / entryPrice) - 1) * 100
      : null;
    console.log(`LIVE GAIN PERCENTAGE: ${
      liveGain === null
        ? "WAITING FOR PRICE HISTORY"
        : (liveGain > 0 ? "+" : "") + liveGain.toFixed(2) + "%"
    }`);"""

section = section.replace(display_marker, display_addition, 1)

source = source[:start] + section + source[end:]
file.write_text(source)

print("[APPLIED] Watchlist LIVE GAIN PERCENTAGE.")
