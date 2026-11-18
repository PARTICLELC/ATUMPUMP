from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("function rollingUsdMovers()")
end = s.index("\nfunction leaderboard()", start)

replacement = r'''
function rollingUsdMovers() {
  const end = Date.now();
  const start = end - 432000;

  return DB.prepare(`
    WITH observations AS (
      SELECT
        mpo.mint,
        mpo.pair_address,
        mpo.observed_at,
        mpo.price_sol * (
          SELECT po.sol_usd
          FROM price_observations po
          WHERE po.sol_usd > 0
            AND po.observed_at <= mpo.observed_at
          ORDER BY po.observed_at DESC, po.id DESC
          LIMIT 1
        ) AS price_usd,
        ROW_NUMBER() OVER (
          PARTITION BY mpo.mint, mpo.pair_address
          ORDER BY mpo.observed_at ASC
        ) AS first_rank,
        ROW_NUMBER() OVER (
          PARTITION BY mpo.mint, mpo.pair_address
          ORDER BY mpo.observed_at DESC
        ) AS last_rank,
        COUNT(*) OVER (
          PARTITION BY mpo.mint, mpo.pair_address
        ) AS samples
      FROM market_pair_observations mpo
      WHERE mpo.price_sol > 0
        AND mpo.pair_address IS NOT NULL
        AND mpo.observed_at BETWEEN ? AND ?
    ),
    movements AS (
      SELECT
        mint,
        pair_address,
        MAX(CASE WHEN first_rank = 1 THEN price_usd END) AS window_opening_usd,
        MAX(CASE WHEN last_rank = 1 THEN price_usd END) AS current_price_usd,
        MAX(samples) AS sample_count
      FROM observations
      GROUP BY mint, pair_address
      HAVING MAX(CASE WHEN first_rank = 1 THEN price_usd END) > 0
         AND MAX(CASE WHEN last_rank = 1 THEN price_usd END) > 0
         AND MAX(samples) >= 2
    ),
    active_round AS (
      SELECT id
      FROM rounds
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
    )
    SELECT
      m.mint,
      t.symbol,
      t.name,
      m.pair_address,
      COALESCE(
        NULLIF(re.opening_price_usd, 0),
        m.window_opening_usd
      ) AS opening_price_usd,
      m.current_price_usd,
      m.current_price_usd - COALESCE(
        NULLIF(re.opening_price_usd, 0),
        m.window_opening_usd
      ) AS movement_usd,
      (
        (m.current_price_usd - COALESCE(
          NULLIF(re.opening_price_usd, 0),
          m.window_opening_usd
        )) / COALESCE(
          NULLIF(re.opening_price_usd, 0),
          m.window_opening_usd
        )
      ) * 100 AS movement_percent,
      m.sample_count
    FROM movements m
    LEFT JOIN active_round ar ON 1 = 1
    LEFT JOIN round_entries re
      ON re.round_id = ar.id
     AND re.mint = m.mint
    LEFT JOIN tokens t ON t.mint = m.mint
    ORDER BY movement_percent DESC
    LIMIT 10
  `).all(start, end);
}
'''

s = s[:start] + replacement + s[end:]
p.write_text(s)
print("[RESTORED] Module 02 includes all observed pairs; no active-round inner filter.")
