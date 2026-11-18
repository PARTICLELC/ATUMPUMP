import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/atumpump.sqlite";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const BATCH_SIZE = 30;
const REQUEST_GAP_MS = 1300;
const SWEEP_GAP_MS = 10 * 60 * 1000;

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout=15000");

const getTokens = db.prepare(`
  SELECT mint
  FROM tokens
  WHERE eligible = 1
  ORDER BY COALESCE(last_checked_at, 0), first_seen_at
`);

const markChecked = db.prepare(`
  UPDATE tokens SET last_checked_at = ? WHERE mint = ?
`);

const upsertPair = db.prepare(`
  INSERT INTO market_pairs (
    pair_address, mint, dex_id, chain_id, quote_mint, pair_url,
    price_sol, liquidity_usd, volume_h24, fdv, market_cap,
    pair_created_at, first_seen_at, last_seen_at, active
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(pair_address) DO UPDATE SET
    mint = excluded.mint,
    dex_id = excluded.dex_id,
    chain_id = excluded.chain_id,
    quote_mint = excluded.quote_mint,
    pair_url = excluded.pair_url,
    price_sol = excluded.price_sol,
    liquidity_usd = COALESCE(excluded.liquidity_usd, market_pairs.liquidity_usd),
    volume_h24 = COALESCE(excluded.volume_h24, market_pairs.volume_h24),
    fdv = COALESCE(excluded.fdv, market_pairs.fdv),
    market_cap = COALESCE(excluded.market_cap, market_pairs.market_cap),
    pair_created_at = COALESCE(excluded.pair_created_at, market_pairs.pair_created_at),
    last_seen_at = excluded.last_seen_at,
    active = 1
`);

const insertPairObservation = db.prepare(`
  INSERT INTO market_pair_observations (
    pair_address, mint, observed_at, price_sol,
    liquidity_usd, volume_h24, fdv, market_cap
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertPriceObservation = db.prepare(`
  INSERT INTO price_observations (
    mint, observed_at, price_sol, source, pair_address
  )
  VALUES (?, ?, ?, ?, ?)
`);

const updateTokenPair = db.prepare(`
  UPDATE tokens
  SET pair_address = ?, quote_mint = ?, eligible = 1
  WHERE mint = ?
`);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchBatch(mints) {
  const url =
    `https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`;

  let backoff = 60000;

  while (true) {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30000)
    });

    if (response.status === 429) {
      const retry = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retry) && retry > 0
        ? retry * 1000
        : backoff;

      console.warn(`[429] Waiting ${Math.ceil(wait / 1000)} seconds`);
      await sleep(wait);
      backoff = Math.min(backoff * 2, 15 * 60 * 1000);
      continue;
    }

    if (!response.ok) {
      throw new Error(`DexScreener HTTP ${response.status}`);
    }

    const result = await response.json();
    return Array.isArray(result) ? result : [];
  }
}

async function sweep() {
  const tokens = getTokens.all();
  const mints = [...new Set(tokens.map(row => row.mint).filter(Boolean))];

  let pairCount = 0;
  let capCount = 0;
  let qualifyingMints = new Set();
  let sourceCounts = new Map();
  let checked = 0;

  console.log("\n========== LIVE SOLANA PAIR UNIVERSE ==========");
  console.log(`Eligible tokens: ${mints.length}`);
  console.log(`Market-cap threshold: $230,000`);
  console.log("DEX selection: ALL returned Solana DEX sources");
  console.log("Quote requirement: SOL");
  console.log("Market cap source: DexScreener marketCap field");
  console.log("================================================");

  for (let offset = 0; offset < mints.length; offset += BATCH_SIZE) {
    const batch = mints.slice(offset, offset + BATCH_SIZE);
    const pairs = await fetchBatch(batch);
    const now = Date.now();

    const matching = pairs.filter(pair =>
      pair.chainId === "solana" &&
      pair.baseToken?.address &&
      batch.includes(pair.baseToken.address) &&
      pair.quoteToken?.address === SOL_MINT &&
      pair.pairAddress &&
      numberOrNull(pair.priceNative) > 0
    );

    const bestPairByMint = new Map();

    db.exec("BEGIN");

    try {
      for (const pair of matching) {
        const mint = pair.baseToken.address;
        const price = numberOrNull(pair.priceNative);
        const liquidity = numberOrNull(pair.liquidity?.usd);
        const volume = numberOrNull(pair.volume?.h24);
        const fdv = numberOrNull(pair.fdv);

        // Actual marketCap only. Never substitute FDV.
        const marketCap = numberOrNull(pair.marketCap);
        const created = numberOrNull(pair.pairCreatedAt);

        upsertPair.run(
          pair.pairAddress,
          mint,
          pair.dexId ?? null,
          "solana",
          pair.quoteToken.address,
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

        insertPairObservation.run(
          pair.pairAddress,
          mint,
          now,
          price,
          liquidity,
          volume,
          fdv,
          marketCap
        );

        insertPriceObservation.run(
          mint,
          now,
          price,
          `dexscreener:${pair.dexId ?? "unknown"}`,
          pair.pairAddress
        );

        pairCount++;
        if (marketCap !== null && marketCap > 0) {
          capCount++;
          if (marketCap >= 230000) qualifyingMints.add(mint);
        }

        sourceCounts.set(
          pair.dexId ?? "unknown",
          (sourceCounts.get(pair.dexId ?? "unknown") || 0) + 1
        );

        const previous = bestPairByMint.get(mint);
        if (!previous ||
            (liquidity ?? 0) > (previous.liquidity ?? 0)) {
          bestPairByMint.set(mint, {
            address: pair.pairAddress,
            liquidity
          });
        }
      }

      for (const mint of batch) {
        markChecked.run(now, mint);

        const best = bestPairByMint.get(mint);
        if (best) updateTokenPair.run(best.address, SOL_MINT, mint);
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    checked += batch.length;

    console.log(
      `[SCAN] ${checked}/${mints.length} tokens | ` +
      `${pairCount} pairs | ${capCount} live market caps | ` +
      `${qualifyingMints.size} mints >= $230K`
    );

    await sleep(REQUEST_GAP_MS);
  }

  console.log("\n========== LIVE PAIR SWEEP COMPLETE ==========");
  console.log(`Tokens scanned: ${checked}`);
  console.log(`SOL pairs captured: ${pairCount}`);
  console.log(`Pairs with market cap: ${capCount}`);
  console.log(`Unique mints >= $230K: ${qualifyingMints.size}`);
  console.log("\nDEX SOURCES:");
  for (const [dex, count] of [...sourceCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`${dex}: ${count}`);
  }
  console.log("===============================================");
}

async function main() {
  while (true) {
    try {
      await sweep();
    } catch (error) {
      console.error("[LIVE PAIR UNIVERSE ERROR]", error.message);
    }

    console.log("Next complete live-pair sweep in 10 minutes.");
    await sleep(SWEEP_GAP_MS);
  }
}

process.on("SIGINT", () => {
  console.log("\n[LIVE PAIR UNIVERSE] Stopping.");
  db.close();
  process.exit(0);
});

main();
