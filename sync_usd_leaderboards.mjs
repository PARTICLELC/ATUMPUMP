import fs from "node:fs";

const file = "src/control_center.mjs";
let source = fs.readFileSync(file, "utf8");

const helper = `
function rollingUsdMovers() {
  const end = Date.now();
  const start = end - 432000;

  return DB.prepare(\`
    WITH observations AS (
      SELECT
        po.mint,
        po.pair_address,
        po.price_usd,
        po.observed_at,
        ROW_NUMBER() OVER (
          PARTITION BY po.mint, po.pair_address
          ORDER BY po.observed_at ASC, po.id ASC
        ) AS first_rank,
        ROW_NUMBER() OVER (
          PARTITION BY po.mint, po.pair_address
          ORDER BY po.observed_at DESC, po.id DESC
        ) AS last_rank,
        COUNT(*) OVER (
          PARTITION BY po.mint, po.pair_address
        ) AS samples
      FROM price_observations po
      WHERE po.price_usd > 0
        AND po.pair_address IS NOT NULL
        AND po.observed_at BETWEEN ? AND ?
    ),
    movements AS (
      SELECT
        mint,
        pair_address,
        MAX(CASE WHEN first_rank = 1 THEN price_usd END) AS opening_price_usd,
        MAX(CASE WHEN last_rank = 1 THEN price_usd END) AS current_price_usd,
        MAX(samples) AS sample_count
      FROM observations
      GROUP BY mint, pair_address
    )
    SELECT
      m.mint,
      t.symbol,
      t.name,
      m.pair_address,
      m.opening_price_usd,
      m.current_price_usd,
      m.current_price_usd - m.opening_price_usd AS movement_usd,
      m.sample_count
    FROM movements m
    LEFT JOIN tokens t ON t.mint = m.mint
    WHERE m.sample_count >= 2
      AND m.current_price_usd > m.opening_price_usd * (1.0 + 1e-12)
    ORDER BY movement_usd DESC
  \`).all(start, end);
}
`;

if (source.includes("function rollingUsdMovers()")) {
  source = source.replace(
    /function rollingUsdMovers\\(\\)\\s*\\{[\\s\\S]*?\\n\\}\\n/,
    helper
  );
} else {
  const anchor = "function leaderboard() {";
  if (!source.includes(anchor)) {
    throw new Error("Module 2 function not found.");
  }
  source = source.replace(anchor, helper + "\n" + anchor);
}

const leaderboardStart = source.indexOf("function leaderboard() {");
const leaderboardEnd = source.indexOf("\nfunction championHolder() {", leaderboardStart);

if (leaderboardStart === -1 || leaderboardEnd === -1) {
  throw new Error("Could not locate complete Module 2 function.");
}

const leaderboard = `
function leaderboard() {
  title("02 — LIVE 432-SECOND USD MOVEMENT LEADERBOARD");

  const end = Date.now();
  const start = end - 432000;
  const entries = rollingUsdMovers();

  console.log("WINDOW START: " + new Date(start).toLocaleString());
  console.log("WINDOW END:   " + new Date(end).toLocaleString());
  console.log("WINDOW: 432 SECONDS");
  console.log("\\nHIGHEST POSITIVE USD MOVEMENT → LOWEST");
  console.log("Positive movers: " + entries.length);

  if (!entries.length) {
    console.log("Waiting for at least two USD observations per pair inside the 432-second window.");
    return;
  }

  entries.forEach((entry, index) => {
    const medal = index === 0 ? "🏆" : index === 1 ? "🥈" : index === 2 ? "🥉" : " ";

    console.log(
      medal + " " + (index + 1) + ". " +
      (entry.symbol ?? "UNKNOWN") + " | +$" +
      Number(entry.movement_usd).toExponential(10)
    );
    console.log("   OPEN USD:    $" + Number(entry.opening_price_usd).toExponential(10));
    console.log("   CURRENT USD: $" + Number(entry.current_price_usd).toExponential(10));
    console.log("   SAMPLES: " + entry.sample_count);
    console.log("   MINT: " + entry.mint);
    console.log("   PAIR: " + entry.pair_address);
  });
}
`;

source =
  source.slice(0, leaderboardStart) +
  leaderboard +
  source.slice(leaderboardEnd);

const watchStart = source.indexOf("async function liveRoundWatch()");
if (watchStart === -1) {
  throw new Error("Module 16 function not found.");
}

const queryStart = source.indexOf("    const entries = DB.prepare(`", watchStart);
if (queryStart === -1) {
  throw new Error("Module 16 leaderboard query not found.");
}

const queryEnd = source.indexOf(".all(", queryStart);
if (queryEnd === -1) {
  throw new Error("Module 16 query execution not found.");
}

const statementEnd = source.indexOf(";", queryEnd);
if (statementEnd === -1) {
  throw new Error("Module 16 query terminator not found.");
}

source =
  source.slice(0, queryStart) +
  "    const entries = rollingUsdMovers();" +
  source.slice(statementEnd + 1);

fs.writeFileSync(file, source);

console.log("[SYNCED] Module 2 rolling USD leaderboard");
console.log("[SYNCED] Module 16 rolling USD leaderboard");
console.log("[SYNCED] Shared 432-second timestamp window");
console.log("[SYNCED] Pair-specific opening and latest USD observations");
