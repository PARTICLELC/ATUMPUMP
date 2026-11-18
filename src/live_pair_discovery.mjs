import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");
DB.exec("PRAGMA busy_timeout=15000");

const SOL = "So11111111111111111111111111111111111111112";
const GECKO = "https://api.geckoterminal.com/api/v2";
const DEX = "https://api.dexscreener.com";

const LOOP_MS = 60000;
const DEX_CHUNK = 30;
const GECKO_PAGES = 1;

const seen = new Set();
let stopping = false;
let pumpSocket = null;
let cycle = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const n = value => {
  if (value === null || value === undefined || value === "") return null;
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) && valueNumber >= 0
    ? valueNumber
    : null;
};

const insertToken = DB.prepare(`
  INSERT INTO tokens (
    mint, name, symbol, first_seen_at, last_seen_at,
    discovery_source, pair_address, quote_mint, eligible
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(mint) DO UPDATE SET
    name = COALESCE(excluded.name, tokens.name),
    symbol = COALESCE(excluded.symbol, tokens.symbol),
    last_seen_at = excluded.last_seen_at,
    discovery_source = excluded.discovery_source,
    pair_address = COALESCE(excluded.pair_address, tokens.pair_address),
    quote_mint = COALESCE(excluded.quote_mint, tokens.quote_mint),
    eligible = 1
`);

const upsertPair = DB.prepare(`
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
    pair_url = COALESCE(excluded.pair_url, market_pairs.pair_url),
    price_sol = COALESCE(excluded.price_sol, market_pairs.price_sol),
    liquidity_usd = COALESCE(excluded.liquidity_usd, market_pairs.liquidity_usd),
    volume_h24 = COALESCE(excluded.volume_h24, market_pairs.volume_h24),
    fdv = COALESCE(excluded.fdv, market_pairs.fdv),
    market_cap = COALESCE(excluded.market_cap, market_pairs.market_cap),
    pair_created_at = COALESCE(excluded.pair_created_at, market_pairs.pair_created_at),
    last_seen_at = excluded.last_seen_at,
    active = 1
`);

const insertPairObservation = DB.prepare(`
  INSERT INTO market_pair_observations (
    pair_address, mint, observed_at, price_sol,
    liquidity_usd, volume_h24, fdv, market_cap
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertPriceObservation = DB.prepare(`
  INSERT INTO price_observations (
    mint, observed_at, price_sol, source, pair_address
  )
  VALUES (?, ?, ?, ?, ?)
`);

function savePair(pair) {
  if (!pair.mint || !pair.address) return false;

  const now = Date.now();

  insertToken.run(
    pair.mint,
    pair.name ?? null,
    pair.symbol ?? null,
    now,
    now,
    pair.source,
    pair.address,
    pair.quoteMint ?? null
  );

  upsertPair.run(
    pair.address,
    pair.mint,
    pair.dex ?? pair.source,
    "solana",
    pair.quoteMint ?? null,
    pair.url ?? null,
    pair.priceSol,
    pair.liquidity,
    pair.volume,
    pair.fdv,
    pair.marketCap,
    pair.createdAt,
    now,
    now
  );

  if (pair.priceSol !== null && pair.priceSol > 0) {
    insertPairObservation.run(
      pair.address,
      pair.mint,
      now,
      pair.priceSol,
      pair.liquidity,
      pair.volume,
      pair.fdv,
      pair.marketCap
    );

    insertPriceObservation.run(
      pair.mint,
      now,
      pair.priceSol,
      pair.source,
      pair.address
    );
  }

  return true;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...headers
    },
    signal: AbortSignal.timeout(20000)
  });

  if (response.status === 429) {
    throw new Error(`RATE_LIMIT ${url}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  return response.json();
}

// SOURCE 1: GeckoTerminal continuously publishes new Solana pools.
async function discoverGeckoPools() {
  let found = 0;

  for (let page = 1; page <= GECKO_PAGES && !stopping; page++) {
    const url = `${GECKO}/networks/solana/new_pools?page=${page}`;

    let result;
    try {
      result = await getJson(url, {
        "x-cg-demo-api-key": ""
      });
    } catch (error) {
      console.log(`[GECKO] Page ${page}: ${error.message}`);
      break;
    }

    for (const item of result.data ?? []) {
      const a = item.attributes ?? {};
      const rel = item.relationships ?? {};

      const base = rel.base_token?.data?.id?.replace(
        "solana_", ""
      );

      const quote = rel.quote_token?.data?.id?.replace(
        "solana_", ""
      );

      if (!base || !quote || quote !== SOL) continue;

      const priceUsd = n(a.base_token_price_usd);
      const quoteUsd = n(a.quote_token_price_usd);
      const priceSol = priceUsd && quoteUsd
        ? priceUsd / quoteUsd
        : null;

      const pairAddress = a.address;
      if (!pairAddress) continue;

      try {
        savePair({
          mint: base,
          address: pairAddress,
          name: a.name ?? null,
          symbol: null,
          dex: "geckoterminal",
          source: "geckoterminal_new_pools",
          quoteMint: quote,
          url: `https://www.geckoterminal.com/solana/pools/${pairAddress}`,
          priceSol,
          liquidity: n(a.reserve_in_usd),
          volume: n(a.volume_usd?.h24),
          fdv: n(a.fdv_usd),
          marketCap: n(a.market_cap_usd),
          createdAt: a.pool_created_at
            ? Date.parse(a.pool_created_at)
            : null
        });
        found++;
      } catch (error) {
        console.log(`[GECKO SAVE] ${error.message}`);
      }
    }

    await sleep(400);
  }

  console.log(`[GECKO] New-pool feed processed: ${found} SOL pools`);
  return found;
}

