from pathlib import Path

p = Path("src/championship_engine.mjs")
s = p.read_text()

old = """  candidates: DB.prepare(`
    SELECT t.mint, p.observed_at, p.price_sol
    FROM tokens t
    JOIN price_observations p ON p.id = (
      SELECT p2.id
      FROM price_observations p2
      WHERE p2.mint = t.mint AND p2.observed_at <= ?
      ORDER BY p2.observed_at DESC, p2.id DESC
      LIMIT 1
    )
    WHERE t.eligible = 1 AND p.observed_at >= ?
    ORDER BY t.mint
  `),"""

new = """  candidates: DB.prepare(`
    SELECT t.mint, p.observed_at, p.price_sol
    FROM tokens t
    JOIN price_observations p ON p.id = (
      SELECT p2.id
      FROM price_observations p2
      WHERE p2.mint = t.mint AND p2.observed_at <= ?
      ORDER BY p2.observed_at DESC, p2.id DESC
      LIMIT 1
    )
    WHERE t.eligible = 1
      AND p.observed_at >= ?
      AND p.price_sol > 0
      AND p.price_sol >= (
        SELECT baseline.price_sol * 2.37
        FROM price_observations baseline
        WHERE baseline.mint = t.mint
          AND baseline.price_sol > 0
        ORDER BY baseline.observed_at ASC, baseline.id ASC
        LIMIT 1
      )
    ORDER BY t.mint
  `),"""

if old not in s:
    raise SystemExit("[STOPPED] Candidate query did not match. No changes written.")

s = s.replace(old, new, 1)
p.write_text(s)
print("[INSTALLED] Championship round admission threshold: +137.00% from first recorded positive SOL price.")
