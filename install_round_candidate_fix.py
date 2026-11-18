from pathlib import Path
import shutil

p = Path("src/championship_engine.mjs")
s = p.read_text()

start = s.find("  candidates: DB.prepare(`")
if start < 0:
    raise SystemExit("Candidate SQL not found.")

end = s.find("\n  `),", start)
if end < 0:
    raise SystemExit("Candidate SQL boundary not found.")

end += len("\n  `),")

new_sql = r'''  candidates: DB.prepare(`
    SELECT
      t.mint,
      p.observed_at,
      p.price_sol,
      COALESCE(
        (
          SELECT baseline.price_sol
          FROM price_observations baseline
          WHERE baseline.mint = t.mint
            AND baseline.observed_at <= ?
            AND baseline.observed_at >= ?
            AND baseline.price_sol > 0
          ORDER BY baseline.observed_at DESC, baseline.id DESC
          LIMIT 1
        ),
        (
          SELECT baseline.price_sol
          FROM price_observations baseline
          WHERE baseline.mint = t.mint
            AND baseline.observed_at >= ?
            AND baseline.observed_at < p.observed_at
            AND baseline.price_sol > 0
          ORDER BY baseline.observed_at ASC, baseline.id ASC
          LIMIT 1
        )
      ) AS baseline_price_sol
    FROM tokens t
    JOIN price_observations p ON p.id = (
      SELECT p2.id
      FROM price_observations p2
      WHERE p2.mint = t.mint
        AND p2.observed_at <= ?
        AND p2.observed_at >= ?
        AND p2.price_sol > 0
      ORDER BY p2.observed_at DESC, p2.id DESC
      LIMIT 1
    )
    WHERE t.eligible = 1
      AND p.price_sol > 0
    ORDER BY t.mint
  `),'''

backup = p.with_suffix(".mjs.pre_round_candidate_fix")
shutil.copy2(p, backup)

s = s[:start] + new_sql + s[end:]

old = '''  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - 3600000,
    now,
    now - freshness
  ).filter(token => {'''

new = '''  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - 3600000,
    now - 3600000,
    now,
    now - freshness
  ).filter(token => {'''

if old not in s:
    raise SystemExit("Candidate parameter block not found; restore from backup if needed.")

s = s.replace(old, new, 1)

s = s.replace(
    '"[ROUND WAIT] No fresh opening prices. Keep market_capture.mjs running."',
    '"[ROUND WAIT] No tokens currently qualify for the +13.00% personal pip-gain threshold."',
    1
)

p.write_text(s)

print("ROUND CANDIDATE RETRIEVAL PATCHED")
print("BASELINE: 60-minute lookback with available-observation fallback")
print("CURRENT PRICE: fresh observation only")
print("PERSONAL PIP GAIN FILTER: +13.00% — unchanged")
print("ROUND DURATION: 432 seconds — unchanged")
print("HISTORY: preserved")
print("BACKUP:", backup)
