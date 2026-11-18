from pathlib import Path

file = Path("src/control_center.mjs")
source = file.read_text()

start = source.index("function watchlist() {")
end = source.find("\nfunction ", start + 1)

if end == -1:
    raise SystemExit("STOP: Could not locate watchlist function boundary.")

section = source[start:end]

old = """    FROM championship_watchlist w
    LEFT JOIN tokens t ON t.mint = w.mint
    ORDER BY w.rowid DESC
  `).all();"""

new = """    FROM championship_watchlist w
    LEFT JOIN tokens t ON t.mint = w.mint
  `).all();"""

if old not in section:
    raise SystemExit("STOP: Expected watchlist query ending not found.")

section = section.replace(old, new, 1)

marker = """  const money = value => {"""

addition = """  const getLiveGain = row => {
    const entry = Number(row.entry_price_sol);
    const latest = Number(row.latest_price_sol);
    return Number.isFinite(entry) && entry > 0 &&
      Number.isFinite(latest) && latest > 0
      ? ((latest / entry) - 1) * 100
      : null;
  };

  rows.sort((a, b) => {
    const gainA = getLiveGain(a);
    const gainB = getLiveGain(b);

    if (gainA === null && gainB === null) return 0;
    if (gainA === null) return 1;
    if (gainB === null) return -1;
    return gainB - gainA;
  });

  const money = value => {"""

if marker not in section:
    raise SystemExit("STOP: Could not locate watchlist formatter.")

section = section.replace(marker, addition, 1)

source = source[:start] + section + source[end:]
file.write_text(source)

print("[APPLIED] Watchlist hierarchy: highest LIVE GAIN % to lowest.")
