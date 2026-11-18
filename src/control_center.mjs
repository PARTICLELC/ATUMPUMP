import { DatabaseSync } from "node:sqlite";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { refreshLegendaryPower } from "./legendary_power.mjs";

const DB = new DatabaseSync("data/atumpump.sqlite");
DB.exec("PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;");

const C = {
  reset: "\x1b[0m",
  cyan: "\x1b[97m",
  gold: "\x1b[92m",
  green: "\x1b[92m",
  red: "\x1b[97m",
  dim: "\x1b[2m",
  white: "\x1b[97m"
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = question =>
  new Promise(resolve => rl.question(question, resolve));

const exists = table => Boolean(DB.prepare(`
  SELECT 1 FROM sqlite_master
  WHERE type='table' AND name=?
`).get(table));

const columns = table => exists(table)
  ? DB.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name)
  : [];

const quote = name => `"${String(name).replaceAll('"', '""')}"`;

const count = table => exists(table)
  ? DB.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get().n
  : 0;

const fmt = value => {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "number") return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 10
  });
  if (typeof value === "string" && value.length > 85) {
    return value.slice(0, 82) + "...";
  }
  return String(value);
};

const money = value => value == null
  ? "N/A"
  : Number(value).toFixed(12);

function title(text) {
  console.log(`\n${C.white}============================================================`);
  console.log(` ${text}`);
  console.log(`============================================================${C.reset}`);
}

function table(rows, preferred = []) {
  if (!rows.length) {
    console.log(`${C.dim}No records available.${C.reset}`);
    return;
  }

  const keys = [
    ...preferred.filter(k => k in rows[0]),
    ...Object.keys(rows[0]).filter(k => !preferred.includes(k))
  ];

  for (const row of rows) {
    console.log("--------------------------------------------");
    for (const key of keys) {
      console.log(`${C.white}${key}${C.reset}: ${fmt(row[key])}`);
    }
  }
}

function latestRound() {
  if (!exists("rounds")) return null;

  return DB.prepare(`
    SELECT * FROM rounds
    WHERE status='active'
    ORDER BY id DESC LIMIT 1
  `).get() ?? null;
}

function liveMarketScanner() {
  title("01 — LIVE MARKET SCANNER");

  if (!exists("market_pairs")) return console.log("Pair registry unavailable.");

  const pairs = DB.prepare(`
    SELECT mp.pair_address, mp.mint, t.symbol, t.name,
      mp.price_sol, mp.liquidity_usd, mp.volume_h24,
      mp.liquidity_source, mp.last_seen_at, mp.active
    FROM market_pairs mp
    LEFT JOIN tokens t ON t.mint=mp.mint
    WHERE mp.active=1
    ORDER BY COALESCE(mp.liquidity_usd,0) DESC
  `).all();

  console.log(`Active registered pairs: ${pairs.length}`);

  for (const p of pairs) {
    console.log(`\n${C.white}${p.symbol ?? "UNKNOWN"}${C.reset} | ${p.mint}`);
    console.log(`Pair: ${p.pair_address}`);
    console.log(`SOL price: ${money(p.price_sol)}`);
    console.log(`Liquidity: ${fmt(p.liquidity_usd)}`);
    console.log(`24h volume: ${fmt(p.volume_h24)}`);
    console.log(`Liquidity source: ${fmt(p.liquidity_source)}`);
  }
}







function rollingUsdMovers() {
  const now = Date.now();
  const baselineBoundary = now - 3600000;
  const roundBoundary = now - 432000;

  return DB.prepare(`
    WITH latest AS (
      SELECT
        mpo.mint,
        mpo.pair_address,
        mpo.observed_at,
        mpo.id,
        mpo.price_sol,
        ROW_NUMBER() OVER (
          PARTITION BY mpo.mint, mpo.pair_address
          ORDER BY mpo.observed_at DESC, mpo.id DESC
        ) AS latest_rank
      FROM market_pair_observations mpo
      WHERE mpo.price_sol > 0
        AND mpo.pair_address IS NOT NULL
        AND mpo.observed_at <= ?
    ),
    baseline AS (
      SELECT
        mpo.mint,
        mpo.pair_address,
        mpo.price_sol AS personal_opening_price,
        mpo.observed_at AS personal_opening_at
      FROM market_pair_observations mpo
      WHERE mpo.price_sol > 0
        AND mpo.pair_address IS NOT NULL
        AND mpo.observed_at <= ?
        AND mpo.id = (
          SELECT p2.id
          FROM market_pair_observations p2
          WHERE p2.mint = mpo.mint
            AND p2.pair_address = mpo.pair_address
            AND p2.price_sol > 0
            AND p2.observed_at <= ?
          ORDER BY p2.observed_at DESC, p2.id DESC
          LIMIT 1
        )
    ),
    round_open AS (
      SELECT
        mpo.mint,
        mpo.pair_address,
        mpo.price_sol AS round_opening_price,
        mpo.observed_at AS round_opening_at
      FROM market_pair_observations mpo
      WHERE mpo.price_sol > 0
        AND mpo.pair_address IS NOT NULL
        AND mpo.observed_at >= ?
        AND mpo.observed_at <= ?
        AND mpo.id = (
          SELECT p2.id
          FROM market_pair_observations p2
          WHERE p2.mint = mpo.mint
            AND p2.pair_address = mpo.pair_address
            AND p2.price_sol > 0
            AND p2.observed_at >= ?
            AND p2.observed_at <= ?
          ORDER BY p2.observed_at ASC, p2.id ASC
          LIMIT 1
        )
    ),
    sample_counts AS (
      SELECT
        mint,
        pair_address,
        COUNT(*) AS sample_count
      FROM market_pair_observations
      WHERE price_sol > 0
        AND pair_address IS NOT NULL
        AND observed_at BETWEEN ? AND ?
      GROUP BY mint, pair_address
    ),
    qualified AS (
      SELECT
        l.mint,
        l.pair_address,
        l.price_sol AS current_price,
        b.personal_opening_price,
        r.round_opening_price,
        b.personal_opening_at,
        l.observed_at AS current_observed_at,
        COALESCE(sc.sample_count, 0) AS sample_count,
        ((l.price_sol / b.personal_opening_price) - 1) * 100
          AS personal_gain_percent,
        CASE
          WHEN r.round_opening_price > 0
          THEN ((l.price_sol / r.round_opening_price) - 1) * 100
          ELSE NULL
        END AS round_gain_percent
      FROM latest l
      JOIN baseline b
        ON b.mint = l.mint
       AND b.pair_address = l.pair_address
      LEFT JOIN round_open r
        ON r.mint = l.mint
       AND r.pair_address = l.pair_address
      LEFT JOIN sample_counts sc
        ON sc.mint = l.mint
       AND sc.pair_address = l.pair_address
      WHERE l.latest_rank = 1
        AND b.personal_opening_price > 0
        AND l.price_sol > 0
        AND l.observed_at > b.personal_opening_at
        AND ((l.price_sol / b.personal_opening_price) - 1) * 100 >= 13.0
    )
    SELECT
      q.mint,
      t.symbol,
      t.name,
      q.pair_address,
      q.personal_opening_price,
      q.personal_gain_percent,
      q.round_opening_price AS opening_price_usd,
      q.current_price AS current_price_usd,
      CASE
        WHEN q.round_opening_price > 0
        THEN q.current_price - q.round_opening_price
        ELSE NULL
      END AS movement_usd,
      q.round_gain_percent AS movement_percent,
      q.sample_count
    FROM qualified q
    LEFT JOIN tokens t ON t.mint = q.mint
    ORDER BY
      q.round_gain_percent DESC,
      q.personal_gain_percent DESC
    LIMIT 10
  `).all(
    now,
    baselineBoundary,
    baselineBoundary,
    roundBoundary,
    now,
    roundBoundary,
    now,
    baselineBoundary,
    now
  );
}

