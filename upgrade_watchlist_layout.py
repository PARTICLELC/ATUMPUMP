from pathlib import Path

file = Path("src/control_center.mjs")
source = file.read_text()

start = source.index("function watchlist() {")
end = source.find("\nfunction ", start + 1)

if end == -1:
    raise SystemExit("STOP: Could not locate end of watchlist().")

new_function = r'''function watchlist() {
  title("04 — CHAMPIONSHIP WATCHLIST");

  if (!exists("championship_watchlist")) {
    return console.log("Watchlist table unavailable.");
  }

  const rows = DB.prepare(`
    SELECT
      w.*,
      t.name AS token_name,
      t.symbol AS token_symbol,
      (
        SELECT mpo.price_sol * COALESCE(
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
              AND po.observed_at <= mpo.observed_at
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          ),
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          )
        )
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS price_usd,
      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS volume_h24,
      (
        SELECT mpo.market_cap
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.market_cap > 0
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS market_cap
    FROM championship_watchlist w
    LEFT JOIN tokens t ON t.mint = w.mint
    ORDER BY w.rowid DESC
  `).all();

  if (!rows.length) {
    console.log("Championship watchlist is empty.");
    return;
  }

  const money = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? "$" + number.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }) + " USD"
      : "WAITING FOR DATA";
  };

  for (const row of rows) {
    console.log("--------------------------------------------");
    console.log(`TOKEN NAME: ${row.token_name || "NAME NOT REGISTERED"}`);
    console.log(`TOKEN TICKER: ${row.token_symbol || "TICKER NOT REGISTERED"}`);
    console.log(`CURRENT TOKEN VALUE: ${money(row.price_usd)}`);
    console.log(`TOTAL 24H TRADING VOLUME: ${money(row.volume_h24)}`);
    console.log(`MARKET CAPITALIZATION: ${money(row.market_cap)}`);
    console.log(`MINT: ${row.mint}`);
    console.log(`ADDED AT: ${row.added_at}`);
    console.log(`REASON: ${row.reason}`);
  }
}
'''

source = source[:start] + new_function + source[end:]
file.write_text(source)
print("[APPLIED] Watchlist now matches Champion Holder market-data layout.")
