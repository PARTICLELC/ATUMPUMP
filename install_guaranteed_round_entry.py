from pathlib import Path
import shutil

p = Path("src/championship_engine.mjs")
s = p.read_text()

backup = Path("src/championship_engine.mjs.pre_guaranteed_round_entry")
shutil.copy2(p, backup)

start = s.find("  candidates: DB.prepare(`")
if start < 0:
    raise SystemExit("Candidate SQL not found.")

end = s.find("\n  `),", start)
if end < 0:
    raise SystemExit("Candidate SQL ending not found.")
end += len("\n  `),")

replacement = """  candidates: DB.prepare(`
    SELECT
      t.mint,
      p.observed_at,
      p.price_sol,
      (
        SELECT baseline.price_sol
        FROM price_observations baseline
        WHERE baseline.mint = t.mint
          AND baseline.observed_at <= ?
          AND baseline.observed_at >= ?
          AND baseline.price_sol > 0
        ORDER BY baseline.observed_at DESC, baseline.id DESC
        LIMIT 1
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
    ORDER BY t.mint
  `),"""

s = s[:start] + replacement + s[end:]

old = """  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - 3600000,
    now - 3600000,
    now,
    now - freshness
  );"""

new = """  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - 3600000,
    now,
    now - freshness
  );"""

if old not in s:
    raise SystemExit("Candidate parameter block mismatch.")

s = s.replace(old, new, 1)

# Explicitly report that entry is independent of qualification.
s = s.replace(
    'console.log("Fresh eligible round entries:", candidates.length);',
    'console.log("Fresh eligible round entries:", candidates.length);\\n'
    '    console.log("Round entry requires +0% threshold: all fresh eligible tokens");',
    1
)

p.write_text(s)
print("INSTALLED: DIRECT FRESH-OBSERVATION ROUND ENTRY")
print("ROUND ENTRY: all fresh eligible tokens")
print("PERSONAL PIP QUALIFICATION: +13%, independent")
print("ROUND DURATION: 432 seconds")
print("BACKUP:", backup)
