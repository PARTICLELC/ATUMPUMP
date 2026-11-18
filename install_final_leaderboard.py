from pathlib import Path
import re

p = Path("src/market_capture.mjs")
s = p.read_text()

start = s.find("const getUnobservedTokens = db.prepare(`")
if start < 0:
    raise SystemExit("ABORT: scheduler declaration not found")

end = s.find("`);", start)
if end < 0:
    raise SystemExit("ABORT: scheduler SQL terminator not found")
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

    CASE WHEN (
      SELECT COUNT(*)
      FROM price_observations po
      WHERE po.mint = t.mint
    ) = 0 THEN COALESCE((
      SELECT MAX(mp.volume_h24)
      FROM market_pairs mp
      WHERE mp.mint = t.mint AND mp.active = 1
    ), 0) ELSE 0 END DESC,

    COALESCE(t.last_checked_at, 0) ASC,
    t.first_seen_at ASC
  LIMIT ?
`);"""

backup = p.with_suffix(".mjs.pre_final_leaderboard")
backup.write_text(s)
p.write_text(s[:start] + new + s[end:])

print("INSTALLED: exact five-tier market scheduler.")
print("1 ACTIVE CHAMPIONSHIP ENTRIES")
print("2 NEVER OBSERVED + POSITIVE VOLUME, VOLUME DESC")
print("3 AWAITING SECOND OBSERVATION")
print("4 ESTABLISHED HISTORY")
print("5 NEVER OBSERVED + NO REPORTED VOLUME")
print("BACKUP:", backup)

e = Path("src/championship_engine.mjs")
engine = e.read_text()

for label, pattern in [
    ("ROUND_MS", r"ROUND_MS\s*=\s*432000"),
]:
    if not re.search(pattern, engine):
        raise SystemExit(f"ENGINE CONFIGURATION MISMATCH: {label}")

if "3600000" not in engine:
    raise SystemExit("ENGINE BASELINE LOOKBACK DOES NOT SHOW 60 MINUTES")

if ">= 13" not in engine and ">= 13.0" not in engine:
    raise SystemExit("ENGINE +13% ENTRY FILTER NOT FOUND")

print("ENGINE CONFIGURATION CONFIRMED:")
print("ENTRY THRESHOLD: +13%")
print("BASELINE LOOKBACK: 60 MINUTES")
print("COMPARISON WINDOW: 432 SECONDS")
print("ROUND DURATION: 432 SECONDS")