// SOURCE 2: DexScreener latest token profiles -> all returned SOL pairs.
async function discoverDexProfiles() {
  let profiles;

  try {
    profiles = await getJson(
      `${DEX}/token-profiles/latest/v1`
    );
  } catch (error) {
    console.log(`[DEX PROFILES] ${error.message}`);
    return 0;
  }

  const mints = [...new Set(
    (Array.isArray(profiles) ? profiles : [])
      .filter(item => item.chainId === "solana")
      .map(item => item.tokenAddress)
      .filter(Boolean)
  )];

  let found = 0;

  for (let offset = 0; offset < mints.length; offset += DEX_CHUNK) {
    const batch = mints.slice(offset, offset + DEX_CHUNK);

    try {
      const pairs = await getJson(
        `${DEX}/tokens/v1/solana/${batch.join(",")}`
      );

      for (const pair of Array.isArray(pairs) ? pairs : []) {
        if (
          pair.chainId !== "solana" ||
          pair.quoteToken?.address !== SOL ||
          !pair.pairAddress
        ) continue;

        const price = n(pair.priceNative);
        if (!price || price <= 0) continue;

        savePair({
          mint: pair.baseToken?.address,
          address: pair.pairAddress,
          name: pair.baseToken?.name,
          symbol: pair.baseToken?.symbol,
          dex: pair.dexId,
          source: "dexscreener_live_profile",
          quoteMint: SOL,
          url: pair.url,
          priceSol: price,
          liquidity: n(pair.liquidity?.usd),
          volume: n(pair.volume?.h24),
          fdv: n(pair.fdv),
          marketCap: n(pair.marketCap),
          createdAt: n(pair.pairCreatedAt)
        });

        found++;
      }
    } catch (error) {
      console.log(`[DEX PAIRS] ${error.message}`);
    }

    await sleep(1200);
  }

  console.log(
    `[DEX] Latest profiles: ${mints.length} tokens; ${found} SOL pairs`
  );

  return found;
}

// SOURCE 3: PumpPortal continuous new-token WebSocket.
function startPumpPortal() {
  if (pumpSocket) return;

  try {
    pumpSocket = new WebSocket("wss://pumpportal.fun/api/data");

    pumpSocket.onopen = () => {
      console.log("[PUMPPORTAL] Connected: new token stream");
      pumpSocket.send(JSON.stringify({
        method: "subscribeNewToken"
      }));
    };

    pumpSocket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        const mint = data.mint;
        if (!mint) return;

        const now = Date.now();

        insertToken.run(
          mint,
          data.name ?? null,
          data.symbol ?? null,
          now,
          now,
          "pumpportal_live_new_token",
          null,
          SOL
        );

        console.log(
          `[NEW TOKEN] ${data.symbol ?? "UNKNOWN"} ${mint}`
        );
      } catch (error) {
        console.log(`[PUMPPORTAL MESSAGE] ${error.message}`);
      }
    };

    pumpSocket.onerror = () => {
      console.log("[PUMPPORTAL] WebSocket error");
    };

    pumpSocket.onclose = () => {
      pumpSocket = null;
      if (!stopping) {
        console.log("[PUMPPORTAL] Reconnecting in 5 seconds");
        setTimeout(startPumpPortal, 5000);
      }
    };
  } catch (error) {
    console.log(`[PUMPPORTAL] ${error.message}`);
    pumpSocket = null;
    setTimeout(startPumpPortal, 5000);
  }
}

async function main() {
  console.log("==============================================");
  console.log("ATUMPUMP — CONTINUOUS LIVE PAIR DISCOVERY");
  console.log("==============================================");
  console.log("Discovery input: LIVE PUBLIC SOURCES");
  console.log("Storage query dependency: NONE");
  console.log("Sources: GeckoTerminal + DexScreener + PumpPortal");
  console.log("SOL quote filter: ENABLED");
  console.log("Market cap: actual source marketCap fields");
  console.log("Leaderboard threshold: $230,000");
  console.log("==============================================");

  startPumpPortal();

  while (!stopping) {
    cycle++;
    const start = Date.now();

    console.log(`\n========== DISCOVERY CYCLE ${cycle} ==========`);

    const geckoCount = await discoverGeckoPools();
    const dexCount = await discoverDexProfiles();

    const total = DB.prepare(`
      SELECT COUNT(*) AS pairs,
             COUNT(DISTINCT mint) AS mints,
             COUNT(DISTINCT CASE
               WHEN market_cap >= 230000 THEN mint
             END) AS qualified
      FROM market_pairs
      WHERE active = 1
    `).get();

    console.log(`New-source Gecko saves: ${geckoCount}`);
    console.log(`New-source Dex saves: ${dexCount}`);
    console.log(`Database pair records: ${total.pairs}`);
    console.log(`Distinct pair mints: ${total.mints}`);
    console.log(`Mints >= $230K: ${total.qualified}`);
    console.log(`Cycle duration: ${Date.now() - start}ms`);
    console.log("Next live discovery cycle in 12 seconds.");

    await sleep(LOOP_MS);
  }
}

process.on("SIGINT", () => {
  stopping = true;
  try { pumpSocket?.close(); } catch {}
  DB.close();
  process.exit(0);
});

main().catch(error => {
  console.error("[DISCOVERY FATAL]", error);
  try { DB.close(); } catch {}
  process.exit(1);
});
