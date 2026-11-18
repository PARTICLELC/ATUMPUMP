from pathlib import Path

path = Path("src/control_center.mjs")
source = path.read_text()

start = source.index("async function liveRoundWatch()")
end = source.index("\nconst actions =", start)
block = source[start:end]

old_sort = '''        return bp - ap;
      });

      log("");'''

new_sort = '''        return bp - ap;
      });

      const candidates = entries.filter(entry => {
        const opening = Number(entry.opening_price_usd);
        const current = Number(entry.current_price_usd);

        if (
          !Number.isFinite(opening) ||
          !Number.isFinite(current) ||
          opening <= 0 ||
          current <= 0
        ) return false;

        const roundGain = ((current / opening) - 1) * 100;
        return roundGain >= 27;
      });

      const belowThreshold = entries.length - candidates.length;

      log("");'''

if block.count(old_sort) != 1:
    raise SystemExit("[STOP] Ranking insertion point not unique. No changes written.")

block = block.replace(old_sort, new_sort, 1)

old_header = '''      log(`${gold}========== 🏆 POSITIVE MOVERS ==========${reset}`);
      log(`${cyan}HIERARCHY: HIGHEST ROUND GAIN PERCENTAGE → LOWEST${reset}`);
      log(`${cyan}Pairs with movement:${reset} ${entries.length}`);'''

new_header = '''      log(`${gold}========== 🏆 QUALIFIED ROUND CANDIDATES ==========${reset}`);
      log(`${cyan}ELIGIBILITY THRESHOLD: +27.00% MINIMUM ROUND GAIN${reset}`);
      log(`${cyan}HIERARCHY: HIGHEST QUALIFIED ROUND GAIN → LOWEST${reset}`);
      log(`${cyan}Qualified candidates:${reset} ${candidates.length}`);
      log(`${cyan}Below +27.00% threshold:${reset} ${belowThreshold}`);'''

if block.count(old_header) != 1:
    raise SystemExit("[STOP] Candidate header not found uniquely. No changes written.")

block = block.replace(old_header, new_header, 1)

old_empty = '''      if (!entries.length) {
        log(`${C.dim}No qualifying price movements recorded in the 432-second window.${reset}`);
      }

      entries.forEach((entry, index) => {'''

new_empty = '''      if (!candidates.length) {
        log(`${C.dim}No tokens have reached the +27.00% candidate threshold in this round.${reset}`);
      }

      candidates.forEach((entry, index) => {'''

if block.count(old_empty) != 1:
    raise SystemExit("[STOP] Candidate rendering loop not found uniquely. No changes written.")

block = block.replace(old_empty, new_empty, 1)

source = source[:start] + block + source[end:]
path.write_text(source)

print("[APPLIED] Module 16 candidate eligibility threshold: +27.00%.")
print("[PRESERVED] Round records, scoring, market data, and refresh intervals.")