function leaderboard() {
  const reset = C.reset;
  const green = C.green;
  const white = C.white;
  const dim = C.dim;

  const line = "━".repeat(76);
  const thin = "─".repeat(76);

  const formatTokenUsd = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    return "$" + number.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 14
    });
  };

  const formatMarketUsd = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0
      ? "$" + number.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      : "WAITING FOR DATA";
  };

  console.log(`\n${green}${line}${reset}`);
  console.log(`${green}  02  /  LIVE PIP GAIN CHAMPIONSHIP${reset}`);
  console.log(`${green}${line}${reset}`);

  const end = Date.now();
  const start = end - 432000;

  // OMNICIPHERIST: 7.2-minute championship qualification.
  const ENTRY_THRESHOLD_PERCENT = 13.00;
  const entries = rollingUsdMovers()
    .filter(entry => {
      const gain = Number(entry.movement_percent);
      return Number.isFinite(gain) && gain >= ENTRY_THRESHOLD_PERCENT;
    })
    .sort((a, b) =>
      Number(b.movement_percent) - Number(a.movement_percent)
    )
    .slice(0, 10);

  console.log(`${white}  WINDOW START     ${new Date(start).toLocaleString()}`);
  console.log(`  WINDOW END       ${new Date(end).toLocaleString()}`);
  console.log(`  DURATION         432 SECONDS`);
  console.log(`  ENTRY THRESHOLD  +13.00%`);
  console.log(`  BASELINE         60 MINUTES`);
  console.log(`  QUALIFIED PAIRS  ${entries.length}${reset}`);
  console.log("");
  console.log(`${green}  RANKING: HIGHEST PERCENTAGE MOVEMENT → LOWEST${reset}`);
  console.log(`${green}${thin}${reset}`);

  if (!entries.length) {
    console.log(`${white}  Waiting for two observations per pair and a round opening price.${reset}`);
    return;
  }

  const medals = ["🏆", "🥈", "🥉"];

  const marketDataQuery = DB.prepare(`
    SELECT
      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = ?
          AND mpo.pair_address = ?
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS volume_h24,
      (
        SELECT mpo.market_cap
        FROM market_pair_observations mpo
        WHERE mpo.mint = ?
          AND mpo.pair_address = ?
          AND mpo.market_cap IS NOT NULL
          AND mpo.market_cap > 0
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS market_cap
  `);

  for (const [index, entry] of entries.entries()) {
    const movement = Number(entry.movement_usd);
    const percent = Number(entry.movement_percent);
    const opening = Number(entry.opening_price_usd);
    const current = Number(entry.current_price_usd);

    const market = marketDataQuery.get(
      entry.mint,
      entry.pair_address,
      entry.mint,
      entry.pair_address
    );

    const personalPercent = Number(entry.personal_gain_percent);
    const personalGain = `${personalPercent >= 0 ? "+" : ""}${personalPercent.toFixed(2)}%`;
    const gain = Number.isFinite(percent)
      ? `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`
      : "N/A";
    const movementText =
      `${movement >= 0 ? "+" : "-"}${formatTokenUsd(Math.abs(movement))}`;

    const rank = medals[index] || `#${String(index + 1).padStart(2, "0")}`;
    const identity = `${entry.name || "UNKNOWN"} (${entry.symbol || "UNKNOWN"})`;

    console.log("");
    console.log(`${green}  ${rank}  ${identity}${reset}`);
    console.log(`${green}  PERSONAL GAIN  ${personalGain}${reset}`);
    console.log(`${green}  PERSONAL GAIN  ${personalGain}${reset}`);
    console.log(`${green}  PERSONAL PIP GAIN  ${personalGain}${reset}`);
    console.log(`${green}  ROUND PIP GAIN     ${gain}${reset}`);
    console.log(`${white}  PRICE       ${formatTokenUsd(current)}`);
    console.log(`  USD CHANGE  ${movementText}`);
    console.log(`  OPEN / NOW  ${formatTokenUsd(opening)}  →  ${formatTokenUsd(current)}`);
    console.log(`  MARKET CAP  ${formatMarketUsd(market.market_cap)}`);
    console.log(`  24H VOLUME  ${formatMarketUsd(market.volume_h24)}`);
    console.log(`  SAMPLES     ${entry.sample_count}`);
    console.log(`  MINT        ${entry.mint}`);
    console.log(`  PAIR        ${entry.pair_address}${reset}`);
    console.log(`${dim}${thin}${reset}`);
  }

  console.log(`${green}  END OF TOP ${entries.length} MOVERS${reset}`);
  console.log(`${white}  MEASUREMENT WINDOW: 432 SECONDS${reset}`);
  console.log(`${green}${line}${reset}`);
}

