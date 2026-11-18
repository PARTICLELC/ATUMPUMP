import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/atumpump.sqlite");
db.exec("PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL;");

const SOL = "So11111111111111111111111111111111111111112";
const MIN_CAP = 230000;
const MIN_BUYERS = 23;
const WINDOW_MS = 72000;
const LOOP_MS = 15000;
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const sleep = ms => new Promise(r => setTimeout(r, ms));

db.exec(`
  CREATE TABLE IF NOT EXISTS pair_buy_events (
    pair_address TEXT NOT NULL,
    mint TEXT NOT NULL,
    signature TEXT NOT NULL,
    buyer_address TEXT NOT NULL,
    block_time INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY(pair_address, signature, buyer_address)
  );

  CREATE INDEX IF NOT EXISTS idx_pair_buy_events_window
  ON pair_buy_events(pair_address, block_time);

  CREATE TABLE IF NOT EXISTS pair_buyer_signatures (
    pair_address TEXT NOT NULL,
    signature TEXT NOT NULL,
    block_time INTEGER,
    processed_at INTEGER NOT NULL,
    PRIMARY KEY(pair_address, signature)
  );
`);

for (const [name, definition] of [
  ["buyer_count_72s", "INTEGER NOT NULL DEFAULT 0"],
  ["buyer_count_updated_at", "INTEGER"]
]) {
  const columns = db.prepare("PRAGMA table_info(market_pairs)").all();
  if (!columns.some(c => c.name === name)) {
    db.exec(`ALTER TABLE market_pairs ADD COLUMN ${name} ${definition}`);
  }
}

const candidates = db.prepare(`
  SELECT pair_address, mint
  FROM market_pairs
  WHERE active = 1
    AND quote_mint = ?
    AND CAST(COALESCE(market_cap, 0) AS REAL) >= ?
  ORDER BY CAST(market_cap AS REAL) DESC
`);

const wasProcessed = db.prepare(`
  SELECT 1 FROM pair_buyer_signatures
  WHERE pair_address = ? AND signature = ?
`);

const markProcessed = db.prepare(`
  INSERT OR IGNORE INTO pair_buyer_signatures
  (pair_address, signature, block_time, processed_at)
  VALUES (?, ?, ?, ?)
`);

