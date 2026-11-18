from pathlib import Path

path = Path("src/control_center.mjs")
source = path.read_text()

start = source.index("async function watchlist()")
end = source.index("\nfunction trophies()", start)
block = source[start:end]

old = """  for (const row of rows) {
    console.log("--------------------------------------------");"""

new = """  const qualifyingRows = rows.filter(row => {
    const entryPrice = Number(row.entry_price_sol);
    const latestPrice = Number(row.latest_price_sol);

    if (
      !Number.isFinite(entryPrice) || entryPrice <= 0 ||
      !Number.isFinite(latestPrice) || latestPrice <= 0
    ) return false;

    return ((latestPrice / entryPrice) - 1) * 100 >= 80;
  });

  console.log(`QUALIFIED WATCHLIST PAIRS: ${qualifyingRows.length}`);
  console.log("ADMISSION THRESHOLD: +80.00% LIVE GAIN");

  if (qualifyingRows.length === 0) {
    console.log("No watchlist pairs currently meet the +80.00% threshold.");
  }

  for (const row of qualifyingRows) {
    console.log("--------------------------------------------");"""

if block.count(old) != 1:
    raise SystemExit("PATCH STOPPED: Watchlist display loop was not found exactly once.")

block = block.replace(old, new, 1)
path.write_text(source[:start] + block + source[end:])
print("[APPLIED] Module 04 displays only pairs at +80.00% live gain or higher.")
