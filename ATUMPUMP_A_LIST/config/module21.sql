SELECT
  o.mint,
  o.pair_address,
  COALESCE(t.symbol, 'UNKNOWN') AS symbol,
  COALESCE(t.name, '') AS name,
  o.price_sol AS price,
  o.observed_at,
  'ATUMPUMP_MODULE_21' AS source
FROM market_pair_observations o
JOIN market_pairs mp
  ON mp.mint = o.mint
 AND mp.pair_address = o.pair_address
LEFT JOIN tokens t ON t.mint = o.mint
WHERE mp.active = 1
  AND o.price_sol > 0
  AND o.observed_at > :since
ORDER BY o.observed_at DESC
LIMIT :limit;
