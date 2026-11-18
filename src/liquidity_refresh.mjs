import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");
const INTERVAL = 60000;
const SOL_MINT = "So11111111111111111111111111111111111111112";

DB.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 15000;
`);

// A-LIST open-position pairs receive first priority.
DB.exec("ATTACH DATABASE 'ATUMPUMP_A_LIST/data/a_list.sqlite' AS alist");

const pairsQuery = DB.prepare(`
  SELECT mp.pair_address, mp.mint
  FROM market_pairs mp
  WHERE mp.active = 1
    AND mp.pair_address IS NOT NULL
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1
      FROM alist.trades tr
      WHERE tr.mint = mp.mint
        AND tr.status = 'OPEN'
    ) THEN 0 ELSE 1 END,
    COALESCE(mp.liquidity_checked_at, 0) ASC
  LIMIT 20
`);

const updatePair = DB.prepare(`
  UPDATE market_pairs
  SET
    liquidity_usd = COALESCE(?, liquidity_usd),
    volume_h24 = COALESCE(?, volume_h24),
    fdv = COALESCE(?, fdv),
    market_cap = COALESCE(?, market_cap),
    price_sol = COALESCE(?, price_sol),
    last_seen_at = ?
  WHERE pair_address = ?
`);

const insertObservation = DB.prepare(`
  INSERT INTO market_pair_observations (
    pair_address, mint, observed_at, price_sol,
    liquidity_usd, volume_h24, fdv, market_cap
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

async function refresh() {
  const registered = pairsQuery.all();

  let received = 0;
  let liquidityReceived = 0;
  let missing = 0;
  let failed = 0;
  let skipped = 0;

  for (const registeredPair of registered) {
    const address = registeredPair.pair_address;

    try {
      const url =
        `https://api.dexscreener.com/latest/dex/pairs/solana/${address}`;

      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        failed++;
        console.log(`[HTTP ${response.status}] ${address}`);
        continue;
      }

      const payload = await response.json();
      const pair = Array.isArray(payload.pairs)
        ? payload.pairs.find(item => item.pairAddress === address)
        : null;

      if (
        !pair ||
        pair.dexId !== "pumpfun" ||
        pair.quoteToken?.address !== SOL_MINT
      ) {
        skipped++;
        continue;
      }

      const liquidity = numeric(pair.liquidity?.usd);
      const volume = numeric(pair.volume?.h24);
      const fdv = numeric(pair.fdv);
      const marketCap = numeric(pair.marketCap);
      const price = numeric(pair.priceNative);
      const timestamp = Date.now();

      DB.exec("BEGIN IMMEDIATE");

      try {
        updatePair.run(
          liquidity,
          volume,
          fdv,
          marketCap,
          price,
          timestamp,
          address
        );

        insertObservation.run(
          address,
          registeredPair.mint,
          timestamp,
          price,
          liquidity,
          volume,
          fdv,
          marketCap
        );

        DB.exec("COMMIT");
      } catch (error) {
        DB.exec("ROLLBACK");
        throw error;
      }

      received++;

      if (liquidity !== null && liquidity > 0) {
        liquidityReceived++;
      } else {
        missing++;
      }

    } catch (error) {
      failed++;
      console.log(`[PAIR ERROR] ${address}: ${error.message}`);
    }
  }

  const coverage = DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN liquidity_usd > 0 THEN 1 ELSE 0 END) AS reported
    FROM market_pairs
    WHERE active = 1
  `).get();

  console.log("\n========== LIQUIDITY REFRESH ==========");
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Registered pairs: ${registered.length}`);
  console.log(`Pairs returned: ${received}`);
  console.log(`Liquidity received: ${liquidityReceived}`);
  console.log(`Liquidity missing: ${missing}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed requests: ${failed}`);
  console.log(`Current coverage: ${coverage.reported || 0}/${coverage.total}`);
  console.log("=======================================\n");
}

let running = false;

async function cycle() {
  if (running) return;
  running = true;

  try {
    await refresh();
  } catch (error) {
    console.error("[ENGINE ERROR]", error.message);
  } finally {
    running = false;
  }
}

console.log("[ONLINE] Direct DexScreener pair metadata refresh.");
console.log(`[ONLINE] Refresh interval: ${INTERVAL / 1000} seconds.`);
console.log("[ONLINE] Native SQLite transaction handling enabled.");

await cycle();

const timer = setInterval(cycle, INTERVAL);

process.on("SIGINT", () => {
  clearInterval(timer);
  DB.close();
  console.log("\n[STOPPED] Liquidity refresh engine.");
  process.exit(0);
});
