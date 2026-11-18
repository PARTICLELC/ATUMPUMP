from pathlib import Path

file = Path("src/control_center.mjs")
source = file.read_text()

source = source.replace(
    'import { startAllTimeVolumeCapture } from "./all_time_volume.mjs";\n',
    '',
    1
)

source = source.replace(
"""      (
        SELECT tav.volume_usd
        FROM token_all_time_volume tav
        WHERE tav.mint = ch.mint
      ) AS all_time_volume_usd""",
"""      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS volume_h24""",
1
)

source = source.replace(
"""    const volume = Number(row.all_time_volume_usd);
    console.log(`ALL-TIME TRADING VOLUME (USD): ${
      Number.isFinite(volume) && volume >= 0
        ? "$" + volume.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "COLLECTING SWAP DATA"
    }`);""",
"""    const volume = Number(row.volume_h24);
    console.log(`TOTAL 24H TRADING VOLUME: ${
      Number.isFinite(volume) && volume >= 0
        ? "$" + volume.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD"
        : "WAITING FOR VOLUME DATA"
    }`);""",
1
)

source = source.replace(
"""  startAllMarketServices();
  startAllTimeVolumeCapture();
  startChampionshipEngine();""",
"""  startAllMarketServices();
  startChampionshipEngine();""",
1
)

if "all_time_volume_usd" in source or "startAllTimeVolumeCapture" in source:
    raise SystemExit("RESTORE INCOMPLETE — no file written.")

file.write_text(source)
print("[RESTORED] Module 03 TOTAL 24H TRADING VOLUME.")
print("[RESTORED] Removed all-time collector from automatic startup.")