function championHolder() {
  title("03 — CHAMPION HOLDER");

  if (!exists("champion_holder")) {
    return console.log("Champion holder table unavailable.");
  }

  const rows = DB.prepare(`
    SELECT
      ch.*,
      t.name AS token_name,
      t.symbol AS token_symbol,
      (
        SELECT mpo.price_sol * COALESCE(
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
              AND po.observed_at <= mpo.observed_at
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          ),
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          )
        )
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS price_usd,
      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS volume_h24,
      (
        SELECT mpo.market_cap
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.market_cap IS NOT NULL
          AND mpo.market_cap > 0
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS market_cap,
      (
        SELECT mpo.price_sol * COALESCE(
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
              AND po.observed_at <= mpo.observed_at
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          ),
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          )
        )
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
          AND mpo.observed_at >= ch.since_at
        ORDER BY mpo.observed_at ASC, mpo.id ASC
        LIMIT 1
      ) AS opening_price_usd,
      (
        SELECT COUNT(*)
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
          AND mpo.observed_at >= ch.since_at
      ) AS sample_count,
      (
        SELECT mpo.pair_address
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS pair_address
    FROM champion_holder ch
    LEFT JOIN tokens t ON t.mint = ch.mint
  `).all();

  if (!rows.length) {
    console.log("No champion crowned yet.");
    return;
  }

  const usd = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "WAITING FOR DATA";
    return "$" + number.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 14
    }) + " USD";
  };

  const signedUsd = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "WAITING FOR DATA";
    return `${number >= 0 ? "+" : "-"}${usd(Math.abs(number))}`;
  };

  for (const row of rows) {
    const price = Number(row.price_usd);
    const opening = Number(row.opening_price_usd);
    const movement = price - opening;
    const gainPercent = opening > 0
      ? ((price - opening) / opening) * 100
      : NaN;

    const volume = Number(row.volume_h24);
    const marketCap = Number(row.market_cap);
    const gain = Number.isFinite(gainPercent)
      ? `${gainPercent >= 0 ? "+" : ""}${gainPercent.toFixed(2)}%`
      : "WAITING FOR OPENING PRICE";

    const line = "━".repeat(68);
    const thin = "─".repeat(68);

    console.log("");
    console.log(`${C.green}${line}${C.reset}`);
    console.log(`${C.green}  🏆  CURRENT CHAMPION${C.reset}`);
    console.log(`${C.green}${line}${C.reset}`);
    console.log(`${C.white}  TOKEN       ${row.token_name || "NAME NOT REGISTERED"}`);
    console.log(`  TICKER      ${row.token_symbol || "TICKER NOT REGISTERED"}${C.reset}`);
    console.log(`${C.green}  ROUND GAIN  ${gain}${C.reset}`);
    console.log(`${C.green}${thin}${C.reset}`);
    console.log(`${C.white}  CURRENT PRICE   ${usd(price)}`);
    console.log(`  OPENING PRICE   ${usd(opening)}`);
    console.log(`  USD MOVEMENT    ${signedUsd(movement)}`);
    console.log(`  24H VOLUME      ${usd(volume)}`);
    console.log(`  MARKET CAP      ${usd(marketCap)}`);
    console.log(`  ROUND           ${row.round_id}`);
    console.log(`  SAMPLES         ${row.sample_count}`);
    console.log(`  SINCE           ${row.since_at}`);
    console.log(`  PAIR            ${row.pair_address || "PAIR NOT AVAILABLE"}`);
    console.log(`  MINT            ${row.mint}${C.reset}`);
    console.log(`${C.green}${line}${C.reset}`);
  }
}

