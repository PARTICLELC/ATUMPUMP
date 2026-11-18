from pathlib import Path
import shutil

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.find("function rollingUsdMovers() {")
end = s.find("\nfunction leaderboard()", start)

if start < 0 or end < 0:
    raise SystemExit("Module 2 function not found; no changes made.")

new_function = r'''
function rollingUsdMovers() {
  const now = Date.now();
  const baselineStart = now - 3600000;
  const roundStart = now - 432000;

  return DB.prepare(`
    WITH priced AS (
      SELECT
        mpo.mint,
        mpo.pair_address,
        mpo.observed_at,
        mpo.id,
        mpo.price_sol * (
          SELECT po.sol_usd
          FROM price_observations po
          WHERE po.sol_usd > 0
            AND po.observed_at <= mpo.observed_at
          ORDER BY po.observed_at DESC, po.id DESC
          LIMIT 1
        ) AS price_usd
      FROM market_pair_observations mpo
      WHERE mpo.price_sol > 0
        AND mpo.pair_address IS NOT NULL
        AND mpo.observed_at BETWEEN ? AND ?
    ),
    personal AS (
      SELECT
        mint,
        pair_address,
        MIN(observed_at) AS baseline_time,
        MAX(observed_at) AS current_time,
        COUNT(*) AS sample_count,
        MAX(CASE WHEN observed_at = (
          SELECT MIN(p2.observed_at)
          FROM priced p2
          WHERE p2.mint = priced.mint
            AND p2.pair_address = priced.pair_address
        ) THEN price_usd END) AS personal_opening_usd,
        MAX(CASE WHEN observed_at = (
          SELECT MAX(p2.observed_at)
          FROM priced p2
          WHERE p2.mint = priced.mint
            AND p2.pair_address = priced.pair_address
        ) THEN price_usd END) AS current_price_usd
      FROM priced
      GROUP BY mint, pair_address
      HAVING COUNT(*) >= 2
    ),
    qualified AS (
      SELECT *,
        ((current_price_usd / personal_opening_usd) - 1) * 100
          AS personal_gain_percent
      FROM personal
      WHERE personal_opening_usd > 0
        AND current_price_usd > 0
        AND ((current_price_usd / personal_opening_usd) - 1) * 100 >= 13.0
    ),
    round_prices AS (
      SELECT
        q.mint,
        q.pair_address,
        (
          SELECT p2.price_usd
          FROM priced p2
          WHERE p2.mint = q.mint
            AND p2.pair_address = q.pair_address
            AND p2.observed_at >= ?
            AND p2.price_usd > 0
          ORDER BY p2.observed_at ASC, p2.id ASC
          LIMIT 1
        ) AS window_opening_usd
      FROM qualified q
    ),
    active_round AS (
      SELECT id
      FROM rounds
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
    )
    SELECT
      q.mint,
      t.symbol,
      t.name,
      q.pair_address,
      q.personal_opening_usd,
      q.personal_gain_percent,
      COALESCE(
        NULLIF(re.opening_price_usd, 0),
        rp.window_opening_usd
      ) AS opening_price_usd,
      q.current_price_usd,
      CASE
        WHEN COALESCE(NULLIF(re.opening_price_usd, 0),
                      rp.window_opening_usd) > 0
        THEN q.current_price_usd -
             COALESCE(NULLIF(re.opening_price_usd, 0),
                      rp.window_opening_usd)
        ELSE NULL
      END AS movement_usd,
      CASE
        WHEN COALESCE(NULLIF(re.opening_price_usd, 0),
                      rp.window_opening_usd) > 0
        THEN (
          q.current_price_usd /
          COALESCE(NULLIF(re.opening_price_usd, 0),
                   rp.window_opening_usd) - 1
        ) * 100
        ELSE NULL
      END AS movement_percent,
      q.sample_count
    FROM qualified q
    LEFT JOIN round_prices rp
      ON rp.mint = q.mint AND rp.pair_address = q.pair_address
    LEFT JOIN active_round ar ON 1 = 1
    LEFT JOIN round_entries re
      ON re.round_id = ar.id AND re.mint = q.mint
    LEFT JOIN tokens t ON t.mint = q.mint
    ORDER BY movement_percent DESC,
             q.personal_gain_percent DESC
    LIMIT 10
  `).all(baselineStart, now, roundStart);
}
'''

backup = Path("src/control_center.mjs.pre_13pct_personal")
shutil.copy2(p, backup)

s = s[:start] + new_function + s[end:]

# Ensure the display calculates and prints both gains.
import re

gain_pattern = re.compile(
    r'(?m)^([ \t]*)const gain = .*?;\n'
    r'\1const movementText =',
    re.S
)

replacement = r'''\1const personalPercent = Number(entry.personal_gain_percent);
\1const personalGain = `${personalPercent >= 0 ? "+" : ""}${personalPercent.toFixed(2)}%`;
\1const gain = Number.isFinite(percent)
\1  ? `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`
\1  : "N/A";
\1const movementText ='''

s, count = gain_pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit("Gain display calculation not found. Restore backup if needed.")

s = re.sub(
    r'(?m)^([ \t]*)console\.log\(`\$\{green\}  ROUND GAIN\s+\$\{gain\}.*?\);\s*$',
    r'\1console.log(`${green}  PERSONAL GAIN  ${personalGain}${reset}`);\n'
    r'\1console.log(`${green}  ROUND GAIN     ${gain}${reset}`);',
    s,
    count=1
)

p.write_text(s)
print("INSTALLED: PERSONAL GAIN >= +13.00% CANDIDATE GATE")
print("60-minute personal baseline")
print("432-second round comparison")
print("PERSONAL GAIN and ROUND GAIN displayed separately")
print("Leaderboard ranked by ROUND GAIN")
print("Backup:", backup)
