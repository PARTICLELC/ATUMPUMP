from pathlib import Path

path = Path("src/control_center.mjs")
source = path.read_text()

old = """  function renderLiveRound() {
    console.clear();
    title("16 — LIVE ROUND WATCH");"""

new = """  function renderLiveRound() {
    process.stdout.write("\\x1b[H");"""

if source.count(old) != 1:
    raise SystemExit("PATCH STOPPED: Live Round Watch render block not found exactly once.")

source = source.replace(old, new, 1)

old_end = """    console.log("[CONTROL] Press ENTER to stop watching and return.");
  }

  await refreshRoundUsdPrices(latestRound());"""

new_end = """    console.log("[CONTROL] Press ENTER to stop watching and return.");
    process.stdout.write("\\x1b[J");
  }

  await refreshRoundUsdPrices(latestRound());"""

if source.count(old_end) != 1:
    raise SystemExit("PATCH STOPPED: Live Round Watch render ending not found exactly once.")

source = source.replace(old_end, new_end, 1)
path.write_text(source)
print("[APPLIED] Live Round Watch now redraws in place without clearing the terminal.")
