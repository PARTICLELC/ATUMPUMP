import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");

const NETWORK = "solana";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const INTERVAL_MS = 60000;
const REQUEST_GAP_MS = 12000;
const RATE_LIMIT_COOLDOWN_MS = 60000;
const API_BASE = "https://api.geckoterminal.com/api/v2";

DB.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 15000;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS liquidity_source_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_address TEXT NOT NULL,
    mint TEXT,
    source TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    liquidity_usd REAL,
    response_status INTEGER,
    result TEXT NOT NULL,
    api_url TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_liquidity_source_pair_time
  ON liquidity_source_observations(pair_address, observed_at);

  CREATE INDEX IF NOT EXISTS idx_liquidity_source_time
  ON liquidity_source_observations(observed_at);
`);

function ensureColumn(table, column, definition) {
  const columns = DB.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    DB.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("market_pairs", "liquidity_source", "TEXT");
ensureColumn("market_pairs", "liquidity_updated_at", "INTEGER");
ensureColumn("market_pairs", "liquidity_checked_at", "INTEGER");

DB.exec("ATTACH DATABASE 'ATUMPUMP_A_LIST/data/a_list.sqlite' AS alist");

const selectPairs = DB.prepare(`
  SELECT mp.pair_address, mp.mint, mp.quote_mint
  FROM market_pairs mp
  WHERE mp.active = 1
    AND mp.pair_address IS NOT NULL
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM alist.trades tr
      WHERE tr.pair_address = mp.pair_address
        AND tr.status = 'OPEN'
    ) THEN 0 ELSE 1 END,
    COALESCE(mp.liquidity_checked_at, 0) ASC,
    mp.pair_address ASC
`);

const updatePair = DB.prepare(`
  UPDATE market_pairs
  SET
    liquidity_checked_at = ?,
    liquidity_usd = CASE
      WHEN ? IS NOT NULL THEN ?
      ELSE liquidity_usd
    END,
    liquidity_source = CASE
      WHEN ? IS NOT NULL THEN 'geckoterminal'
      ELSE liquidity_source
    END,
    liquidity_updated_at = CASE
      WHEN ? IS NOT NULL THEN ?
      ELSE liquidity_updated_at
    END
  WHERE pair_address = ?
`);

const insertObservation = DB.prepare(`
  INSERT INTO liquidity_source_observations (
    pair_address,
    mint,
    source,
    observed_at,
    liquidity_usd,
    response_status,
    result,
    api_url
  )
  VALUES (?, ?, 'geckoterminal', ?, ?, ?, ?, ?)
`);

const updateLatestSuccessfulLiquidity = DB.prepare(`
  UPDATE market_pairs
  SET
    liquidity_usd = (
      SELECT liquidity_usd
      FROM liquidity_source_observations
      WHERE pair_address = ?
        AND source = 'geckoterminal'
        AND liquidity_usd > 0
      ORDER BY observed_at DESC
      LIMIT 1
    ),
    liquidity_source = 'geckoterminal',
    liquidity_updated_at = (
      SELECT observed_at
      FROM liquidity_source_observations
      WHERE pair_address = ?
        AND source = 'geckoterminal'
        AND liquidity_usd > 0
      ORDER BY observed_at DESC
      LIMIT 1
    )
  WHERE pair_address = ?
    AND EXISTS (
      SELECT 1
      FROM liquidity_source_observations
      WHERE pair_address = ?
        AND source = 'geckoterminal'
        AND liquidity_usd > 0
    )
`);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function numericLiquidity(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numericPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const updateMarketPrice = DB.prepare(`
  UPDATE market_pairs
  SET price_sol = ?, last_seen_at = MAX(last_seen_at, ?)
  WHERE pair_address = ? AND mint = ?
`);

const insertMarketObservation = DB.prepare(`
  INSERT INTO market_pair_observations (
    pair_address, mint, observed_at, price_sol,
    liquidity_usd, volume_h24, fdv, market_cap
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertPriceObservation = DB.prepare(`
  INSERT INTO price_observations (
    mint, observed_at, price_sol, source, pair_address
  ) VALUES (?, ?, ?, 'geckoterminal', ?)
`);

async function refreshPair(pair) {
  const address = pair.pair_address;
  const url =
    `${API_BASE}/networks/${NETWORK}/pools/${encodeURIComponent(address)}`;

  let status = null;
  let liquidity = null;
  let priceSol = null;
  let result = "missing";
  let errorMessage = null;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json;version=20230302"
      },
      signal: AbortSignal.timeout(15000)
    });

    status = response.status;

    if (response.ok) {
      const payload = await response.json();
      const attributes = payload?.data?.attributes ?? {};

      liquidity = numericLiquidity(attributes.reserve_in_usd);

      // GeckoTerminal pool price is used only for the exact registered
      // token/SOL pair. Never convert or substitute another pool.
      if (pair.quote_mint === SOL_MINT) {
        priceSol = numericPrice(
          attributes.base_token_price_quote_token
        );
      }
      result = liquidity !== null
        ? "liquidity_received"
        : "liquidity_not_reported";
    } else {
      result = "http_error";
      errorMessage = `HTTP ${status}`;
    }
  } catch (error) {
    result = "request_error";
    errorMessage = error.message;
  }

  const observedAt = Date.now();

  DB.exec("BEGIN IMMEDIATE");

  try {
    updatePair.run(
      observedAt,
      liquidity,
      liquidity,
      liquidity,
      liquidity,
      observedAt,
      address
    );

    insertObservation.run(
      address,
      pair.mint,
      observedAt,
      liquidity,
      status,
      errorMessage ? `${result}: ${errorMessage}` : result,
      url
    );

    if (liquidity !== null) {
      updateLatestSuccessfulLiquidity.run(
        address,
        address,
        address,
        address
      );
    }

    if (priceSol !== null) {
      updateMarketPrice.run(
        priceSol, observedAt, address, pair.mint
      );

      insertMarketObservation.run(
        address, pair.mint, observedAt, priceSol,
        liquidity, null, null, null
      );

      insertPriceObservation.run(
        pair.mint, observedAt, priceSol, address
      );
    }

    DB.exec("COMMIT");
  } catch (error) {
    DB.exec("ROLLBACK");
    throw error;
  }

  return { result, liquidity, priceSol, status };
}

