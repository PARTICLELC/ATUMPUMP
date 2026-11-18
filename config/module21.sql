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