async function watchlist() {
  const renderWatchlist = () => {
    console.clear();
    title("04 — CHAMPIONSHIP WATCHLIST");

  if (!exists("championship_watchlist")) {
    return console.log("Watchlist table unavailable.");
  }

  const rows = DB.prepare(`
    SELECT
      w.*,
      t.name AS token_name,
      t.symbol AS token_symbol,
      (
        SELECT mpo.price_sol * COALESCE(
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
              AND po.observed_at <= mpo.observed_at
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          ),
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          )
        )
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS price_usd,
      (
        SELECT mpo.price_sol
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.price_sol > 0
          AND mpo.observed_at >= w.added_at
        ORDER BY mpo.observed_at ASC, mpo.id ASC
        LIMIT 1
      ) AS entry_price_sol,
      (
        SELECT mpo.price_sol
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.price_sol > 0
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS latest_price_sol,
      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS volume_h24,
      (
        SELECT mpo.market_cap
        FROM market_pair_observations mpo
        WHERE mpo.mint = w.mint
          AND mpo.market_cap > 0
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS market_cap
    FROM championship_watchlist w
    LEFT JOIN tokens t ON t.mint = w.mint
  `).all();

  if (!rows.length) {
    console.log("Championship watchlist is empty.");
    return;
  }

  const getLiveGain = row => {
    const entry = Number(row.entry_price_sol);
    const latest = Number(row.latest_price_sol);
    return Number.isFinite(entry) && entry > 0 &&
      Number.isFinite(latest) && latest > 0
      ? ((latest / entry) - 1) * 100
      : null;
  };

  rows.sort((a, b) => {
    const gainA = getLiveGain(a);
    const gainB = getLiveGain(b);

    if (gainA === null && gainB === null) return 0;
    if (gainA === null) return 1;
    if (gainB === null) return -1;
    return gainB - gainA;
  });

  const money = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? "$" + number.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }) + " USD"
      : "WAITING FOR DATA";
  };

  const qualifyingRows = rows.filter(row => {
    const entryPrice = Number(row.entry_price_sol);
    const latestPrice = Number(row.latest_price_sol);

    if (
      !Number.isFinite(entryPrice) || entryPrice <= 0 ||
      !Number.isFinite(latestPrice) || latestPrice <= 0
    ) return false;

    return ((latestPrice / entryPrice) - 1) * 100 >= 80;
  });

  console.log(`QUALIFIED WATCHLIST PAIRS: ${qualifyingRows.length}`);
  console.log("ADMISSION THRESHOLD: +80.00% LIVE GAIN");

  if (qualifyingRows.length === 0) {
    console.log("No watchlist pairs currently meet the +80.00% threshold.");
  }

  for (const row of qualifyingRows) {
    console.log("--------------------------------------------");
    console.log(`TOKEN NAME: ${row.token_name || "NAME NOT REGISTERED"}`);
    console.log(`TOKEN TICKER: ${row.token_symbol || "TICKER NOT REGISTERED"}`);
    console.log(`CURRENT TOKEN VALUE: ${money(row.price_usd)}`);
    const entryPrice = Number(row.entry_price_sol);
    const latestPrice = Number(row.latest_price_sol);
    const liveGain = Number.isFinite(entryPrice) && entryPrice > 0 &&
      Number.isFinite(latestPrice) && latestPrice > 0
      ? ((latestPrice / entryPrice) - 1) * 100
      : null;
    console.log(`LIVE GAIN PERCENTAGE: ${
      liveGain === null
        ? "WAITING FOR PRICE HISTORY"
        : (liveGain > 0 ? "+" : "") + liveGain.toFixed(2) + "%"
    }`);
    console.log(`TOTAL 24H TRADING VOLUME: ${money(row.volume_h24)}`);
    console.log(`MARKET CAPITALIZATION: ${money(row.market_cap)}`);
    console.log(`MINT: ${row.mint}`);
    console.log(`ADDED AT: ${row.added_at}`);
    console.log(`REASON: ${row.reason}`);
  }
  };

  renderWatchlist();
  console.log("\n[LIVE] Watchlist refreshes every 72 seconds.");
  console.log("[CONTROL] Press ENTER to return to Control Center.");

  const refresh = setInterval(() => {
    try {
      renderWatchlist();
      console.log("\n[LIVE] Next refresh in 72 seconds.");
    } catch (error) {
      console.log(`[WATCHLIST REFRESH ERROR] ${error.message}`);
    }
  }, 72000);

  try {
    await ask("");
  } finally {
    clearInterval(refresh);
  }
}
function trophies() {
  title("05 — TROPHY COLLECTION + DIRECTION POWER");
  refreshLegendaryPower(DB);

  const cutoff = Date.now() - 360 * 60 * 1000;

  const formatSol = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    return number.toFixed(18).replace(/\.?0+$/, "");
  };

  const field = (label, value) =>
    console.log(`${C.white}${label.padEnd(25)}${C.reset}${value}`);

  const stats = exists("champion_stats")
    ? DB.prepare(`
        SELECT * FROM champion_stats
        WHERE trophy_count > 0
        ORDER BY trophy_count DESC, best_movement_sol DESC
      `).all()
    : [];

  console.log(`\n${C.green}🏆 PERMANENT TROPHY HOLDERS${C.reset}`);
  console.log(`${C.white}LEGENDARY REGISTRY${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

  if (!stats.length) {
    console.log(`${C.white}No trophy holders recorded.${C.reset}`);
  }

  for (const row of stats) {
    const identity = DB.prepare(`
      SELECT name, symbol FROM tokens WHERE mint=?
    `).get(row.mint);

    console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
    console.log(`${C.white}${identity?.name ?? "NAME NOT REGISTERED"}${C.reset}  ${C.green}🏆 ${row.trophy_count} TROPHIES${C.reset}`);
    field("TOKEN TICKER", identity?.symbol ?? "SYMBOL NOT REGISTERED");
    field("FULL MINT ADDRESS", row.mint);
    field("CONSECUTIVE WINS", row.consecutive_wins);
    field("APPEARANCES", row.appearances);
    field("PODIUM FINISHES", row.podium_finishes);
    field("BEST MOVEMENT", `${formatSol(row.best_movement_sol)} SOL`);

    const timestamp = Number(row.last_championship_at);
    field(
      "LAST CHAMPIONSHIP",
      Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp).toLocaleString()
        : "N/A"
    );
  }
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

  console.log(`\n${C.green}DIRECTION POWER — LAST 360 MINUTES${C.reset}`);
  console.log(`${C.white}12-ROUND DIRECTIONAL CONSISTENCY${C.reset}`);
  console.log(`${C.green}${"─".repeat(72)}${C.reset}`);

  if (!exists("rounds") || !exists("round_entries")) {
    console.log("Directional round history unavailable.");
    return;
  }

  const recentRounds = DB.prepare(`
    SELECT id, round_number, completed_at
    FROM rounds
    WHERE status='completed'
      AND completed_at IS NOT NULL
      AND completed_at >= ?
    ORDER BY completed_at DESC, id DESC
    LIMIT 12
  `).all(cutoff);

  console.log(`Completed rounds in window: ${recentRounds.length}/12`);

  if (recentRounds.length < 12) {
    console.log("Direction status pending until 12 completed rounds are available.");
    return;
  }

  const ids = recentRounds.map(r => r.id);
  const placeholders = ids.map(() => "?").join(",");

  const movements = DB.prepare(`
    SELECT re.mint, re.movement_sol,
           t.symbol, t.name
    FROM round_entries re
    LEFT JOIN tokens t ON t.mint = re.mint
    WHERE re.round_id IN (${placeholders})
      AND re.movement_sol IS NOT NULL
  `).all(...ids);

  const directional = new Map();

  for (const item of movements) {
    const movement = Number(item.movement_sol);
    if (!Number.isFinite(movement) || movement === 0) continue;

    if (!directional.has(item.mint)) {
      directional.set(item.mint, {
        mint: item.mint,
        symbol: item.symbol,
        name: item.name,
        up: 0,
        down: 0
      });
    }

    const record = directional.get(item.mint);
    if (movement > 0) record.up++;
    if (movement < 0) record.down++;
  }

  const ranked = [];

  for (const record of directional.values()) {
    let direction = null;
    let count = 0;
    let status = null;

    if (record.up > record.down) {
      direction = "UP ↑";
      count = record.up;
    } else if (record.down > record.up) {
      direction = "DOWN ↓";
      count = record.down;
    }

    if (count >= 10 && count <= 12) {
      status = "SUPER LEGENDARY";
    } else if (count === 8 || count === 9) {
      status = "LEGENDARY";
    }

    if (status) ranked.push({ ...record, direction, count, status });
  }

  ranked.sort((a, b) =>
    b.count - a.count || a.mint.localeCompare(b.mint)
  );

  if (!ranked.length) {
    console.log("No tokens currently qualify for Legendary status.");
  }

  for (const item of ranked) {
    const color = item.status === "SUPER LEGENDARY"
      ? C.green
      : C.white;

    console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
    console.log(`${color}${item.status}${C.reset}`);
    const identity = DB.prepare(`
      SELECT name, symbol FROM tokens WHERE mint=?
    `).get(item.mint);

    console.log(`${C.white}${identity?.name ?? item.name ?? "NAME NOT REGISTERED"}${C.reset}`);
    field("TOKEN TICKER", identity?.symbol ?? item.symbol ?? "SYMBOL NOT REGISTERED");
    field("FULL MINT ADDRESS", item.mint);
    field("DIRECTION", `${C.green}${item.direction}${C.reset}`);
    field("MATCHING ROUNDS", `${item.count}/12`);
    field("UP ROUNDS", item.up);
    field("DOWN ROUNDS", item.down);
    field("PERMANENT TROPHIES", DB.prepare(`
      SELECT trophy_count FROM champion_stats WHERE mint=?
    `).get(item.mint)?.trophy_count ?? 0);
  }

  console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
  console.log(`${C.white}DIRECTION POWER DOES NOT MODIFY TROPHY TOTALS.${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

  if (exists("championship_events")) {
    console.log(`\n${C.green}CHAMPIONSHIP TROPHY EVENTS${C.reset}`);
    const events = DB.prepare(`
      SELECT
        e.id,
        e.round_id,
        e.mint,
        t.name,
        t.symbol,
        e.awarded_at,
        e.trophy_increment,
        e.movement_sol,
        CASE
          WHEN re.opening_price_sol > 0
            AND re.closing_price_sol > 0
          THEN ((re.closing_price_sol / re.opening_price_sol) - 1) * 100
          ELSE NULL
        END AS gain_percent,
        re.opening_price_sol,
        re.closing_price_sol,
        t.pair_address
      FROM championship_events e
      LEFT JOIN tokens t ON t.mint = e.mint
      LEFT JOIN round_entries re
        ON re.round_id = e.round_id AND re.mint = e.mint
      ORDER BY e.id DESC
      LIMIT 30
    `).all();

    console.log(`\n${C.green}CHAMPIONSHIP TROPHY EVENTS${C.reset}`);
    console.log(`${C.white}RECENT WINNERS — FULL TOKEN IDENTITY${C.reset}`);
    console.log(`${C.white}GAIN = ROUND CLOSING PRICE VS ROUND OPENING PRICE${C.reset}`);
    console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

    if (!events.length) {
      console.log("No championship trophy events recorded.");
    }

    for (const event of events) {
      const gain = Number(event.gain_percent);
      const gainText = Number.isFinite(gain)
        ? `${gain >= 0 ? "+" : ""}${gain.toFixed(2)}%`
        : "N/A";
      const awardedAt = Number(event.awarded_at);

      console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
      console.log(`${C.green}EVENT ${event.id}  |  ROUND ${event.round_id}${C.reset}`);
      console.log(`${C.white}${event.name ?? "NAME NOT REGISTERED"}${C.reset}  ${C.green}${gainText}${C.reset}`);
      field("TOKEN TICKER", event.symbol ?? "SYMBOL NOT REGISTERED");
      field("FULL MINT ADDRESS", event.mint);
      field("OPENING PRICE", `${formatSol(event.opening_price_sol)} SOL`);
      field("CLOSING PRICE", `${formatSol(event.closing_price_sol)} SOL`);
      field("MOVEMENT", `${formatSol(event.movement_sol)} SOL`);
      field("TROPHIES AWARDED", `${C.green}+${event.trophy_increment}${C.reset}`);
      field("PAIR ADDRESS", event.pair_address ?? "PAIR NOT REGISTERED");
      field(
        "AWARDED AT",
        Number.isFinite(awardedAt) && awardedAt > 0
          ? new Date(awardedAt).toLocaleString()
          : "N/A"
      );
    }
    console.log(`${C.green}${"=".repeat(72)}${C.reset}`);
  }
}

function archive() {
  title("06 — HISTORICAL ROUND ARCHIVE");

  if (!exists("round_results")) {
    console.log("Round results unavailable.");
    return;
  }

  const rows = DB.prepare(`
    SELECT * FROM round_results
    ORDER BY round_id DESC, rank ASC
    LIMIT 100
  `).all();

  console.log(`Archived result records displayed: ${rows.length}`);
  table(rows, [
    "round_id", "rank", "mint", "pair_address",
    "opening_price_sol", "closing_price_sol",
    "movement_sol", "recorded_at"
  ]);
}

function analytics() {
  title("07 — MARKET MOVEMENT ANALYTICS");

  if (!exists("price_observations")) {
    console.log("Price observation history unavailable.");
    return;
  }

  const formatSol = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    return number.toFixed(18).replace(/\\.?0+$/, "");
  };

  const formatTimestamp = value => {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp).toLocaleString()
      : "N/A";
  };

  const field = (label, value) =>
    console.log(`${C.white}${label.padEnd(23)}${C.reset}${value}`);

  const summary = DB.prepare(`
    SELECT
      COUNT(*) AS observations,
      COUNT(DISTINCT mint) AS unique_tokens,
      MIN(observed_at) AS first_observation,
      MAX(observed_at) AS latest_observation
    FROM price_observations
  `).get();

  console.log(`\\n${C.green}OBSERVATION HISTORY${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);
  field("TOTAL OBSERVATIONS", Number(summary.observations).toLocaleString("en-US"));
  field("UNIQUE TOKENS", Number(summary.unique_tokens).toLocaleString("en-US"));
  field("FIRST OBSERVATION", formatTimestamp(summary.first_observation));
  field("LATEST OBSERVATION", formatTimestamp(summary.latest_observation));

  const windowStart = Date.now() - 86400000;
  const movements = DB.prepare(`
    WITH ranked AS (
      SELECT mint, price_sol, observed_at,
        ROW_NUMBER() OVER (
          PARTITION BY mint ORDER BY observed_at ASC
        ) AS first_rank,
        ROW_NUMBER() OVER (
          PARTITION BY mint ORDER BY observed_at DESC
        ) AS last_rank
      FROM price_observations
      WHERE observed_at >= ?
    ),
    opening AS (
      SELECT mint, price_sol AS opening_price
      FROM ranked WHERE first_rank=1
    ),
    closing AS (
      SELECT mint, price_sol AS current_price
      FROM ranked WHERE last_rank=1
    )
    SELECT o.mint, t.name, t.symbol,
      (
        SELECT mp.volume_h24
        FROM market_pairs mp
        WHERE mp.mint = o.mint
        ORDER BY COALESCE(mp.liquidity_updated_at, mp.last_seen_at, mp.first_seen_at) DESC
        LIMIT 1
      ) AS volume_h24,
      (
        SELECT mp.market_cap
        FROM market_pairs mp
        WHERE mp.mint = o.mint
        ORDER BY COALESCE(mp.liquidity_updated_at, mp.last_seen_at, mp.first_seen_at) DESC
        LIMIT 1
      ) AS market_cap,
      o.opening_price, c.current_price,
      c.current_price-o.opening_price AS movement_sol
    FROM opening o
    JOIN closing c USING(mint)
    LEFT JOIN tokens t ON t.mint=o.mint
    WHERE o.opening_price IS NOT NULL
      AND c.current_price IS NOT NULL
    ORDER BY movement_sol DESC
    LIMIT 20
  `).all(windowStart);

  const positiveCount = movements.filter(row => Number(row.movement_sol) > 0).length;
  const negativeCount = movements.filter(row => Number(row.movement_sol) < 0).length;
  const unchangedCount = movements.filter(row => Number(row.movement_sol) === 0).length;

  console.log(`\\n${C.green}24-HOUR OBSERVED-WINDOW MOVEMENT${C.reset}`);
  console.log(`${C.white}RANKED BY HIGHEST POSITIVE SOL MOVEMENT${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);
  field("WINDOW START", formatTimestamp(windowStart));
  field("WINDOW END", formatTimestamp(Date.now()));
  field("QUALIFIED PAIRS", movements.length);
  field("POSITIVE MOVERS", `${C.green}${positiveCount}${C.reset}`);
  field("NEGATIVE MOVERS", negativeCount);
  field("UNCHANGED", unchangedCount);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

  if (!movements.length) {
    console.log(`${C.white}No qualifying price observations in the 24-hour window.${C.reset}`);
  }

  movements.forEach((row, index) => {
    const opening = Number(row.opening_price);
    const current = Number(row.current_price);
    const movement = Number(row.movement_sol);
    const gain = Number.isFinite(opening) && opening > 0 &&
      Number.isFinite(current)
      ? ((current / opening) - 1) * 100
      : null;
    const gainText = gain === null
      ? "N/A"
      : `${gain > 0 ? "+" : ""}${gain.toFixed(2)}%`;
    const movementColor = movement > 0
      ? C.green
      : movement < 0
        ? C.white
        : C.dim;

    console.log(`${C.green}#${String(index + 1).padStart(2, "0")}  ${row.symbol ?? "UNKNOWN"}${C.reset}  ${movementColor}${gainText}${C.reset}`);
    console.log(`${C.white}${row.name ?? "NAME NOT REGISTERED"}${C.reset}`);
    field("OPENING PRICE", `${formatSol(row.opening_price)} SOL`);
    field("CURRENT PRICE", `${formatSol(row.current_price)} SOL`);
    field("SOL MOVEMENT", `${movementColor}${formatSol(row.movement_sol)} SOL${C.reset}`);
    field("24H TRADING VOLUME", `${money(row.volume_h24)} USD`);
    field("MARKET CAPITALIZATION", `${money(row.market_cap)} USD`);
    field("FULL MINT ADDRESS", row.mint);
    console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
  });

  console.log(`${C.green}END OF 24-HOUR MOVEMENT REPORT${C.reset}`);
  console.log(`${C.white}Ranking and movement values use the existing observed-window price records.${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);
}

function diagnostics() {
  title("08 — SYSTEM DIAGNOSTICS");

  console.log(`Node: ${process.version}`);
  console.log(`Database: data/atumpump.sqlite`);
  console.log(`Database journal: ${DB.prepare("PRAGMA journal_mode").get().journal_mode}`);
  console.log(`Foreign keys: ${DB.prepare("PRAGMA foreign_keys").get().foreign_keys}`);

  const tables = DB.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();

  console.log("\nDATABASE TABLE COUNTS");

  for (const item of tables) {
    console.log(`${item.name.padEnd(38)} ${count(item.name)}`);
  }

  const round = latestRound();

  console.log("\nCHAMPIONSHIP ENGINE");
  console.log(`Active round: ${round?.round_number ?? "NONE"}`);
  console.log("Required round duration: 432 seconds");
  console.log("Scoring: absolute positive SOL-per-token movement");

  console.log("\nPAIR INTELLIGENCE");
  console.log(`Registered pairs: ${count("market_pairs")}`);
  console.log(`Pair observations: ${count("market_pair_observations")}`);
  console.log(`Liquidity observations: ${count("liquidity_source_observations")}`);
  console.log(`Discovery events: ${count("discovery_events")}`);

  console.log("\nAUDIT CHAIN");
  if (exists("rounds")) {
    const audit = DB.prepare(`
      SELECT COUNT(*) AS completed,
        SUM(CASE WHEN audit_hash IS NOT NULL THEN 1 ELSE 0 END) AS hashed
      FROM rounds
      WHERE status='completed'
    `).get();
    console.log(`Completed rounds: ${audit.completed}`);
    console.log(`Rounds with SHA-256 hash: ${audit.hashed ?? 0}`);
  }

  console.log("\nCONTROL CENTER: ONLINE");
}


const SERVICE_ROOT = process.cwd();
const SERVICE_PID_FILE = path.join(
  SERVICE_ROOT, "data", "market_service_pids.json"
);

const MARKET_SERVICES = {
  discovery: {
    label: "INFINITE PAIR DISCOVERY",
    file: "src/infinite_pair_discovery.mjs",
    log: "logs/infinite_pair_discovery.log"
  },
  gecko: {
    label: "GECKOTERMINAL LIQUIDITY",
    file: "src/geckoterminal_liquidity.mjs",
    log: "logs/geckoterminal_liquidity.log"
  },
  dexscreener: {
    label: "DEXSCREENER LIQUIDITY REFRESH",
    file: "src/liquidity_refresh.mjs",
    log: "logs/liquidity_refresh.log"
  },
  capture: {
    label: "MARKET CAPTURE",
    file: "src/market_capture.mjs",
    log: "logs/market_capture.log"
  }
};

function readServicePids() {
  try {
    return JSON.parse(fs.readFileSync(SERVICE_PID_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveServicePids(pids) {
  fs.mkdirSync(path.dirname(SERVICE_PID_FILE), { recursive: true });
  fs.writeFileSync(SERVICE_PID_FILE, JSON.stringify(pids, null, 2));
}

function servicePidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function startMarketService(key) {
  const service = MARKET_SERVICES[key];
  if (!service) return;

  const pids = readServicePids();

  if (servicePidRunning(pids[key])) {
    console.log(`[ONLINE] ${service.label} — PID ${pids[key]}`);
    return;
  }

  const script = path.join(SERVICE_ROOT, service.file);

  if (!fs.existsSync(script)) {
    console.log(`[MISSING] ${service.label}: ${service.file}`);
    return;
  }

  const logPath = path.join(SERVICE_ROOT, service.log);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const fd = fs.openSync(logPath, "a");

  const child = spawn(process.execPath, [script], {
    cwd: SERVICE_ROOT,
    detached: true,
    stdio: ["ignore", fd, fd]
  });

  fs.closeSync(fd);

  child.once("error", error => {
    console.error(`[START ERROR] ${service.label}: ${error.message}`);
  });

  child.unref();

  pids[key] = child.pid;
  saveServicePids(pids);

  console.log(`[STARTED] ${service.label} — PID ${child.pid}`);
  console.log(`[LOG] ${service.log}`);
}

function startAllMarketServices() {
  title("13 — START ALL MARKET SERVICES");

  for (const key of Object.keys(MARKET_SERVICES)) {
    startMarketService(key);
  }

  console.log("\n[COMPLETE] Market service start requests submitted.");
}

const CHAMPIONSHIP_ENGINE_PID_FILE = path.join(
  SERVICE_ROOT, "data", "championship_engine.pid"
);

function startChampionshipEngine() {
  let pid = null;

  try {
    pid = Number(fs.readFileSync(CHAMPIONSHIP_ENGINE_PID_FILE, "utf8").trim());
  } catch {}

  if (servicePidRunning(pid)) {
    console.log(`[ONLINE] CHAMPIONSHIP ENGINE — PID ${pid}`);
    return;
  }

  const script = path.join(SERVICE_ROOT, "src", "championship_engine.mjs");

  if (!fs.existsSync(script)) {
    console.log("[MISSING] CHAMPIONSHIP ENGINE");
    return;
  }

  const logPath = path.join(SERVICE_ROOT, "logs", "championship_engine.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.mkdirSync(path.dirname(CHAMPIONSHIP_ENGINE_PID_FILE), { recursive: true });

  const fd = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [script], {
    cwd: SERVICE_ROOT,
    detached: true,
    stdio: ["ignore", fd, fd]
  });
  fs.closeSync(fd);

  child.once("error", error => {
    console.error(`[START ERROR] CHAMPIONSHIP ENGINE: ${error.message}`);
  });

  child.unref();
  fs.writeFileSync(CHAMPIONSHIP_ENGINE_PID_FILE, String(child.pid));

  console.log(`[STARTED] CHAMPIONSHIP ENGINE — PID ${child.pid}`);
  console.log("[LOG] logs/championship_engine.log");
}

function stopAllMarketServices() {
  title("14 — STOP ALL CONTROLLED MARKET SERVICES");

  const pids = readServicePids();

  for (const [key, service] of Object.entries(MARKET_SERVICES)) {
    const pid = pids[key];

    if (!servicePidRunning(pid)) {
      console.log(`[OFFLINE] ${service.label}`);
      delete pids[key];
      continue;
    }

    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`[STOP SIGNAL SENT] ${service.label} — PID ${pid}`);
      delete pids[key];
    } catch (error) {
      console.log(`[STOP ERROR] ${service.label}: ${error.message}`);
    }
  }

  saveServicePids(pids);
}

function marketServiceStatus() {
  title("15 — MARKET SERVICE STATUS");

  const pids = readServicePids();

  for (const [key, service] of Object.entries(MARKET_SERVICES)) {
    const pid = pids[key];

    console.log(
      `${service.label}: ${
        servicePidRunning(pid) ? `ONLINE — PID ${pid}` : "OFFLINE"
      }`
    );
  }
}

function pairIntelligenceCenter() {
  title("12 — ATUMPUMP PAIR INTELLIGENCE CENTER");

  const registered = count("market_pairs");
  const active = exists("market_pairs")
    ? DB.prepare(
        "SELECT COUNT(*) AS n FROM market_pairs WHERE active=1"
      ).get().n
    : 0;

  console.log("\n01 — PAIR REGISTRY");
  console.log(`Registered pairs: ${registered}`);
  console.log(`Active pairs: ${active}`);
  console.log(`Pair identities: ${count("pair_identity_history")}`);

  console.log("\n02 — LIQUIDITY SOURCE COVERAGE");

  if (exists("market_pairs")) {
    const pairColumns = columns("market_pairs");

    if (pairColumns.includes("liquidity_source")) {
      const sources = DB.prepare(`
        SELECT liquidity_source, COUNT(*) AS pairs
        FROM market_pairs
        WHERE active=1 AND liquidity_source IS NOT NULL
        GROUP BY liquidity_source
        ORDER BY pairs DESC
      `).all();

      for (const source of sources) {
        console.log(`${source.liquidity_source}: ${source.pairs}`);
      }
    }

    if (pairColumns.includes("liquidity_usd")) {
      const total = DB.prepare(`
        SELECT SUM(liquidity_usd) AS total
        FROM market_pairs
        WHERE active=1
      `).get();

      console.log(`Latest reported liquidity: $${fmt(total.total)}`);
      console.log("\n03 — TOP REPORTED LIQUIDITY");

      const top = DB.prepare(`
        SELECT pair_address, liquidity_usd, last_seen_at
        FROM market_pairs
        WHERE active=1 AND liquidity_usd IS NOT NULL
        ORDER BY liquidity_usd DESC
        LIMIT 10
      `).all();

      for (const row of top) {
        console.log(
          `${row.pair_address} | $${fmt(row.liquidity_usd)} | ` +
          `${row.last_seen_at ?? "N/A"}`
        );
      }
    }
  }

  console.log("\n04 — OBSERVATION COUNTS");
  console.log(`Market pair observations: ${count("market_pair_observations")}`);
  console.log(`Liquidity observations: ${count("liquidity_source_observations")}`);
  console.log(`Pair change events: ${count("pair_change_events")}`);
  console.log(`Discovery events: ${count("discovery_events")}`);
  console.log("\n[ONLINE] PAIR INTELLIGENCE CENTER");
}



async function refreshRoundUsdPrices(round) {
  if (!round) return;

  const entries = DB.prepare(`
    SELECT e.mint, e.opening_price_sol,
      t.pair_address AS token_pair,
      mp.pair_address AS market_pair
    FROM round_entries e
    LEFT JOIN tokens t ON t.mint=e.mint
    LEFT JOIN market_pairs mp ON mp.mint=e.mint AND mp.active=1
    WHERE e.round_id=?
  `).all(round.id);

  const mints = [...new Set(entries.map(e => e.mint).filter(Boolean))];

  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const endpoint =
      "https://api.dexscreener.com/tokens/v1/solana/" +
      batch.join(",");

    try {
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" }
      });

      if (!response.ok) {
        continue;
      }

      const pairs = await response.json();
      if (!Array.isArray(pairs)) continue;

      for (const entry of entries) {
        if (!batch.includes(entry.mint)) continue;

        const candidates = pairs.filter(pair =>
          pair.baseToken?.address === entry.mint &&
          Number(pair.priceUsd) > 0 &&
          Number(pair.priceNative) > 0
        );

        if (!candidates.length) continue;

        const expectedPair = entry.market_pair || entry.token_pair;
        const pair = candidates.find(p =>
          expectedPair && p.pairAddress === expectedPair
        ) || candidates.sort(
          (a, b) =>
            Number(b.liquidity?.usd || 0) -
            Number(a.liquidity?.usd || 0)
        )[0];

        const priceUsd = Number(pair.priceUsd);
        const priceNative = Number(pair.priceNative);
        const solUsd = priceUsd / priceNative;
        const pairAddress = pair.pairAddress;

        if (
          !Number.isFinite(priceUsd) ||
          !Number.isFinite(solUsd) ||
          priceUsd <= 0 ||
          solUsd <= 0
        ) continue;

        const now = Date.now();

        DB.prepare(`
          INSERT INTO price_observations
            (mint, observed_at, price_sol, source, pair_address, price_usd, sol_usd)
          VALUES (?, ?, ?, 'dexscreener_usd', ?, ?, ?)
        `).run(
          entry.mint, now, priceNative,
          pairAddress, priceUsd, solUsd
        );

        DB.prepare(`
          UPDATE round_entries
          SET opening_price_usd =
            CASE
              WHEN opening_price_usd IS NULL
              THEN opening_price_sol * ?
              ELSE opening_price_usd
            END
          WHERE round_id=? AND mint=?
        `).run(solUsd, round.id, entry.mint);
      }
    } catch (error) {
      continue;
    }
  }
}

async function liveRoundWatch() {
  const cyan = C.white;
  const gold = C.green;
  const green = C.green;
  const red = C.red;
  const reset = C.reset;

  function renderLiveRound() {
    const lines = [];
    const log = (...args) => lines.push(args.join(" "));

    const round = latestRound();

    log(`${cyan}============================================================`);
    log(" 16 — LIVE ROUND WATCH");
    log("============================================================" + reset);

    if (!round) {
      log(`${C.dim}No active championship round.${reset}`);
    } else {
      const remaining = Math.max(
        0,
        Math.ceil((Number(round.ends_at) - Date.now()) / 1000)
      );

      log(`${cyan}LOCAL TIME:${reset} ${new Date().toLocaleString()}`);
      log(`${cyan}ROUND:${reset} ${round.round_number}`);
      log(`${cyan}COUNTDOWN:${reset} ${Math.floor(remaining / 60)}m ${String(remaining % 60).padStart(2, "0")}s`);

      const entries = rollingUsdMovers();

      entries.sort((a, b) => {
        const ap = Number(a.opening_price_usd) > 0
          ? (Number(a.current_price_usd) / Number(a.opening_price_usd) - 1) * 100
          : -Infinity;
        const bp = Number(b.opening_price_usd) > 0
          ? (Number(b.current_price_usd) / Number(b.opening_price_usd) - 1) * 100
          : -Infinity;
        return bp - ap;
      });

      const candidates = entries.filter(entry => {
        const opening = Number(entry.opening_price_usd);
        const current = Number(entry.current_price_usd);

        if (
          !Number.isFinite(opening) ||
          !Number.isFinite(current) ||
          opening <= 0 ||
          current <= 0
        ) return false;

        const roundGain = ((current / opening) - 1) * 100;
        return roundGain >= 27;
      });

      const belowThreshold = entries.length - candidates.length;

      log("");
      log(`${gold}========== 🏆 QUALIFIED ROUND CANDIDATES ==========${reset}`);
      log(`${cyan}ELIGIBILITY THRESHOLD: +13.00% MINIMUM ROUND GAIN${reset}`);
      log(`${cyan}HIERARCHY: HIGHEST QUALIFIED ROUND GAIN → LOWEST${reset}`);
      log(`${cyan}Qualified candidates:${reset} ${candidates.length}`);
      log(`${cyan}Below +27.00% threshold:${reset} ${belowThreshold}`);
      log(`${cyan}RANK  TOKEN          GAIN %       OPEN USD              CURRENT USD           MOVEMENT USD${reset}`);
      log(`${cyan}${"─".repeat(112)}${reset}`);

      if (!candidates.length) {
        log(`${C.dim}No tokens have reached the +27.00% candidate threshold in this round.${reset}`);
      }

      candidates.forEach((entry, index) => {
        const symbol = String(entry.symbol ?? "UNKNOWN").slice(0, 13);
        const openingValue = Number(entry.opening_price_usd);
        const currentValue = Number(entry.current_price_usd);
        const movementValue = currentValue - openingValue;
        const percent = openingValue > 0
          ? (movementValue / openingValue) * 100
          : 0;

        const gain = `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
        const formatUsd = value => {
          const number = Number(value);
          if (!Number.isFinite(number)) return "N/A";
          return "$" + number.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: Math.abs(number) < 0.01 ? 18 : 2
          });
        };

        const opening = formatUsd(openingValue);
        const current = formatUsd(currentValue);
        const movement = `${movementValue >= 0 ? "+" : "-"}${formatUsd(Math.abs(movementValue))}`;
        const medal = index === 0 ? "🏆" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${String(index + 1).padStart(2, " ")} `;
        const gainColor = percent > 0 ? green : percent < 0 ? red : cyan;

        const identity = DB.prepare(`
          SELECT tokens.name AS name,
                 tokens.symbol AS symbol,
                 tokens.pair_address AS pair_address,
                 market_pairs.market_cap AS market_cap,
                 market_pairs.fdv AS fdv,
                 market_pairs.volume_h24 AS volume_h24,
                 market_pairs.liquidity_usd AS liquidity_usd
          FROM tokens
          LEFT JOIN market_pairs ON market_pairs.mint = tokens.mint
          WHERE tokens.mint = ?
          ORDER BY market_pairs.liquidity_usd DESC
          LIMIT 1
        `).get(entry.mint) ?? {};

        const tokenName = String(identity.name ?? entry.name ?? "NAME NOT REGISTERED");
        const ticker = String(identity.symbol ?? entry.symbol ?? symbol);
        const marketCap = Number(identity.market_cap ?? identity.fdv);
        const volume24h = Number(identity.volume_h24);
        const liquidity = Number(identity.liquidity_usd);

        const money = value => {
          const number = Number(value);
          if (!Number.isFinite(number) || number <= 0) return "N/A";
          return "$" + number.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: number < 0.01 ? 18 : 2
          });
        };

        log(`${gold}${String(index + 1).padStart(2, "0")}. ${tokenName} (${ticker})${reset}`);
        log(`   RANK #${index + 1} | GAIN: ${gainColor}${gain}${reset} | OPEN: ${opening} | NOW: ${current}`);
        log(`   USD MOVEMENT: ${gainColor}${movement}${reset} | MARKET CAP: ${money(marketCap)} | 24H VOL: ${money(volume24h)}`);
        log(`   LIQUIDITY: ${money(liquidity)} | MINT: ${entry.mint}`);
        log(`   PAIR: ${entry.pair_address ?? identity.pair_address ?? "N/A"}`);
        log(`${gold}${"─".repeat(74)}${reset}`);
      });
    }

    log("");
    log(`${green}[ONLINE]${reset} LIVE ROUND WATCH — refresh every 2 seconds.`);
    log(`${gold}[CONTROL]${reset} Press ENTER to stop watching and return.`);

    const frame = lines.join("\n");
    process.stdout.write("\x1b[2J\x1b[H" + frame + "\n");
  }

  process.stdout.write("\x1b[2J\x1b[H");
  await refreshRoundUsdPrices(latestRound());
  renderLiveRound();

  const usdRefresh = setInterval(async () => {
    try {
      await refreshRoundUsdPrices(latestRound());
      renderLiveRound();
    } catch (error) {
      // Keep background refresh errors out of the live display.
    }
  }, 15000);

  const refresh = setInterval(() => {
    try {
      renderLiveRound();
    } catch (error) {
      // Keep renderer errors from corrupting the live display.
    }
  }, 2000);

  try {
    await ask("");
  } finally {
    clearInterval(refresh);
    clearInterval(usdRefresh);
    process.stdout.write("\x1b[2J\x1b[H");
  }
}

