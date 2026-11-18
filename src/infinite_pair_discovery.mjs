import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const PROFILE_URL = "https://api.dexscreener.com/token-profiles/latest/v1";
const TOKEN_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const PUMPPORTAL_URL = "wss://pumpportal.fun/api/data";

const API_CHUNK_SIZE = 30;
const API_GAP_MS = 2500;
const DISCOVERY_INTERVAL_MS = 60000;

DB.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 15000;

  CREATE TABLE IF NOT EXISTS discovery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    symbol TEXT,
    pair_address TEXT,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    discovered_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_discovery_events_mint
  ON discovery_events(mint);

  CREATE INDEX IF NOT EXISTS idx_discovery_events_time
  ON discovery_events(discovered_at);
`);

const tokenColumns = DB.prepare("PRAGMA table_info(tokens)").all();
const pairColumns = DB.prepare("PRAGMA table_info(market_pairs)").all();

const tokenColumnNames = new Set(tokenColumns.map(c => c.name));
const pairColumnNames = new Set(pairColumns.map(c => c.name));

if (!tokenColumnNames.has("last_checked_at")) {
  DB.exec("ALTER TABLE tokens ADD COLUMN last_checked_at INTEGER");
}

const pending = new Map();
const retryQueue = new Map();
const registered = new Set();

let websocket = null;
let stopping = false;
let profileFetchRunning = false;
let processing = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function enqueue(mint, source = "discovery") {
  if (!mint || typeof mint !== "string") return;
  if (mint.length < 32 || mint.length > 64) return;

  pending.set(mint, source);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function seedLatestProfiles() {
  if (profileFetchRunning || stopping) return;

  profileFetchRunning = true;

  try {
    const profiles = await fetchJson(PROFILE_URL);
    let added = 0;

    for (const profile of profiles) {
      if (
        profile.chainId === "solana" &&
        profile.tokenAddress
      ) {
        enqueue(profile.tokenAddress, "dexscreener_profile");
        added++;
      }
    }

    console.log(`[PROFILES] ${added} Solana token profiles queued.`);
  } catch (error) {
    console.log(`[PROFILE ERROR] ${error.message}`);
  } finally {
    profileFetchRunning = false;
  }
}

function registerPair(pair, source) {
  const now = Date.now();
  const mint = pair.baseToken?.address;
  const pairAddress = pair.pairAddress;

  if (!mint || !pairAddress) return false;
  if (pair.dexId !== "pumpfun") return false;
  if (pair.quoteToken?.address !== SOL_MINT) return false;

  DB.exec("BEGIN IMMEDIATE");

  try {
    DB.prepare(`
      INSERT INTO tokens (
        mint, name, symbol, first_seen_at, last_seen_at,
        discovery_source, pair_address, quote_mint, eligible
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(mint) DO UPDATE SET
        name = COALESCE(excluded.name, tokens.name),
        symbol = COALESCE(excluded.symbol, tokens.symbol),
        last_seen_at = excluded.last_seen_at,
        pair_address = excluded.pair_address,
        quote_mint = excluded.quote_mint,
        eligible = 1
    `).run(
      mint,
      pair.baseToken.name ?? null,
      pair.baseToken.symbol ?? null,
      now,
      now,
      source,
      pairAddress,
      SOL_MINT
    );

    DB.prepare(`
      INSERT INTO market_pairs (
        pair_address, mint, dex_id, chain_id, quote_mint,
        pair_url, price_sol, liquidity_usd, volume_h24,
        fdv, market_cap, pair_created_at,
        first_seen_at, last_seen_at, active
      )
      VALUES (?, ?, 'pumpfun', 'solana', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(pair_address) DO UPDATE SET
        mint = excluded.mint,
        dex_id = excluded.dex_id,
        chain_id = excluded.chain_id,
        quote_mint = excluded.quote_mint,
        pair_url = excluded.pair_url,
        price_sol = COALESCE(excluded.price_sol, market_pairs.price_sol),
        liquidity_usd = COALESCE(excluded.liquidity_usd, market_pairs.liquidity_usd),
        volume_h24 = COALESCE(excluded.volume_h24, market_pairs.volume_h24),
        fdv = COALESCE(excluded.fdv, market_pairs.fdv),
        market_cap = COALESCE(excluded.market_cap, market_pairs.market_cap),
        pair_created_at = COALESCE(excluded.pair_created_at, market_pairs.pair_created_at),
        last_seen_at = excluded.last_seen_at,
        active = 1
    `).run(
      pairAddress,
      mint,
      SOL_MINT,
      pair.url ?? null,
      pair.priceNative ? Number(pair.priceNative) : null,
      pair.liquidity?.usd != null ? Number(pair.liquidity.usd) : null,
      pair.volume?.h24 != null ? Number(pair.volume.h24) : null,
      pair.fdv != null ? Number(pair.fdv) : null,
      pair.marketCap != null ? Number(pair.marketCap) : null,
      pair.pairCreatedAt ?? null,
      now,
      now
    );

    DB.prepare(`
      INSERT INTO discovery_events (
        mint, symbol, pair_address, source, event_type, discovered_at
      )
      VALUES (?, ?, ?, ?, 'pumpfun_sol_pair_registered', ?)
    `).run(
      mint,
      pair.baseToken.symbol ?? null,
      pairAddress,
      source,
      now
    );

    DB.exec("COMMIT");

    registered.add(mint);
    retryQueue.delete(mint);

    console.log(
      `[REGISTERED] ${pair.baseToken.symbol ?? "UNKNOWN"} | ` +
      `${mint} | PAIR ${pairAddress}`
    );

    return true;
  } catch (error) {
    DB.exec("ROLLBACK");
    throw error;
  }
}

async function processQueue() {
  if (processing || stopping || pending.size === 0) return;

  processing = true;

  try {
    while (pending.size > 0 && !stopping) {
      const chunk = [...pending.entries()].slice(0, API_CHUNK_SIZE);

      for (const [mint] of chunk) pending.delete(mint);

      const addresses = chunk.map(([mint]) => mint);
      const sources = new Map(chunk);

      try {
        const url = TOKEN_URL + addresses.map(encodeURIComponent).join(",");
        const pairs = await fetchJson(url);
        const matchedMints = new Set();

        for (const pair of pairs) {
          const mint = pair.baseToken?.address;
          if (!mint) continue;

          if (registerPair(pair, sources.get(mint) ?? "discovery")) {
            matchedMints.add(mint);
          }
        }

        for (const mint of addresses) {
          if (!matchedMints.has(mint)) {
            const previous = retryQueue.get(mint) ?? 0;
            if (previous < 3) {
              retryQueue.set(mint, previous + 1);
              setTimeout(() => {
                if (!stopping) enqueue(mint, "discovery_retry");
              }, 60000 * (previous + 1));
            }
          }
        }

        console.log(
          `[RESOLVED] ${addresses.length} tokens | ` +
          `${matchedMints.size} eligible Pump.fun/SOL registrations.`
        );
      } catch (error) {
        console.log(`[RESOLVE ERROR] ${error.message}`);

        for (const [mint, source] of chunk) {
          if (!stopping) pending.set(mint, source);
        }

        if (error.status === 429) {
          console.log("[RATE LIMIT] Discovery cooling down for 60 seconds.");
          await sleep(60000);
        } else {
          await sleep(10000);
        }
      }

      await sleep(API_GAP_MS);
    }
  } finally {
    processing = false;
  }
}

function connectPumpPortal() {
  if (stopping) return;

  try {
    websocket = new WebSocket(PUMPPORTAL_URL);

    websocket.addEventListener("open", () => {
      console.log("[PUMPPORTAL] Connected.");
      websocket.send(JSON.stringify({
        method: "subscribeNewToken"
      }));
      console.log("[PUMPPORTAL] New-token discovery subscribed.");
    });

    websocket.addEventListener("message", event => {
      try {
        const data = JSON.parse(event.data);
        if (data.mint) {
          enqueue(data.mint, "pumpportal_new_token");
          console.log(`[NEW TOKEN] ${data.symbol ?? "UNKNOWN"} | ${data.mint}`);
        }
      } catch {
        // Ignore non-JSON messages.
      }
    });

    websocket.addEventListener("close", () => {
      if (!stopping) {
        console.log("[PUMPPORTAL] Disconnected. Reconnecting in 10 seconds.");
        setTimeout(connectPumpPortal, 10000);
      }
    });

    websocket.addEventListener("error", () => {
      console.log("[PUMPPORTAL] Connection error.");
    });
  } catch (error) {
    console.log(`[PUMPPORTAL ERROR] ${error.message}`);
    setTimeout(connectPumpPortal, 10000);
  }
}

function printStatus() {
  const stats = DB.prepare(`
    SELECT
      COUNT(*) AS registered,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active
    FROM market_pairs
  `).get();

  const discoveries = DB.prepare(`
    SELECT COUNT(*) AS total
    FROM discovery_events
  `).get();

  console.log("\n========== INFINITE DISCOVERY STATUS ==========");
  console.log(`Registered pairs: ${stats.registered ?? 0}`);
  console.log(`Active pairs: ${stats.active ?? 0}`);
  console.log(`Discovery events: ${discoveries.total ?? 0}`);
  console.log(`Pending token queue: ${pending.size}`);
  console.log(`Retry queue: ${retryQueue.size}`);
  console.log("Pair registry ceiling: NONE");
  console.log("===============================================\n");
}

process.on("SIGINT", () => {
  stopping = true;
  try {
    websocket?.close();
  } catch {}
  DB.close();
  console.log("\n[OFFLINE] Infinite pair discovery stopped.");
  process.exit(0);
});

console.log("========== ATUMPUMP INFINITE DISCOVERY ==========");
console.log("[ONLINE] Unlimited pair registration.");
console.log("[SOURCE 1] DexScreener latest Solana profiles.");
console.log("[SOURCE 2] PumpPortal new-token WebSocket.");
console.log("[FILTER] Pump.fun + wrapped SOL quote.");
console.log("[REGISTRY] No pair-count ceiling.");
console.log("[QUEUE] All discovered candidates processed.");
console.log("=================================================");

connectPumpPortal();

await seedLatestProfiles();

setInterval(seedLatestProfiles, DISCOVERY_INTERVAL_MS);
setInterval(processQueue, 3000);
setInterval(printStatus, 30000);

await processQueue();

while (!stopping) {
  await sleep(1000);
}
