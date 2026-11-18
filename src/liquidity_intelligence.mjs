import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");
DB.exec("PRAGMA busy_timeout = 15000;");

const WINDOW = 86400000;

function money(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "NOT REPORTED";
  }
  return "$" + Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function signed(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "N/A";
  }
  const n = Number(value);
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function percent(first, last) {
  if (first === null || last === null || first === undefined ||
      last === undefined || Number(first) <= 0) return "N/A";

  const change = ((Number(last) - Number(first)) / Number(first)) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function render() {
  const now = Date.now();
  const start = now - WINDOW;

  const registry = DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN liquidity_usd IS NOT NULL
        AND liquidity_usd > 0 THEN 1 ELSE 0 END) AS reported
    FROM market_pairs
  `).get();

  const history = DB.prepare(`
    SELECT
      COUNT(*) AS observations,
      SUM(CASE WHEN liquidity_usd IS NOT NULL
        AND liquidity_usd > 0 THEN 1 ELSE 0 END) AS known,
      COUNT(DISTINCT pair_address) AS pairs
    FROM market_pair_observations
    WHERE observed_at >= ?
  `).get(start);

  const coverage = registry.total
    ? (Number(registry.reported || 0) / Number(registry.total)) * 100
    : 0;

  const liquidityRanking = DB.prepare(`
    SELECT mint, pair_address, liquidity_usd,
           volume_h24, price_sol, last_seen_at
    FROM market_pairs
    WHERE active = 1
      AND liquidity_usd IS NOT NULL
      AND liquidity_usd > 0
    ORDER BY liquidity_usd DESC
    LIMIT 15
  `).all();

  const volumeRanking = DB.prepare(`
    SELECT mint, pair_address, volume_h24,
           liquidity_usd, price_sol
    FROM market_pairs
    WHERE active = 1
      AND volume_h24 IS NOT NULL
    ORDER BY volume_h24 DESC
    LIMIT 10
  `).all();

  const trends = DB.prepare(`
    WITH recent AS (
      SELECT
        pair_address,
        liquidity_usd,
        observed_at,
        ROW_NUMBER() OVER (
          PARTITION BY pair_address ORDER BY observed_at ASC
        ) AS first_rank,
        ROW_NUMBER() OVER (
          PARTITION BY pair_address ORDER BY observed_at DESC
        ) AS last_rank
      FROM market_pair_observations
      WHERE observed_at >= ?
        AND liquidity_usd IS NOT NULL
        AND liquidity_usd > 0
    )
    SELECT
      pair_address,
      MAX(CASE WHEN first_rank = 1 THEN liquidity_usd END) AS first_liquidity,
      MAX(CASE WHEN last_rank = 1 THEN liquidity_usd END) AS last_liquidity,
      MAX(CASE WHEN first_rank = 1 THEN observed_at END) AS first_at,
      MAX(CASE WHEN last_rank = 1 THEN observed_at END) AS last_at,
      COUNT(*) AS samples
    FROM recent
    GROUP BY pair_address
    HAVING COUNT(*) >= 2
    ORDER BY
      (MAX(CASE WHEN last_rank = 1 THEN liquidity_usd END) -
       MAX(CASE WHEN first_rank = 1 THEN liquidity_usd END)) DESC
    LIMIT 15
  `).all(start);

  console.clear();
  console.log("⚡ ATUMPUMP — LIQUIDITY INTELLIGENCE ENGINE");
  console.log("LIVE LIQUIDITY COVERAGE AND TREND ANALYTICS");
  console.log(`Updated: ${new Date(now).toLocaleString()}`);
  console.log("=".repeat(88));

  console.log("\n01 — LIQUIDITY DATA COVERAGE");
  console.log("-".repeat(88));
  console.log(`Registered pairs:             ${registry.total}`);
  console.log(`Active pairs:                  ${registry.active || 0}`);
  console.log(`Pairs reporting liquidity:    ${registry.reported || 0}`);
  console.log(`Current liquidity coverage:   ${coverage.toFixed(2)}%`);
  console.log(`24H observations:             ${history.observations || 0}`);
  console.log(`24H observations with data:   ${history.known || 0}`);
  console.log(`Pairs observed in 24H:        ${history.pairs || 0}`);

  console.log("\n02 — HIGHEST REPORTED LIQUIDITY");
  console.log("-".repeat(88));

  if (!liquidityRanking.length) {
    console.log("No positive liquidity values currently reported by the data provider.");
  }

  liquidityRanking.forEach((pair, i) => {
    console.log(
      `${String(i + 1).padEnd(3)} ${pair.mint.slice(0, 16)} ` +
      `${money(pair.liquidity_usd).padEnd(18)} VOLUME ${money(pair.volume_h24)}`
    );
    console.log(`    PAIR: ${pair.pair_address}`);
  });

  console.log("\n03 — LIQUIDITY GROWTH AND DECLINE");
  console.log("-".repeat(88));

  if (!trends.length) {
    console.log("Waiting for at least two non-null liquidity observations per pair.");
  }

  trends.forEach((pair, i) => {
    const change = Number(pair.last_liquidity) - Number(pair.first_liquidity);

    console.log(`${i + 1}. ${pair.pair_address}`);
    console.log(`   FIRST: ${money(pair.first_liquidity)}`);
    console.log(`   LATEST: ${money(pair.last_liquidity)}`);
    console.log(`   CHANGE: ${signed(change)} (${percent(pair.first_liquidity, pair.last_liquidity)})`);
    console.log(`   SAMPLES: ${pair.samples}`);
  });

  console.log("\n04 — VOLUME / LIQUIDITY COMPARISON");
  console.log("-".repeat(88));

  volumeRanking.forEach((pair, i) => {
    const ratio = Number(pair.liquidity_usd) > 0
      ? (Number(pair.volume_h24) / Number(pair.liquidity_usd))
      : null;

    console.log(`${i + 1}. ${pair.mint.slice(0, 18)}`);
    console.log(`   VOLUME: ${money(pair.volume_h24)}`);
    console.log(`   LIQUIDITY: ${money(pair.liquidity_usd)}`);
    console.log(`   VOLUME / LIQUIDITY: ${ratio === null ? "N/A" : ratio.toFixed(3) + "x"}`);
  });

  console.log("\n05 — DATA QUALITY");
  console.log("-".repeat(88));
  console.log(`Liquidity source: DexScreener pair metadata`);
  console.log(`Missing liquidity values: ${Number(registry.total || 0) - Number(registry.reported || 0)}`);
  console.log("Missing values remain unreported; no estimated liquidity is substituted.");
  console.log("Analytics window: rolling 24 hours");
  console.log("\nRefresh interval: 15 seconds | CTRL+C to exit");
}

render();
const timer = setInterval(render, 15000);

process.on("SIGINT", () => {
  clearInterval(timer);
  DB.close();
  process.exit(0);
});
