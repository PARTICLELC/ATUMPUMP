from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("function championHolder()")
end = s.index("\nfunction watchlist()", start)

replacement = r'''
function championHolder() {
  title("03 — CHAMPION HOLDER");

  if (!exists("champion_holder")) {
    return console.log("Champion holder table unavailable.");
  }

  const rows = DB.prepare(`
    SELECT
      ch.*,
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
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS price_usd
    FROM champion_holder ch
    LEFT JOIN tokens t ON t.mint = ch.mint
  `).all();

  if (!rows.length) {
    console.log("No champion crowned yet.");
    return;
  }

  for (const row of rows) {
    const price = Number(row.price_usd);

    console.log(`${C.gold}🏆 CHAMPION HOLDER${C.reset}`);
    console.log("--------------------------------------------");
    console.log(`TOKEN NAME: ${row.token_name || "NAME NOT REGISTERED"}`);
    console.log(`TOKEN TICKER: ${row.token_symbol || "TICKER NOT REGISTERED"}`);
    console.log(`CURRENT TOKEN VALUE: ${
      Number.isFinite(price) && price > 0
        ? "$" + price.toExponential(10) + " USD"
        : "WAITING FOR PRICE DATA"
    }`);
    console.log(`MINT: ${row.mint}`);
    console.log(`SINCE: ${row.since_at}`);
    console.log(`ROUND: ${row.round_id}`);
  }
}
'''

s = s[:start] + replacement + s[end:]
p.write_text(s)
print("[APPLIED] Champion Holder now displays current token value in USD.")
