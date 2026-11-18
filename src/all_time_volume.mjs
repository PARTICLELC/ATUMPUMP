import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/atumpump.sqlite";
const POLL_INTERVAL = 30000;
const BATCH_SIZE = 10;

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 15000");
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS token_all_time_volume (
    mint TEXT PRIMARY KEY,
    volume_usd REAL NOT NULL DEFAULT 0,
    trade_count INTEGER NOT NULL DEFAULT 0,
    first_trade_at INTEGER,
    last_trade_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observed_token_swaps (
    tx_hash TEXT PRIMARY KEY,
    pair_address TEXT NOT NULL,
    mint TEXT NOT NULL,
    volume_usd REAL NOT NULL,
    traded_at INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_observed_swaps_mint
    ON observed_token_swaps(mint);
`);

const insertSwap = db.prepare(`
  INSERT OR IGNORE INTO observed_token_swaps
    (tx_hash, pair_address, mint, volume_usd, traded_at, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const addVolume = db.prepare(`
  INSERT INTO token_all_time_volume
    (mint, volume_usd, trade_count, first_trade_at, last_trade_at, updated_at)
  VALUES (?, ?, 1, ?, ?, ?)
  ON CONFLICT(mint) DO UPDATE SET
    volume_usd = token_all_time_volume.volume_usd + excluded.volume_usd,
    trade_count = token_all_time_volume.trade_count + 1,
    first_trade_at = MIN(
      COALESCE(token_all_time_volume.first_trade_at, excluded.first_trade_at),
      excluded.first_trade_at
    ),
    last_trade_at = MAX(
      COALESCE(token_all_time_volume.last_trade_at, excluded.last_trade_at),
      excluded.last_trade_at
    ),
    updated_at = excluded.updated_at
`);

let offset = 0;
let running = false;

async function capturePair(pair) {
  const endpoint =
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/` +
    `${encodeURIComponent(pair.pair_address)}/trades`;

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) return 0;

  const payload = await response.json();
  const trades = Array.isArray(payload.data) ? payload.data : [];
  let captured = 0;

  for (const trade of trades) {
    const attributes = trade.attributes ?? {};
    const txHash = attributes.tx_hash;
    const volumeUsd = Number(attributes.volume_in_usd);
    const tradedAt = Date.parse(attributes.block_timestamp);

    if (
      !txHash ||
      !Number.isFinite(volumeUsd) ||
      volumeUsd <= 0 ||
      !Number.isFinite(tradedAt)
    ) continue;

    const now = Date.now();
    const result = insertSwap.run(
      txHash,
      pair.pair_address,
      pair.mint,
      volumeUsd,
      tradedAt,
      now
    );

    if (Number(result.changes) > 0) {
      addVolume.run(pair.mint, volumeUsd, tradedAt, tradedAt, now);
      captured++;
    }
  }

  return captured;
}

async function captureBatch() {
  if (running) return;
  running = true;

  try {
    const pairs = db.prepare(`
      SELECT pair_address, mint
      FROM market_pairs
      WHERE active = 1
        AND pair_address IS NOT NULL
        AND mint IS NOT NULL
      ORDER BY liquidity_usd DESC
      LIMIT ? OFFSET ?
    `).all(BATCH_SIZE, offset);

    if (!pairs.length) {
      offset = 0;
      return;
    }

    for (const pair of pairs) {
      try {
        await capturePair(pair);
      } catch (error) {
        console.error(
          `[ALL-TIME VOLUME] ${pair.pair_address}: ${error.message}`
        );
      }
    }

    offset += BATCH_SIZE;
  } catch (error) {
    console.error("[ALL-TIME VOLUME]", error.message);
  } finally {
    running = false;
  }
}

export function startAllTimeVolumeCapture() {
  console.log("[ALL-TIME VOLUME] GeckoTerminal swap capture started.");
  captureBatch();
  setInterval(captureBatch, POLL_INTERVAL);
}
