from pathlib import Path
import shutil

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.find("function rollingUsdMovers() {")
end = s.find("\nfunction leaderboard()", start)

if start < 0 or end < 0:
    raise SystemExit("Could not locate Module 2 calculation. No changes made.")

new_function = r'''
function rollingUsdMovers() {
  const end = Date.now();
  const personalStart = end - 3600000;
  const roundStart = end - 432000;

  return DB.prepare(`
    WITH observations AS (
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
          ORDER BY mpo.observed_at ASC, mpo.id ASC
        ) AS first_rank,
        ROW_NUMBER() OVER (
          PARTITION BY mpo.mint, mpo.pair_address
          ORDER BY mpo.observed_at DESC, mpo.id DESC
        ) AS last_rank,
        COUNT(*) OVER (
          PARTITION BY mpo.mint, mpo.pair_address
        ) AS samples
      FROM market_pair_observations mpo
      WHERE mpo.price_sol > 0
        AND mpo.pair_address IS NOT NULL
        AND mpo.observed_at BETWEEN ? AND ?
    ),
    personal AS (
      SELECT
        mint,
        pair_address,
        MAX(CASE WHEN first_rank = 1 THEN price_usd END)
          AS personal_opening_usd,
        MAX(CASE WHEN last_rank = 1 THEN price_usd END)
          AS current_price_usd,
        MAX(samples) AS sample_count
      FROM observations
      GROUP BY mint, pair_address
      HAVING MAX(CASE WHEN first_rank = 1 THEN price_usd END) > 0
         AND MAX(CASE WHEN last_rank = 1 THEN price_usd END) > 0
         AND MAX(samples) >= 2
    ),
    round_ranked AS (
      SELECT
        mint,
        pair_address,
        price_usd,
        ROW_NUMBER() OVER (
          PARTITION BY mint, pair_address
          ORDER BY observed_at ASC
        ) AS round_first_rank
      FROM observations
      WHERE observed_at >= ?
    ),
    round_openings AS (
      SELECT
        mint,
        pair_address,
        MAX(CASE WHEN round_first_rank = 1 THEN price_usd END)
          AS round_opening_usd
      FROM round_ranked
      GROUP BY mint, pair_address
    ),
    active_round AS (
      SELECT id
      FROM rounds
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
    ),
    candidates AS (
      SELECT
        p.mint,
        p.pair_address,
        p.current_price_usd,
        p.sample_count,
        p.personal_opening_usd,
        ((p.current_price_usd / p.personal_opening_usd) - 1) * 100
          AS personal_gain_percent,
        COALESCE(
          NULLIF(re.opening_price_usd, 0),
          ro.round_opening_usd
        ) AS round_opening_usd
      FROM personal p
      LEFT JOIN round_openings ro
        ON ro.mint = p.mint
       AND ro.pair_address = p.pair_address
      LEFT JOIN active_round ar ON 1 = 1
      LEFT JOIN round_entries re
        ON re.round_id = ar.id
       AND re.mint = p.mint
      WHERE ((p.current_price_usd / p.personal_opening_usd) - 1) * 100
            >= 13.0
    )
    SELECT
      c.mint,
      t.symbol,
      t.name,
      c.pair_address,
      c.personal_opening_usd,
      c.personal_gain_percent,
      c.round_opening_usd AS opening_price_usd,
      c.current_price_usd,
      CASE
        WHEN c.round_opening_usd > 0
        THEN c.current_price_usd - c.round_opening_usd
        ELSE NULL
      END AS movement_usd,
      CASE
        WHEN c.round_opening_usd > 0
        THEN ((c.current_price_usd / c.round_opening_usd) - 1) * 100
        ELSE NULL
      END AS movement_percent,
      c.sample_count
    FROM candidates c
    LEFT JOIN tokens t ON t.mint = c.mint
    ORDER BY movement_percent DESC,
             c.personal_gain_percent DESC
    LIMIT 10
  `).all(personalStart, end, roundStart);
}
'''

# Remove the old display-only round-gain qualification.
old_filter = '''  const entries = rollingUsdMovers()
    .filter(entry => {
      const gain = Number(entry.movement_percent);
      return Number.isFinite(gain) && gain >= 13;
    })
    .sort((a, b) =>
      Number(b.movement_percent) - Number(a.movement_percent)
    )
    .slice(0, 10);
'''
if old_filter not in s:
    raise SystemExit("Expected previous Module 2 filter not found. No changes made.")

s = s[:start] + new_function + s[end:]
s = s.replace(old_filter, "  const entries = rollingUsdMovers();", 1)

old_gain = '''    const gain = `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
    const movementText =
'''
new_gain = '''    const personalPercent = Number(entry.personal_gain_percent);
    const personalGain = Number.isFinite(personalPercent)
      ? `${personalPercent >= 0 ? "+" : ""}${personalPercent.toFixed(2)}%`
      : "N/A";
    const gain = Number.isFinite(percent)
      ? `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`
      : "N/A";
    const movementText =
'''
if old_gain not in s:
    raise SystemExit("Gain display insertion point not found. No changes made.")

s = s.replace(old_gain, new_gain, 1)

old_display = '''    console.log(`${green}  ROUND GAIN  ${gain}${reset}`);
'''
new_display = '''    console.log(`${green}  PERSONAL GAIN  ${personalGain}${reset}`);
    console.log(`${green}  ROUND GAIN     ${gain}${reset}`);
'''
if old_display not in s:
    raise SystemExit("Round gain display line not found. No changes made.")

s = s.replace(old_display, new_display, 1)

backup = Path("src/control_center.mjs.pre_personal_round_gain")
shutil.copy2(p, backup)
p.write_text(s)

print("MODULE 2 CANDIDATE ENGINE INSTALLED")
print("Personal qualification: >= +13% over 60-minute observation baseline")
print("Round measurement: 432 seconds")
print("Round opening: active round opening price, otherwise first round-window observation")
print("Display: PERSONAL GAIN and ROUND GAIN")
print("Ranking: ROUND GAIN descending")
print("Maximum displayed candidates: 10")
print("Historical database records preserved")
print("Backup:", backup)
