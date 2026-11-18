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

old = s[start:end]

new = """const getUnobservedTokens = db.prepare(`
  SELECT t.mint
  FROM tokens t
  WHERE t.eligible = 1
  ORDER BY
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM round_entries re
        JOIN rounds r ON r.id = re.round_id
        WHERE re.mint = t.mint
          AND r.status = 'active'
      ) THEN 0
      ELSE 1
    END ASC,

    CASE
      WHEN (
        SELECT COUNT(*)
        FROM price_observations po
        WHERE po.mint = t.mint
      ) = 0
      AND COALESCE((
        SELECT MAX(mp.volume_h24)
        FROM market_pairs mp
        WHERE mp.mint = t.mint
          AND mp.active = 1
      ), 0) > 0 THEN 1

      WHEN (
        SELECT COUNT(*)
        FROM price_observations po
        WHERE po.mint = t.mint
      ) >= 2
      AND COALESCE((
        SELECT MAX(po.observed_at)
        FROM price_observations po
        WHERE po.mint = t.mint
      ), 0) < (CAST(strftime('%s','now') AS INTEGER) * 1000 - 432000)
      AND COALESCE((
        SELECT MAX(mp.volume_h24)
        FROM market_pairs mp
        WHERE mp.mint = t.mint
          AND mp.active = 1
      ), 0) > 0 THEN 2

      WHEN (
        SELECT COUNT(*)
        FROM price_observations po
        WHERE po.mint = t.mint
      ) = 1 THEN 3

      WHEN (
        SELECT COUNT(*)
        FROM price_observations po
        WHERE po.mint = t.mint
      ) >= 2 THEN 4

      ELSE 5
    END ASC,

    COALESCE(t.last_checked_at, 0) ASC,

    COALESCE((
      SELECT MAX(mp.volume_h24)
      FROM market_pairs mp
      WHERE mp.mint = t.mint
        AND mp.active = 1
    ), 0) DESC,

    t.first_seen_at ASC
  LIMIT ?
`);"""

if old == new:
    print("Scheduler already installed.")
else:
    backup = p.with_suffix(".mjs.scheduler-backup")
    backup.write_text(s)
    p.write_text(s[:start] + new + s[end:])
    print("INSTALLED: active > high-volume unobserved > stale high-volume > second observation > established.")
    print("BACKUP:", backup)
