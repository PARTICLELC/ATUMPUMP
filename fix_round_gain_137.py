from pathlib import Path

p = Path("src/championship_engine.mjs")
s = p.read_text()

start = s.index("  candidates: DB.prepare(`")
end = s.index("\n  `),", start) + len("\n  `),")

new = """  candidates: DB.prepare(`
    SELECT t.mint, p.observed_at, p.price_sol,
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
      WHERE p2.mint = t.mint AND p2.observed_at <= ?
      ORDER BY p2.observed_at DESC, p2.id DESC
      LIMIT 1
    )
    WHERE t.eligible = 1
      AND p.observed_at >= ?
      AND p.price_sol > 0
    ORDER BY t.mint
  `),"""

s = s[:start] + new + s[end:]

old = """  const candidates = sql.candidates.all(now, now - freshness);"""
new_line = """  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - (ROUND_MS * 2),
    now,
    now - freshness
  ).filter(token => {
    const baseline = Number(token.baseline_price_sol);
    const current = Number(token.price_sol);
    if (!(baseline > 0) || !(current > 0)) return false;
    return ((current / baseline) - 1) * 100 >= 137;
  });"""

if old not in s:
    raise SystemExit("[STOPPED] startRound candidate line not found; no write.")
s = s.replace(old, new_line, 1)

old_log = 'console.log("Opening baselines:", candidates.length);'
new_log = '''console.log("Opening baselines:", candidates.length);
    console.log("ROUND ENTRY GAIN FILTER: +137.00% over preceding 432 seconds");'''
if old_log in s:
    s = s.replace(old_log, new_log, 1)

p.write_text(s)
print("[INSTALLED] New-round admission requires at least +137.00% SOL price gain over the preceding 432 seconds.")
