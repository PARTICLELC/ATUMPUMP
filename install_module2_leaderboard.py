from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

old = """  const end = Date.now();
  const start = end - 432000;
  const entries = rollingUsdMovers();
"""

new = """  const end = Date.now();
  const start = end - 432000;

  // OMNICIPHERIST: 7.2-minute championship qualification.
  const ENTRY_THRESHOLD_PERCENT = 13.00;
  const entries = rollingUsdMovers()
    .filter(entry => {
      const gain = Number(entry.movement_percent);
      return Number.isFinite(gain) && gain >= ENTRY_THRESHOLD_PERCENT;
    })
    .sort((a, b) =>
      Number(b.movement_percent) - Number(a.movement_percent)
    )
    .slice(0, 10);
"""

if old not in s:
    raise SystemExit("Module 2 insertion point not found; no changes made.")

s = s.replace(old, new, 1)

old_header = """  console.log(`  DURATION         432 SECONDS`);
  console.log(`  QUALIFIED PAIRS  ${entries.length}${reset}`);
"""

new_header = """  console.log(`  DURATION         432 SECONDS`);
  console.log(`  ENTRY THRESHOLD  +13.00%`);
  console.log(`  BASELINE         60 MINUTES`);
  console.log(`  QUALIFIED PAIRS  ${entries.length}${reset}`);
"""

if old_header not in s:
    raise SystemExit("Module 2 header insertion point not found; no changes made.")

s = s.replace(old_header, new_header, 1)
p.write_text(s)

print("INSTALLED: MODULE 2 LIVE QUALIFICATION")
print("Threshold: +13.00%")
print("Baseline: 60 minutes")
print("Comparison: 432 seconds")
print("Round: 432 seconds")
print("Ranking: highest qualifying gain first")
print("Maximum display: 10 qualifying pairs")
