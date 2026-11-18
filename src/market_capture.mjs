import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/atumpump.sqlite";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const POLL_INTERVAL = 31000;
const BATCH_SIZE = 30;

const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 15000");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS market_pairs (
    pair_address TEXT PRIMARY KEY,
    mint TEXT NOT NULL,
    dex_id TEXT,
    chain_id TEXT,
    quote_mint TEXT,
    pair_url TEXT,
    price_sol REAL,
    liquidity_usd REAL,
    volume_h24 REAL,
    fdv REAL,
    market_cap REAL,
    pair_created_at INTEGER,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_market_pairs_mint
    ON market_pairs(mint);

  CREATE INDEX IF NOT EXISTS idx_market_pairs_last_seen
    ON market_pairs(last_seen_at);

  CREATE TABLE IF NOT EXISTS market_pair_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_address TEXT NOT NULL,
    mint TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    price_sol REAL NOT NULL,
    liquidity_usd REAL,
    volume_h24 REAL,
    fdv REAL,
    market_cap REAL
  );

  CREATE INDEX IF NOT EXISTS idx_pair_observations_address_time
    ON market_pair_observations(pair_address, observed_at);

  CREATE INDEX IF NOT EXISTS idx_pair_observations_mint_time
    ON market_pair_observations(mint, observed_at);
