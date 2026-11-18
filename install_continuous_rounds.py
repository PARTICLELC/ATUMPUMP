from pathlib import Path
import shutil

p = Path("src/championship_engine.mjs")
s = p.read_text()

backup = Path("src/championship_engine.mjs.pre_continuous_rounds")
shutil.copy2(p, backup)

changes = []

# 1. Store qualification status in the existing round_entries.qualified field.
old = """  insertEntry: DB.prepare(`
    INSERT OR IGNORE INTO round_entries
      (round_id, mint, opening_price_sol, opening_at, qualified)
    VALUES (?, ?, ?, ?, 0)
  `),"""

new = """  insertEntry: DB.prepare(`
    INSERT OR IGNORE INTO round_entries
      (round_id, mint, opening_price_sol, opening_at, qualified)
    VALUES (?, ?, ?, ?, ?)
  `),"""

if old not in s:
    raise SystemExit("Could not locate insertEntry SQL. No changes applied.")

s = s.replace(old, new, 1)
changes.append("qualified entry persistence")

# 2. Every fresh eligible token enters the round. No +13% entry filter.
old = """  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - 3600000,
    now - 3600000,
    now,
    now - freshness
  ).filter(token => {
    const baseline = Number(token.baseline_price_sol);
    const current = Number(token.price_sol);
    if (!(baseline > 0) || !(current > 0)) return false;
    return ((current / baseline) - 1) * 100 >= 13;
  });"""

new = """  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - 3600000,
    now - 3600000,
    now,
    now - freshness
  );"""

if old not in s:
    raise SystemExit("Could not locate candidate filter. No changes applied.")

s = s.replace(old, new, 1)
changes.append("all fresh eligible tokens enter rounds")

# 3. Calculate and store +13% personal pip-gain qualification at round opening.
old = """      sql.insertEntry.run(
        id,
        token.mint,
        token.price_sol,
        token.observed_at
      );"""

new = """      const baseline = Number(token.baseline_price_sol);
      const current = Number(token.price_sol);
      const qualified =
        baseline > 0 &&
        current > 0 &&
        ((current / baseline) - 1) * 100 >= 13
          ? 1
          : 0;

      sql.insertEntry.run(
        id,
        token.mint,
        token.price_sol,
        token.observed_at,
        qualified
      );"""

if old not in s:
    raise SystemExit("Could not locate round-entry insertion. No changes applied.")

s = s.replace(old, new, 1)
changes.append("13% personal pip qualification recorded")

# 4. Only qualified entries appear on the leaderboard.
old = """  for (const entry of entries) {
    const latest = sql.latest.get("""
new = """  for (const entry of entries) {
    if (Number(entry.qualified) !== 1) continue;

    const latest = sql.latest.get("""
if old not in s:
    raise SystemExit("Could not locate leaderboard entry loop. No changes applied.")

s = s.replace(old, new, 1)
changes.append("leaderboard restricted to qualified entries")

# 5. Update round-start messaging.
s = s.replace(
    'console.log("Opening baselines:", candidates.length);',
    'console.log("Fresh eligible round entries:", candidates.length);',
    1
)
s = s.replace(
    'console.log("ROUND ENTRY GAIN FILTER: +13.00% | BASELINE LOOKBACK: 60 MINUTES");',
    'console.log("LEADERBOARD QUALIFICATION: +13.00% PERSONAL PIP GAIN | 60-MINUTE BASELINE");',
    1
)
s = s.replace(
    '"[ROUND WAIT] No tokens currently qualify for the +13.00% personal pip-gain threshold."',
    '"[ROUND WAIT] No fresh eligible token observations available."'
)

p.write_text(s)

print("CONTINUOUS ROUND IMPLEMENTATION INSTALLED")
for item in changes:
    print("  [OK]", item)
print("ROUND DURATION: 432 seconds")
print("ROUND ENTRY: all fresh eligible tokens")
print("LEADERBOARD: +13% personal pip-gain qualification")
print("BACKUP:", backup)
