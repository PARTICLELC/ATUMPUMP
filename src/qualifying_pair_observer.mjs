import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/atumpump.sqlite");
db.exec("PRAGMA busy_timeout=15000");

const SOL = "So11111111111111111111111111111111111111112";
const INTERVAL = 10000;
const BATCH = 30;
const MIN_CAP = 230000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const num = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const candidates = db.prepare(`
  SELECT pair_address, mint, market_cap, price_sol,
         liquidity_usd, volume_h24, fdv
  FROM market_pairs
  WHERE active = 1
    AND quote_mint = ?
    AND CAST(COALESCE(market_cap, 0) AS REAL) >= ?
  ORDER BY CAST(market_cap AS REAL) DESC, last_seen_at DESC
`);

const upsert = db.prepare(`
  INSERT INTO market_pairs (
    pair_address, mint, dex_id, chain_id, quote_mint, pair_url,
    price_sol, liquidity_usd, volume_h24, fdv, market_cap,
    pair_created_at, first_seen_at, last_seen_at, active
  )
  VALUES (?, ?, ?, 'solana', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(pair_address) DO UPDATE SET
    mint = excluded.mint,
    dex_id = excluded.dex_id,
    quote_mint = excluded.quote_mint,
    pair_url = COALESCE(excluded.pair_url, market_pairs.pair_url),
    price_sol = excluded.price_sol,
    liquidity_usd = COALESCE(excluded.liquidity_usd, market_pairs.liquidity_usd),
    volume_h24 = COALESCE(excluded.volume_h24, market_pairs.volume_h24),
    fdv = COALESCE(excluded.fdv, market_pairs.fdv),
    market_cap = COALESCE(excluded.market_cap, market_pairs.market_cap),
    last_seen_at = excluded.last_seen_at,
    active = 1
`);