`);

console.log("[DATABASE] Trading-pair intelligence tables ready.");

const tokenColumns = db.prepare("PRAGMA table_info(tokens)").all();
if (!tokenColumns.some(column => column.name === "last_checked_at")) {
  db.exec("ALTER TABLE tokens ADD COLUMN last_checked_at INTEGER");
  console.log("[DATABASE] Added tokens.last_checked_at");
}

const insertToken = db.prepare(`
  INSERT INTO tokens (
    mint, name, symbol, first_seen_at, last_seen_at,
    discovery_source, pair_address, quote_mint, eligible
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(mint) DO UPDATE SET
    name = COALESCE(excluded.name, tokens.name),
    symbol = COALESCE(excluded.symbol, tokens.symbol),
    last_seen_at = MAX(tokens.last_seen_at, excluded.last_seen_at),
    discovery_source = COALESCE(tokens.discovery_source, excluded.discovery_source)
`);

const insertObservation = db.prepare(`
  INSERT INTO price_observations (
    mint, observed_at, price_sol, source, pair_address
  )
  VALUES (?, ?, ?, ?, ?)
`);

const updatePair = db.prepare(`
  UPDATE tokens
  SET pair_address = ?, quote_mint = ?, eligible = ?
  WHERE mint = ?
`);

const upsertMarketPair = db.prepare(`
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
    liquidity_usd = excluded.liquidity_usd,
    volume_h24 = excluded.volume_h24,
    fdv = COALESCE(excluded.fdv, market_pairs.fdv),
    market_cap = COALESCE(excluded.market_cap, market_pairs.market_cap),
    pair_created_at = COALESCE(
      excluded.pair_created_at,
      market_pairs.pair_created_at
    ),
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

// A-LIST open-position tokens are always first in the capture queue.
db.exec("ATTACH DATABASE 'ATUMPUMP_A_LIST/data/a_list.sqlite' AS alist");

const getUnobservedTokens = db.prepare(`
  SELECT
    t.mint,
    (
      SELECT tr.pair_address
      FROM alist.trades tr
      WHERE tr.mint = t.mint
        AND tr.status = 'OPEN'
      ORDER BY tr.pair_address
      LIMIT 1
    ) AS held_pair_address
  FROM tokens t
  WHERE t.eligible = 1
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1
      FROM alist.trades tr
      WHERE tr.mint = t.mint
        AND tr.status = 'OPEN'
    ) THEN 0 ELSE 1 END,
    COALESCE(t.last_checked_at, 0) ASC,
    t.first_seen_at ASC
  LIMIT ?
`);

const markTokenChecked = db.prepare(`
  UPDATE tokens
  SET last_checked_at = ?
  WHERE mint = ?
`);

let socket;
let stopping = false;
let polling = false;
let snapshotNumber = 0;

const pendingRegistrations = new Map();

function registerToken(data, source) {
  if (!data?.mint) return;

  const now = Date.now();

  try {
    insertToken.run(
      data.mint,
      data.name ?? null,
      data.symbol ?? null,
      now,
      now,
      source,
      null,
      null,
      0
    );

    pendingRegistrations.delete(data.mint);
  } catch (error) {
    if (error.code === "ERR_SQLITE_ERROR" || error.errcode === 5) {
      pendingRegistrations.set(data.mint, { data, source });
      console.log("[DATABASE BUSY] Token registration queued:", data.mint);
      return;
    }

    throw error;
  }
}

function flushPendingRegistrations() {
  for (const [mint, item] of pendingRegistrations) {
    registerToken(item.data, item.source);
  }
}

async function seedDiscovery() {
  console.log("\n[DISCOVERY] Loading latest Solana token profiles...");

  try {
    const response = await fetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
      { signal: AbortSignal.timeout(15000) }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const profiles = await response.json();

    let added = 0;

    for (const profile of profiles) {
      if (profile.chainId !== "solana" || !profile.tokenAddress) {
        continue;
      }

      registerToken({
        mint: profile.tokenAddress
      }, "dexscreener_profiles");

      added++;
    }

    console.log("[DISCOVERY] Solana profiles registered:", added);
  } catch (error) {
    console.log("[DISCOVERY ERROR]", error.message);
  }
}

function startPumpPortal() {
  console.log("\n[PUMPPORTAL] Connecting to token creation stream...");

  try {
    socket = new WebSocket("wss://pumpportal.fun/api/data");

    socket.onopen = () => {
      console.log("[PUMPPORTAL ONLINE]");

      socket.send(JSON.stringify({
        method: "subscribeNewToken"
      }));

      console.log("[PUMPPORTAL] New-token subscription sent.");
    };

    socket.onmessage = event => {
      let data;

      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (!data.mint || data.txType !== "create") {
        return;
      }

      try {
        registerToken(data, "pumpportal");

        console.log(
          "[NEW TOKEN]",
          data.symbol ?? "UNKNOWN",
          data.mint
        );
      } catch (error) {
        console.log("[NEW TOKEN REGISTER ERROR]", error.message);
      }
    };

    socket.onerror = error => {
      console.log("[PUMPPORTAL ERROR]", error.message || error);
    };

    socket.onclose = () => {
      console.log("[PUMPPORTAL DISCONNECTED]");
    };
  } catch (error) {
    console.log("[PUMPPORTAL FAILED]", error.message);
  }
}

let dexScreenerBackoffMs = 0;
let dexScreenerCooldownUntil = 0;


async function fetchDexScreenerPairs(mints) {
  const allPairs = [];

  for (let offset = 0; offset < mints.length; offset += 30) {
    const batchMints = mints.slice(offset, offset + 30);

    const remaining = dexScreenerCooldownUntil - Date.now();
    if (remaining > 0) {
      throw new Error(
        `DexScreener cooldown active: ${Math.ceil(remaining / 1000)}s`
      );
    }

    const url =
      `https://api.dexscreener.com/tokens/v1/solana/${batchMints.join(",")}`;

    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000)
    });

    if (response.status === 429) {
      const retryHeader = response.headers.get("retry-after");
      let retryMs = Number(retryHeader) * 1000;

      if (!Number.isFinite(retryMs) || retryMs <= 0) {
        const retryDate = Date.parse(retryHeader || "");
        retryMs = Number.isFinite(retryDate)
          ? Math.max(0, retryDate - Date.now())
          : 0;
      }

      dexScreenerBackoffMs = Math.min(
        dexScreenerBackoffMs
          ? dexScreenerBackoffMs * 2
          : 60000,
        15 * 60 * 1000
      );

      const cooldown = Math.max(dexScreenerBackoffMs, retryMs);
      dexScreenerCooldownUntil = Date.now() + cooldown;

      console.warn(
        `[DEXSCREENER 429] Rotated ${batchMints.length} tokens; ` +
        `retry in ${Math.ceil(cooldown / 1000)}s`
      );

      throw new Error("DexScreener rate limit; cooldown activated.");
    }

    if (!response.ok) {
      throw new Error(`DexScreener HTTP ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) allPairs.push(...data);

    // Pace requests between 30-mint chunks.
    if (offset + 30 < mints.length) {
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }

  dexScreenerBackoffMs = 0;
  dexScreenerCooldownUntil = 0;

  return allPairs;
}

async function capturePrices() {
  if (polling || stopping) return;

  const cooldownRemaining = dexScreenerCooldownUntil - Date.now();
  if (cooldownRemaining > 0) {
    console.log(
      `[DEXSCREENER] Rate-limit cooldown: ${Math.ceil(cooldownRemaining / 1000)}s`
    );
    return;
  }

  polling = true;
  snapshotNumber++;
  flushPendingRegistrations();

  try {
    const tokens = getUnobservedTokens.all(BATCH_SIZE);

    if (!tokens.length) {
      console.log("[PRICE] Waiting for discovered tokens.");
      return;
    }

    const mints = tokens.map(token => token.mint);

    const pairs = await fetchDexScreenerPairs(mints);
    const now = Date.now();

    let valid = 0;
    let excluded = 0;

    db.exec("BEGIN");

    try {
      for (const mint of mints) {
        markTokenChecked.run(now, mint);

        const matchingPairs = pairs.filter(
          pair => pair.baseToken?.address === mint
        );

        const heldPairAddress = tokens.find(
          item => item.mint === mint
        )?.held_pair_address;

        const validSolPairs = matchingPairs.filter(item =>
          item.chainId === "solana" &&
          item.quoteToken?.address === SOL_MINT &&
          Number(item.priceNative) > 0
        );

        // OPEN positions must be priced from their exact held pair.
        // Never substitute another pair for a held position.
        const pair = heldPairAddress
          ? validSolPairs.find(
              item => item.pairAddress === heldPairAddress
            )
          : validSolPairs.sort((a, b) => {
              const aPump = a.dexId === "pumpfun" ? 1 : 0;
              const bPump = b.dexId === "pumpfun" ? 1 : 0;

              if (aPump !== bPump) return bPump - aPump;

              return Number(b.liquidity?.usd || 0) -
                     Number(a.liquidity?.usd || 0);
            })[0];

        if (!pair) {
          if (heldPairAddress) {
            excluded++;
            console.log(
              `[HELD PAIR UNAVAILABLE] ${mint} ${heldPairAddress}`
            );
            continue;
          }

          const unsupported = matchingPairs[0];

          if (unsupported) {
            updatePair.run(
              unsupported.pairAddress ?? null,
              unsupported.quoteToken?.address ?? null,
              0,
              mint
            );

            excluded++;
          }

          continue;
        }

        const price = Number(pair.priceNative);

        if (!Number.isFinite(price) || price <= 0) {
          excluded++;
          continue;
        }

        const token = pair.baseToken;

        insertToken.run(
          mint,
          token.name ?? null,
          token.symbol ?? null,
          now,
          now,
          "dexscreener_price",
          pair.pairAddress ?? null,
          SOL_MINT,
          1
        );

        updatePair.run(
          pair.pairAddress ?? null,
          SOL_MINT,
          1,
          mint
        );

        const liquidityUsd = Number(pair.liquidity?.usd);
        const volumeH24 = Number(pair.volume?.h24);
        const fdv = Number(pair.fdv);
        const marketCap = Number(pair.marketCap);
        const pairCreatedAt = Number(pair.pairCreatedAt);

        const pairValues = {
          liquidity: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
          volume: Number.isFinite(volumeH24) ? volumeH24 : null,
          fdv: Number.isFinite(fdv) ? fdv : null,
          marketCap: Number.isFinite(marketCap) ? marketCap : null
        };

        upsertMarketPair.run(
          pair.pairAddress,
          mint,
          pair.dexId ?? null,
          pair.chainId ?? "solana",
          pair.quoteToken?.address ?? SOL_MINT,
          pair.url ?? null,
          price,
          pairValues.liquidity,
          pairValues.volume,
          pairValues.fdv,
          pairValues.marketCap,
          Number.isFinite(pairCreatedAt) ? pairCreatedAt : null,
          now,
          now
        );

        insertPairObservation.run(
          pair.pairAddress,
          mint,
          now,
          price,
          pairValues.liquidity,
          pairValues.volume,
          pairValues.fdv,
          pairValues.marketCap
        );

        insertObservation.run(
          mint,
          now,
          price,
          "dexscreener",
          pair.pairAddress ?? null
        );

        valid++;
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    console.log(
      `[SNAPSHOT ${snapshotNumber}]`,
      `Tokens checked: ${mints.length}`,
      `Valid SOL prices: ${valid}`,
      `Excluded/unavailable: ${excluded}`
    );

    console.log("[CACHE] Capture batch completed.");

  } catch (error) {
    console.log("[PRICE ERROR]", error.message);
  } finally {
    polling = false;
  }
}

function printDiagnostics() {
  const tokenCount = db.prepare(`
    SELECT COUNT(*) AS count FROM tokens
  `).get().count;

  const eligibleCount = db.prepare(`
    SELECT COUNT(*) AS count FROM tokens WHERE eligible = 1
  `).get().count;

  const observationCount = db.prepare(`
    SELECT COUNT(*) AS count FROM price_observations
  `).get().count;

  console.log("\n========== ATUMPUMP CAPTURE STATUS ==========");
  console.log("Registered tokens:", tokenCount);
  console.log("SOL-eligible tokens:", eligibleCount);
  console.log("Price observations:", observationCount);
  console.log("Round duration: 432 seconds");
  console.log("Championship engine: NOT STARTED");
  console.log("=============================================\n");
}

async function shutdown() {
  if (stopping) return;

  stopping = true;

  console.log("\n[SHUTDOWN] Closing market capture...");

  if (socket) socket.close();

  printDiagnostics();
  db.close();

  console.log("[OFFLINE] ATUMPUMP market capture stopped.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("========== ATUMPUMP MARKET CAPTURE ==========");
console.log("Database:", DB_PATH);
console.log("Price source: DexScreener");
console.log("Discovery source: PumpPortal");
console.log("Polling interval:", POLL_INTERVAL, "ms");
console.log("Maximum tokens per batch:", BATCH_SIZE);
console.log("Scoring engine: NOT STARTED");

await seedDiscovery();
startPumpPortal();

await capturePrices();

const poller = setInterval(capturePrices, POLL_INTERVAL);
const diagnostics = setInterval(printDiagnostics, 120000);

console.log("\n[ONLINE] Market capture is running.");
console.log("[STOP] Press CTRL+C to shut down.");