const actions = {
  "1": liveMarketScanner,
  "2": leaderboard,
  "3": championHolder,
  "4": watchlist,
  "5": trophies,
  "6": archive,
  "7": analytics,
  "8": diagnostics,
  "9": () => startMarketService("discovery"),
  "10": () => startMarketService("gecko"),
  "11": () => startMarketService("dexscreener"),
  "12": pairIntelligenceCenter,
  "13": startAllMarketServices,
  "14": stopAllMarketServices,
  "15": marketServiceStatus,
  "16": liveRoundWatch
};

function showMenu() {
  console.clear();
  console.log(`${C.green}
  █████╗ ████████╗██╗   ██╗███╗   ███╗██████╗ ██╗   ██╗███╗   ███╗██████╗
 ██╔══██╗╚══██╔══╝██║   ██║████╗ ████║██╔══██╗██║   ██║████╗ ████║██╔══██╗
 ███████║   ██║   ██║   ██║██╔████╔██║██████╔╝██║   ██║██╔████╔██║██████╔╝
 ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║██╔═══╝ ██║   ██║██║╚██╔╝██║██╔═══╝
 ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║██║     ╚██████╔╝██║ ╚═╝ ██║██║
 ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝      ╚═════╝ ╚═╝     ╚═╝╚═╝
${C.reset}`);
  console.log(`${C.white}       ATUMPUMP CHAMPIONSHIP CONTROL CENTER${C.reset}`);
  console.log("============================================================");
  console.log(" 1. LIVE MARKET SCANNER");
  console.log(" 2. 7.2-MINUTE LEADERBOARD");
  console.log(" 3. CHAMPION HOLDER");
  console.log(" 4. CHAMPIONSHIP WATCHLIST");
  console.log(" 5. TROPHY COLLECTION");
  console.log(" 6. HISTORICAL ROUND ARCHIVE");
  console.log(" 7. MARKET MOVEMENT ANALYTICS");
  console.log(" 8. SYSTEM DIAGNOSTICS");
  console.log(" 9. INFINITE PAIR DISCOVERY — START");
  console.log("10. GECKOTERMINAL LIQUIDITY — START");
  console.log("11. DEXSCREENER LIQUIDITY REFRESH — START");
  console.log("12. PAIR INTELLIGENCE CENTER");
  console.log("13. ALL MARKET SERVICES — START");
  console.log("14. ALL CONTROLLED MARKET SERVICES — STOP");
  console.log("15. MARKET SERVICE STATUS");
  console.log("16. LIVE ROUND WATCH — START");
  console.log(" 0. EXIT");
  console.log("============================================================");
}

async function main() {
  console.log("[ONLINE] ATUMPUMP Control Center.");
  await new Promise(resolve => setTimeout(resolve, 500));

  title("AUTOMATIC SYSTEM STARTUP");
  startAllMarketServices();
  startChampionshipEngine();
  console.log("\\n[ONLINE] Automatic startup requests submitted.");
  await new Promise(resolve => setTimeout(resolve, 1000));


  while (true) {
    showMenu();

    const choice = (await ask("SELECT MODULE: ")).trim();

    if (choice === "0") break;

    const action = actions[choice];

    if (!action) {
      console.log("Invalid selection.");
      await ask("Press ENTER to continue...");
      continue;
    }

    try {
      await action();
    } catch (error) {
      console.log(`\n[MODULE ERROR] ${error.message}`);
    }

    await ask("\nPress ENTER to return to Control Center...");
  }

  rl.close();
  DB.close();
  console.log("[OFFLINE] Control Center closed.");
}

main().catch(error => {
  console.error("[CONTROL CENTER ERROR]", error);
  rl.close();
  DB.close();
  process.exitCode = 1;
});
