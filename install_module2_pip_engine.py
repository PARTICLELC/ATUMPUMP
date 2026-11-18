from pathlib import Path
import shutil

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.find("function rollingUsdMovers() {")
end = s.find("\nfunction leaderboard()", start)

if start < 0 or end < 0:
    raise SystemExit("Module 2 calculation not found. No changes made.")

new_function = r'''
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
'''

backup = Path("src/control_center.mjs.pre_pip_engine")
shutil.copy2(p, backup)

s = s[:start] + new_function + s[end:]

# Personal pip gain display.
if "const personalGain =" not in s:
    old = '    const gain = `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;'
    new = '''    const personalPercent = Number(entry.personal_gain_percent);
    const personalGain = `${personalPercent >= 0 ? "+" : ""}${personalPercent.toFixed(2)}%`;
    const gain = Number.isFinite(percent)
      ? `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`
      : "WAITING";'''
    if old not in s:
        raise SystemExit("Gain display calculation not found; backup preserved.")
    s = s.replace(old, new, 1)

# Replace the ROUND GAIN line with both pip gain measurements.
import re
pattern = re.compile(
    r'(?m)^([ \t]*)console\.log\(`\$\{green\}  ROUND GAIN\s+\$\{gain\}.*?\);'
)
s, count = pattern.subn(
    r'\1console.log(`${green}  PERSONAL PIP GAIN  ${personalGain}${reset}`);\n'
    r'\1console.log(`${green}  ROUND PIP GAIN     ${gain}${reset}`);',
    s,
    count=1
)

if count != 1:
    raise SystemExit("Could not install both pip gain display lines.")

s = s.replace(
    "02  /  LIVE USD MOVEMENT CHAMPIONSHIP",
    "02  /  LIVE PIP GAIN CHAMPIONSHIP"
)

p.write_text(s)

print("MODULE 2 PIP ENGINE INSTALLED")
print("PERSONAL PIP GAIN: >= +13.00%")
print("PERSONAL BASELINE: 60 minutes")
print("ROUND PIP GAIN: 432 seconds")
print("RANKING: ROUND PIP GAIN descending")
print("CANDIDATES: personal pip gain qualification only")
print("HISTORY: preserved")
print("BACKUP:", backup)
