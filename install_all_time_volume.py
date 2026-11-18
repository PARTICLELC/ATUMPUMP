from pathlib import Path

file = Path("src/control_center.mjs")
source = file.read_text()

if 'from "./all_time_volume.mjs"' not in source:
    source = source.replace(
        'import { refreshLegendaryPower } from "./legendary_power.mjs";',
        'import { refreshLegendaryPower } from "./legendary_power.mjs";\n'
        'import { startAllTimeVolumeCapture } from "./all_time_volume.mjs";',
        1
    )

old_query = """      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS volume_h24"""

new_query = """      (
        SELECT tav.volume_usd
        FROM token_all_time_volume tav
        WHERE tav.mint = ch.mint
      ) AS all_time_volume_usd"""

if old_query in source:
    source = source.replace(old_query, new_query, 1)
elif new_query not in source:
    raise SystemExit("STOP: Champion Holder volume query did not match.")

old_display = """    const volume = Number(row.volume_h24);
    console.log(`TOTAL 24H TRADING VOLUME: ${
      Number.isFinite(volume) && volume >= 0
        ? "$" + volume.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD"
        : "WAITING FOR VOLUME DATA"
    }`);"""

new_display = """    const volume = Number(row.all_time_volume_usd);
    console.log(`ALL-TIME TRADING VOLUME (USD): ${
      Number.isFinite(volume) && volume >= 0
        ? "$" + volume.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "COLLECTING SWAP DATA"
    }`);"""

if old_display in source:
    source = source.replace(old_display, new_display, 1)
elif new_display not in source:
    raise SystemExit("STOP: Champion Holder volume display did not match.")

startup_old = """  startAllMarketServices();
  startChampionshipEngine();"""
startup_new = """  startAllMarketServices();
  startAllTimeVolumeCapture();
  startChampionshipEngine();"""

if startup_old in source:
    source = source.replace(startup_old, startup_new, 1)
elif startup_new not in source:
    raise SystemExit("STOP: Automatic startup block did not match.")

file.write_text(source)
print("[APPLIED] All-time swap-volume collector wired into startup.")
print("[APPLIED] Module 03 now displays cumulative observed swap volume.")