function printSummary(stats, totalPairs) {
  const coverage = DB.prepare(`
    SELECT COUNT(*) AS active,
      SUM(CASE WHEN liquidity_usd > 0 THEN 1 ELSE 0 END) AS covered
    FROM market_pairs
    WHERE active = 1
  `).get();

  console.log("\n========== GECKOTERMINAL LIQUIDITY ==========");
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Active registered pairs: ${totalPairs}`);
  console.log(`Pairs processed: ${stats.processed}`);
  console.log(`Fresh SOL prices written: ${stats.pricesReceived}`);
  console.log(`Liquidity received: ${stats.received}`);
  console.log(`Liquidity not reported: ${stats.missing}`);
  console.log(`HTTP errors: ${stats.httpErrors}`);
  console.log(`Request errors: ${stats.requestErrors}`);
  console.log(`Current registry coverage: ${coverage.covered || 0}/${coverage.active || 0}`);
  console.log("=============================================\n");
}

async function refreshCycle() {
  const pairs = selectPairs.all();

  const stats = {
    processed: 0,
    received: 0,
    missing: 0,
    httpErrors: 0,
    requestErrors: 0,
    pricesReceived: 0
  };

  if (pairs.length === 0) {
    console.log("[WAITING] No active registered pairs.");
    return;
  }

  console.log(`\n[INFINITE QUEUE] ${pairs.length} active pairs scheduled.`);
  console.log("[PROCESSING] Every active registered pair; no batch limit.");

  for (const pair of pairs) {
    try {
      const result = await refreshPair(pair);
      stats.processed++;

      if (result.priceSol !== null) {
        stats.pricesReceived++;
        console.log(
          `[GECKO PRICE] ${pair.pair_address} = ${result.priceSol} SOL`
        );
      }

      if (result.result === "liquidity_received") {
        stats.received++;
        console.log(
          `[LIQUIDITY] ${pair.pair_address} = $${result.liquidity.toFixed(2)}`
        );
      } else if (result.result === "http_error") {
        stats.httpErrors++;
        console.log(`[HTTP ${result.status}] ${pair.pair_address}`);

        if (result.status === 429) {
          console.log("[RATE LIMIT] Cooling down for 60 seconds.");
          await sleep(RATE_LIMIT_COOLDOWN_MS);
        }
      } else if (result.result === "request_error") {
        stats.requestErrors++;
        console.log(`[REQUEST ERROR] ${pair.pair_address}`);
      } else {
        stats.missing++;
        console.log(`[NO LIQUIDITY] ${pair.pair_address}`);
      }
    } catch (error) {
      stats.requestErrors++;
      console.log(`[DATABASE ERROR] ${pair.pair_address}: ${error.message}`);
    }

    await sleep(REQUEST_GAP_MS);
  }

  printSummary(stats, pairs.length);
}

let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
  console.log("\n[STOPPING] Finishing current operation.");
});

console.log("========== ATUMPUMP GECKOTERMINAL ==========");
console.log("[ONLINE] Secondary liquidity source enabled.");
console.log("[NETWORK] Solana");
console.log("[PAIR REGISTRY] UNLIMITED");
console.log("[QUEUE] ALL ACTIVE REGISTERED PAIRS");
console.log("[BATCH LIMIT] REMOVED");
console.log("[ROTATION] Oldest checked pairs first.");
console.log("[REQUEST GAP] 12 seconds.");
console.log("[HTTP 429 COOLDOWN] 60 seconds.");
console.log("[STORAGE] Source-tagged liquidity history.");
console.log("[PRICE FEED] GeckoTerminal exact-pair SOL prices enabled.");
console.log("[DEXSCREENER] NOT USED.");
console.log("============================================");

while (!stopping) {
  const started = Date.now();

  try {
    await refreshCycle();
  } catch (error) {
    console.log(`[CYCLE ERROR] ${error.message}`);
  }

  if (!stopping) {
    const elapsed = Date.now() - started;
    await sleep(Math.max(1000, INTERVAL_MS - elapsed));
  }
}

DB.close();
console.log("[OFFLINE] GeckoTerminal refresh stopped.");
