from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

a = s.index("function rollingUsdMovers()")
b = s.index("\nfunction leaderboard()", a)
c = s.find("\nfunction ", b + 1)
if c < 0:
    c = len(s)

query = r'''
function rollingUsdMovers() {
  const end = Date.now();
  const start = end - 432000;

  return DB.prepare(`
    WITH active_round AS (
      SELECT id
      FROM rounds
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
    ),
    observations AS (
      SELECT
        mpo.mint,
        mpo.pair_address,
        mpo.observed_at,
        mpo.price_sol * (
          SELECT po.sol_usd
          FROM price_observations po
          WHERE po.sol_usd > 0
            AND po.observed_at <= mpo.observed_at
          ORDER BY po.observed_at DESC, po.id DESC
          LIMIT 1
        ) AS price_usd,
        ROW_NUMBER() OVER (
          PARTITION BY mpo.mint, mpo.pair_address
          ORDER BY mpo.observed_at DESC
        ) AS last_rank,
        COUNT(*) OVER (
          PARTITION BY mpo.mint, mpo.pair_address
        ) AS samples
      FROM market_pair_observations mpo
      WHERE mpo.price_sol > 0
        AND mpo.pair_address IS NOT NULL
        AND mpo.observed_at BETWEEN ? AND ?
    ),
    latest_prices AS (
      SELECT mint, pair_address, price_usd AS current_price_usd, samples
      FROM observations
      WHERE last_rank = 1
        AND price_usd > 0
        AND samples >= 2
    )
    SELECT
      lp.mint,
      t.symbol,
      t.name,
      lp.pair_address,
      re.opening_price_usd,
      lp.current_price_usd,
      lp.current_price_usd - re.opening_price_usd AS movement_usd,
      ((lp.current_price_usd - re.opening_price_usd)
        / re.opening_price_usd) * 100 AS movement_percent,
      lp.samples AS sample_count
    FROM latest_prices lp
    JOIN active_round ar
    JOIN round_entries re
      ON re.round_id = ar.id
     AND re.mint = lp.mint
    LEFT JOIN tokens t ON t.mint = lp.mint
    WHERE re.opening_price_usd > 0
    ORDER BY movement_percent DESC
    LIMIT 10
  `).all(start, end);
}
'''

leaderboard = r'''
function leaderboard() {
  title("02 — LIVE 432-SECOND USD MOVEMENT LEADERBOARD");

  const end = Date.now();
  const start = end - 432000;
  const entries = rollingUsdMovers();

  console.log("WINDOW START: " + new Date(start).toLocaleString());
  console.log("WINDOW END:   " + new Date(end).toLocaleString());
  console.log("WINDOW: 432 SECONDS");
  console.log("");
  console.log("HIGHEST PERCENTAGE MOVEMENT → LOWEST");
  console.log("Pairs with movement: " + entries.length);

  if (!entries.length) {
    console.log("Waiting for at least two observations per pair and a round opening price.");
    return;
  }

  const medals = ["🏆", "🥈", "🥉"];

  for (const [index, entry] of entries.entries()) {
    const movement = Number(entry.movement_usd);
    const percent = Number(entry.movement_percent);
    const opening = Number(entry.opening_price_usd);
    const current = Number(entry.current_price_usd);
    const sign = movement >= 0 ? "+" : "-";
    const label = entry.symbol || entry.name || entry.mint;

    console.log(
      `${medals[index] || " " + String(index + 1) + "."} ${label} | ${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`
    );
    console.log(`   ROUND MOVEMENT: ${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`);
    console.log(`   USD MOVEMENT:  ${sign}$${Math.abs(movement).toExponential(10)}`);
    console.log(`   OPEN USD:      $${opening.toExponential(10)}`);
    console.log(`   CURRENT USD:   $${current.toExponential(10)}`);
    console.log(`   SAMPLES:       ${entry.sample_count}`);
    console.log(`   MINT: ${entry.mint}`);
    console.log(`   PAIR: ${entry.pair_address}`);
  }
}
'''

s = s[:a] + query + "\n" + leaderboard + s[c:]
p.write_text(s)
print("[APPLIED] Module 02: top 10, descending signed round percentage, USD movement.")
