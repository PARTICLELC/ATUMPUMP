from pathlib import Path

p = Path("src/market_capture.mjs")
s = p.read_text()

start = s.find("const getUnobservedTokens = db.prepare(`")
end = s.find("`);", start)

if start < 0 or end < 0:
    raise SystemExit("ABORT: scheduler not found")

end += 3

new = """const getUnobservedTokens = db.prepare(`
  SELECT t.mint
  FROM tokens t
  WHERE t.eligible = 1
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1
      FROM round_entries re
      JOIN rounds r ON r.id = re.round_id
      WHERE re.mint = t.mint
        AND r.status = 'active'
    ) THEN 0 ELSE 1 END ASC,

    CASE
      WHEN (
        SELECT COUNT(*)
        FROM price_observations po
        WHERE po.mint = t.mint
      ) = 0
      AND COALESCE((
        SELECT MAX(mp.volume_h24)
        FROM market_pairs mp
        WHERE mp.mint = t.mint AND mp.active = 1
      ), 0) > 0 THEN 0

      WHEN (
        SELECT COUNT(*)
        FROM price_observations po
        WHERE po.mint = t.mint
      ) = 1 THEN 1

      WHEN (
        SELECT COUNT(*)
        FROM price_observations po
        WHERE po.mint = t.mint
      ) >= 2 THEN 2

      ELSE 3
    END ASC,

    COALESCE((
      SELECT MAX(mp.volume_h24)
      FROM market_pairs mp
      WHERE mp.mint = t.mint AND mp.active = 1
    ), 0) DESC,

    COALESCE(t.last_checked_at, 0) ASC,
    t.first_seen_at ASC
  LIMIT ?
`);"""

backup = p.with_suffix(".mjs.before_72m_leaderboard")
backup.write_text(s)
p.write_text(s[:start] + new + s[end:])

print("INSTALLED: exact five-tier capture scheduler.")
print("BACKUP:", backup)

engine = Path("src/championship_engine.mjs")
e = engine.read_text()

if "ROUND_MS" not in e:
    raise SystemExit("Scheduler installed. Engine ROUND_MS declaration requires manual integration.")

print("ENGINE FILE FOUND:", engine)
print("Expected championship settings:")
print("  ROUND_MS = 432000")
print("  ENTRY THRESHOLD = 13%")
print("  BASELINE LOOKBACK = 3600000")
print("  COMPARISON WINDOW = 432000")
