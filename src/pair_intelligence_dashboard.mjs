import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");
const REFRESH_MS = 15000;

DB.exec("PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;");

const hasTable = name => DB.prepare(`
  SELECT 1 FROM sqlite_master WHERE type='table' AND name=?
`).get(name) !== undefined;

const money = value => value == null
  ? "N/A"
  : "$" + Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

const number = value => Number(value || 0).toLocaleString("en-US");
const short = value => value ? `${value.slice(0, 8)}...${value.slice(-6)}` : "N/A";
const timestamp = value => value ? new Date(Number(value)).toLocaleString() : "N/A";

function render() {
  console.clear();

  const totals = DB.prepare(`
    SELECT
      COUNT(*) AS registered,
      SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN liquidity_usd > 0 THEN 1 ELSE 0 END) AS registry_coverage
    FROM market_pairs
  `).get();

  const gecko = hasTable("liquidity_source_observations")
    ? DB.prepare(`
        WITH latest AS (
          SELECT pair_address, mint, liquidity_usd, observed_at,
            ROW_NUMBER() OVER (
              PARTITION BY pair_address ORDER BY observed_at DESC
            ) AS rn
          FROM liquidity_source_observations
          WHERE source='geckoterminal'
            AND liquidity_usd > 0
        )
        SELECT
          COUNT(*) AS covered,
          SUM(liquidity_usd) AS total_liquidity,
          MAX(observed_at) AS latest
        FROM latest WHERE rn=1
      `).get()
    : { covered: 0, total_liquidity: 0, latest: null };

  const topLiquidity = hasTable("liquidity_source_observations")
    ? DB.prepare(`
        WITH latest AS (
          SELECT pair_address, mint, liquidity_usd, observed_at,
            ROW_NUMBER() OVER (
              PARTITION BY pair_address ORDER BY observed_at DESC
            ) AS rn
          FROM liquidity_source_observations
          WHERE source='geckoterminal'
            AND liquidity_usd > 0
        )
        SELECT pair_address, mint, liquidity_usd, observed_at
        FROM latest WHERE rn=1
        ORDER BY liquidity_usd DESC LIMIT 10
      `).all()
    : [];

  const trends = hasTable("liquidity_source_observations")
    ? DB.prepare(`
        WITH ranked AS (
          SELECT pair_address, liquidity_usd, observed_at,
            ROW_NUMBER() OVER (
              PARTITION BY pair_address ORDER BY observed_at ASC
            ) AS first_rank,
            ROW_NUMBER() OVER (
              PARTITION BY pair_address ORDER BY observed_at DESC
            ) AS last_rank
          FROM liquidity_source_observations
          WHERE source='geckoterminal'
            AND liquidity_usd > 0
            AND observed_at >= ?
        ),
        first_values AS (
          SELECT pair_address, liquidity_usd AS opening
          FROM ranked WHERE first_rank=1
        ),
        last_values AS (
          SELECT pair_address, liquidity_usd AS closing
          FROM ranked WHERE last_rank=1
        )
        SELECT f.pair_address, f.opening, l.closing,
          l.closing-f.opening AS change_usd,
          CASE WHEN f.opening > 0
            THEN ((l.closing-f.opening)/f.opening)*100
            ELSE NULL END AS change_pct
        FROM first_values f
        JOIN last_values l USING(pair_address)
        WHERE f.opening != l.closing
        ORDER BY change_usd DESC LIMIT 10
      `).all(Date.now() - 86400000)
    : [];

  const pairChanges = hasTable("pair_change_events")
    ? DB.prepare(`
        SELECT mint, event_type, previous_pair_address,
          new_pair_address, event_at
        FROM pair_change_events
        ORDER BY event_at DESC LIMIT 12
      `).all()
    : [];

  const identities = hasTable("pair_identity_history")
    ? DB.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active
        FROM pair_identity_history
      `).get()
    : { total: 0, active: 0 };

  const activity = hasTable("liquidity_source_observations")
    ? DB.prepare(`
        SELECT result, COUNT(*) AS total,
          SUM(CASE WHEN liquidity_usd > 0 THEN 1 ELSE 0 END) AS reported
        FROM liquidity_source_observations
        WHERE source='geckoterminal' AND observed_at >= ?
        GROUP BY result ORDER BY result
      `).all(Date.now() - 86400000)
    : [];

  console.log("============================================================");
  console.log("          ATUMPUMP PAIR INTELLIGENCE CENTER");
  console.log("============================================================");
  console.log(`Updated: ${new Date().toLocaleString()}`);

  console.log("\n01 — PAIR REGISTRY");
  console.log(`Registered: ${number(totals.registered)}`);
  console.log(`Active: ${number(totals.active)}`);
  console.log(`Pair identities: ${number(identities.total)}`);
  console.log(`Active identities: ${number(identities.active)}`);

  console.log("\n02 — LIQUIDITY SOURCE COVERAGE");
  console.log(`DexScreener registry coverage: ${number(totals.registry_coverage)}`);
  console.log(`GeckoTerminal observed pairs: ${number(gecko.covered)}`);
  console.log(`Latest reported liquidity: ${money(gecko.total_liquidity)}`);
  console.log(`Latest successful capture: ${timestamp(gecko.latest)}`);

  console.log("\n03 — TOP REPORTED LIQUIDITY");
  if (!topLiquidity.length) {
    console.log("No successful liquidity observations yet.");
  } else {
    console.log("PAIR                 LIQUIDITY       LAST CAPTURE");
    console.log("------------------------------------------------------------");
    for (const item of topLiquidity) {
      console.log(
        `${short(item.pair_address).padEnd(20)} ` +
        `${money(item.liquidity_usd).padEnd(15)} ` +
        `${timestamp(item.observed_at)}`
      );
    }
  }

  console.log("\n04 — LIQUIDITY GROWTH / DECLINE (OBSERVED WINDOW UP TO 24H)");
  if (!trends.length) {
    console.log("Waiting for multiple successful observations per pair.");
  } else {
    for (const item of trends) {
      const sign = item.change_usd > 0 ? "+" : "";
      console.log(
        `${short(item.pair_address)} | ${money(item.opening)} -> ` +
        `${money(item.closing)} | ${sign}${money(item.change_usd)} | ` +
        `${item.change_pct.toFixed(4)}%`
      );
    }
  }

  console.log("\n05 — PAIR CHANGE HISTORY");
  if (!pairChanges.length) {
    console.log("No pair transitions recorded since tracker installation.");
  } else {
    for (const event of pairChanges) {
      console.log(
        `${timestamp(event.event_at)} | ${event.event_type} | ${short(event.mint)}`
      );
      if (event.previous_pair_address) console.log(`  Previous: ${event.previous_pair_address}`);
      if (event.new_pair_address) console.log(`  Current:  ${event.new_pair_address}`);
    }
  }

  console.log("\n06 — GECKOTERMINAL SOURCE ACTIVITY (24H)");
  if (!activity.length) console.log("No observations recorded.");
  for (const item of activity) {
    console.log(
      `${item.result} | ${number(item.total)} observations | ` +
      `${number(item.reported)} with liquidity`
    );
  }

  console.log("\n07 — SYSTEM STATUS");
  console.log("DexScreener: PRIMARY METADATA SOURCE");
  console.log("GeckoTerminal: SECONDARY LIQUIDITY SOURCE");
  console.log("Pair-change tracker: " + (hasTable("pair_change_events") ? "ONLINE" : "NOT INSTALLED"));
  console.log("Championship scoring: UNCHANGED");
  console.log("Round duration: 432 SECONDS");
  console.log("============================================================");
  console.log("Refresh: 15 seconds | CTRL+C to exit");
}

process.on("SIGINT", () => {
  DB.close();
  console.log("\n[OFFLINE] Pair Intelligence Center stopped.");
  process.exit(0);
});

console.log("[ONLINE] Integrated Pair Intelligence Center.");

while (true) {
  try {
    render();
  } catch (error) {
    console.error("[DASHBOARD ERROR]", error.message);
  }
  await new Promise(resolve => setTimeout(resolve, REFRESH_MS));
}