const pairObservation = db.prepare(`
  INSERT INTO market_pair_observations (
    pair_address, mint, observed_at, price_sol,
    liquidity_usd, volume_h24, fdv, market_cap
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const priceObservation = db.prepare(`
  INSERT INTO price_observations (
    mint, observed_at, price_sol, source, pair_address
  )
  VALUES (?, ?, ?, ?, ?)
`);

async function fetchPairs(mints) {
  const url =
    `https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`;

  let delay = 60000;

  while (true) {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000)
    });

    if (response.status === 429) {
      const retry = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retry) && retry > 0
        ? retry * 1000
        : delay;

      console.log(`[429] Observer waiting ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      delay = Math.min(delay * 2, 900000);
      continue;
    }

    if (!response.ok) {
      throw new Error(`DexScreener HTTP ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }
}

async function observe() {
  const rows = candidates.all(SOL, MIN_CAP);

  // Keep each qualifying pool distinct; use mint only for API batching.
  const eligibleCaps = new Map(
    rows.map(row => [row.pair_address, num(row.market_cap)])
  );
  const mints = [...new Set(rows.map(row => row.mint))];

  if (!mints.length) {
    console.log("[OBSERVER] No currently qualifying mints.");
    return;
  }

  let pairCount = 0;
  let observationCount = 0;
  let capCount = 0;
  let cachedCount = 0;
  const observedPairs = new Set();

  for (let offset = 0; offset < mints.length; offset += BATCH) {
    const batch = mints.slice(offset, offset + BATCH);
    const pairs = await fetchPairs(batch);
    const now = Date.now();

    db.exec("BEGIN");

    try {
      for (const pair of pairs) {
        const mint = pair.baseToken?.address;

        if (
          !mint ||
          !batch.includes(mint) ||
          pair.chainId !== "solana" ||
          pair.quoteToken?.address !== SOL ||
          !pair.pairAddress
        ) continue;

        const price = num(pair.priceNative);
        if (!price || price <= 0) continue;

        const responseMarketCap = num(pair.marketCap);
        const storedMarketCap = eligibleCaps.get(pair.pairAddress);

        // Only record pools whose actual market cap meets the floor.
        // Retain the stored cap when DexScreener omits marketCap.
        if (
          !(responseMarketCap !== null && responseMarketCap >= MIN_CAP) &&
          !(storedMarketCap !== undefined &&
            storedMarketCap !== null &&
            storedMarketCap >= MIN_CAP)
        ) continue;

        const marketCap = responseMarketCap ?? storedMarketCap;
        const liquidity = num(pair.liquidity?.usd);
        const volume = num(pair.volume?.h24);
        const fdv = num(pair.fdv);
        const created = num(pair.pairCreatedAt);

        upsert.run(
          pair.pairAddress,
          mint,
          pair.dexId ?? "unknown",
          SOL,
          pair.url ?? null,
          price,
          liquidity,
          volume,
          fdv,
          marketCap,
          created,
          now,
          now
        );

        pairObservation.run(
          pair.pairAddress,
          mint,
          now,
          price,
          liquidity,
          volume,
          fdv,
          marketCap
        );

        priceObservation.run(
          mint,
          now,
          price,
          `qualifying_observer:${pair.dexId ?? "unknown"}`,
          pair.pairAddress
        );

        observedPairs.add(pair.pairAddress);
        pairCount++;
        observationCount++;

        if (marketCap !== null && marketCap >= MIN_CAP) {
          capCount++;
        }
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    await sleep(1200);
  }

  // Sample every qualifying pair on each pass.
  // If the API omits a pair, record its last stored price without
  // fabricating a price change.
  const heartbeatAt = Date.now();

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      if (observedPairs.has(row.pair_address)) continue;

      const price = num(row.price_sol);
      const marketCap = num(row.market_cap);

      if (!row.pair_address || !row.mint ||
          price === null || price <= 0 ||
          marketCap === null || marketCap < MIN_CAP) continue;

      pairObservation.run(
        row.pair_address,
        row.mint,
        heartbeatAt,
        price,
        num(row.liquidity_usd),
        num(row.volume_h24),
        num(row.fdv),
        marketCap
      );

      priceObservation.run(
        row.mint,
        heartbeatAt,
        price,
        "qualifying_observer:stored_price_heartbeat",
        row.pair_address
      );

      cachedCount++;
      observationCount++;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const qualifiedPairs = db.prepare(`
    SELECT
      pair_address,
      mint,
      dex_id,
      market_cap,
      price_sol,
      liquidity_usd,
      last_seen_at
    FROM market_pairs
    WHERE active = 1
      AND quote_mint = ?
      AND market_cap >= ?
    ORDER BY market_cap DESC, last_seen_at DESC
  `).all(SOL, MIN_CAP);

  console.log("\\n========== ATUMPUMP QUALIFIED LIVE PAIRS | $230K+ ==========");

  if (!qualifiedPairs.length) {
    console.log("No currently recorded pairs meet the $230,000 threshold.");
  } else {
    for (const pair of qualifiedPairs) {
      console.log(
        `${pair.dex_id ?? "unknown"} | ` +
        `CAP $${Number(pair.market_cap).toLocaleString("en-US")} | ` +
        `LIQ $${Number(pair.liquidity_usd ?? 0).toLocaleString("en-US")} | ` +
        `PRICE ${pair.price_sol ?? "N/A"} SOL | ` +
        `PAIR ${pair.pair_address} | MINT ${pair.mint}`
      );
    }
  }

  console.log(`TOTAL QUALIFIED PAIRS: ${qualifiedPairs.length}`);
  console.log(
    `[OBSERVED] scanned mints=${mints.length} ` +
    `fresh_pairs=${pairCount} cached_heartbeats=${cachedCount} ` +
    `observations=${observationCount} ` +
    `live caps >= $230K=${qualifiedPairs.length}`
  );
}

async function main() {
  console.log("==========================================");
  console.log("ATUMPUMP — QUALIFYING PAIR OBSERVER");
  console.log("Market cap floor: $230,000");
  console.log("Observation interval: 15 seconds");
  console.log("Price basis: SOL");
  console.log("==========================================");

  while (true) {
    try {
      await observe();
    } catch (error) {
      console.error("[OBSERVER ERROR]", error.message);
    }

    await sleep(INTERVAL);
  }
}

process.on("SIGINT", () => {
  console.log("\n[OBSERVER] Stopped.");
  db.close();
  process.exit(0);
});

main();