const insertBuyer = db.prepare(`
  INSERT OR IGNORE INTO pair_buy_events
  (pair_address, mint, signature, buyer_address, block_time, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Replay recent signatures using the corrected native-SOL buyer detector.
db.prepare(`
  DELETE FROM pair_buyer_signatures
  WHERE block_time >= ?
`).run(Math.floor(Date.now() / 1000) - 72);

const updateCount = db.prepare(`
  UPDATE market_pairs
  SET buyer_count_72s = (
    SELECT COUNT(DISTINCT e.buyer_address)
    FROM pair_buy_events e
    WHERE e.pair_address = market_pairs.pair_address
      AND e.block_time * 1000 >= ?
  ),
  buyer_count_updated_at = ?
  WHERE pair_address = ?
`);

let rpcId = 0;
let lastRpcAt = 0;

const RPC_GAP_MS = 1500;

async function rpc(method, params) {
  const wait = Math.max(0, lastRpcAt + RPC_GAP_MS - Date.now());
  if (wait) await sleep(wait);
  lastRpcAt = Date.now();

  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method,
      params
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 429) {
    throw new Error("RPC rate limited (429); retry next cycle");
  }

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body.error) throw new Error(body.error.message || "RPC error");

  return body.result;
}

function amount(balance) {
  const raw = balance?.uiTokenAmount?.amount;
  if (raw === undefined || raw === null) return 0;
  try {
    const decimals = Number(balance.uiTokenAmount.decimals || 0);
    return Number(raw) / (10 ** decimals);
  } catch {
    return 0;
  }
}

function ownerDeltas(tx) {
  const changes = new Map();
  const all = [
    ...(tx.meta?.preTokenBalances || []).map(x => ({ ...x, side: -1 })),
    ...(tx.meta?.postTokenBalances || []).map(x => ({ ...x, side: 1 }))
  ];

  for (const item of all) {
    if (!item.owner || !item.mint) continue;
    const key = `${item.owner}|${item.mint}`;
    const entry = changes.get(key) || {
      owner: item.owner,
      mint: item.mint,
      delta: 0
    };
    entry.delta += item.side * amount(item);
    changes.set(key, entry);
  }

  return [...changes.values()];
}

async function inspectSwap(pair, signature, blockTime) {
  const tx = await rpc("getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1
    }
  ]);

  if (!tx?.meta || tx.meta.err) return [];

  const accountKeys = tx.transaction?.message?.accountKeys || [];
  const preBalances = tx.meta.preBalances || [];
  const postBalances = tx.meta.postBalances || [];
  const fee = Number(tx.meta.fee || 0);

  // Identify signing wallets that actually spent native SOL,
  // excluding transactions where the only SOL decrease was the fee.
  const solSpendingSigners = new Set();

  accountKeys.forEach((account, index) => {
    const pubkey = typeof account === "string"
      ? account
      : account.pubkey;

    const signer = typeof account === "object" && account.signer === true;

    if (!pubkey || !signer) return;

    const spent = Number(preBalances[index] || 0) -
                  Number(postBalances[index] || 0);

    if (spent > fee) solSpendingSigners.add(pubkey);
  });

  // A buyer must receive the pair's base token and be a signing
  // wallet that spent native SOL in the same transaction.
  const deltas = ownerDeltas(tx);

  return [...new Set(
    deltas
      .filter(x =>
        x.mint === pair.mint &&
        x.delta > 0 &&
        solSpendingSigners.has(x.owner)
      )
      .map(x => x.owner)
  )];
}

async function scanPair(pair, now) {
  const signatures = await rpc("getSignaturesForAddress", [
    pair.pair_address,
    { limit: 30, commitment: "confirmed" }
  ]);

  let newSignatures = 0;
  for (const item of signatures || []) {
    if (!item.signature || !item.blockTime) continue;
    if (item.blockTime * 1000 < now - WINDOW_MS) continue;
    if (wasProcessed.get(pair.pair_address, item.signature)) continue;

    const buyers = await inspectSwap(pair, item.signature, item.blockTime);

    db.exec("BEGIN");
    try {
      for (const buyer of buyers) {
        insertBuyer.run(
          pair.pair_address,
          pair.mint,
          item.signature,
          buyer,
          item.blockTime,
          now
        );
      }
      markProcessed.run(
        pair.pair_address,
        item.signature,
        item.blockTime,
        now
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    newSignatures++;
    await sleep(180);
  }

  updateCount.run(now - WINDOW_MS, now, pair.pair_address);
  return newSignatures;
}

async function cycle() {
  const now = Date.now();
  const pairs = candidates.all(SOL, MIN_CAP);
  console.log(`[CYCLE START] Eligible pairs found: ${pairs.length}`);

  let checked = 0;
  let newSignatures = 0;
  let errors = 0;

  for (const [index, pair] of pairs.entries()) {
    console.log(
      `[PAIR ${index + 1}/${pairs.length}] Scanning ${pair.pair_address}`
    );

    try {
      newSignatures += await scanPair(pair, now);
      checked++;
      console.log(`[PAIR COMPLETE] ${pair.pair_address}`);
    } catch (error) {
      errors++;
      console.error(
        `[PAIR SKIPPED — RETRY NEXT CYCLE] ${pair.pair_address}: ${error.message}`
      );
    }
    await sleep(150);
  }

  const qualified = db.prepare(`
    SELECT pair_address, mint, market_cap, buyer_count_72s
    FROM market_pairs
    WHERE active = 1
      AND quote_mint = ?
      AND CAST(COALESCE(market_cap, 0) AS REAL) >= ?
      AND buyer_count_72s >= ?
    ORDER BY buyer_count_72s DESC, market_cap DESC
  `).all(SOL, MIN_CAP, MIN_BUYERS);

  console.log(
    `[BUYER FILTER] pairs=${pairs.length} checked=${checked}` +
    ` new_transactions=${newSignatures} errors=${errors}` +
    ` | QUALIFIED 23+ BUYERS=${qualified.length}`
  );

  for (const p of qualified) {
    console.log(
      `${p.buyer_count_72s} BUYERS | CAP $${Number(p.market_cap).toLocaleString("en-US")}` +
      ` | PAIR ${p.pair_address}`
    );
  }
}

console.log("==============================================");
console.log("ATUMPUMP — DISTINCT PAIR BUYER OBSERVER");
console.log("Window: trailing 72 seconds");
console.log("Minimum: 23 distinct buyer wallets per pair");
console.log("Market cap: actual market_cap >= $230,000");
console.log("Quote: SOL");
console.log("==============================================");

while (true) {
  try {
    await cycle();
  } catch (error) {
    console.error("[BUYER OBSERVER ERROR]", error.message);
  }
  await sleep(LOOP_MS);
}
