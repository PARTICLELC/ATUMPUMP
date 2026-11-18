from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("function championHolder()")
end = s.index("\nfunction watchlist()", start)
section = s[start:end]

if "TOTAL 24H TRADING VOLUME" in section:
    print("[SKIP] Champion volume already installed.")
    raise SystemExit(0)

needle = """      ) AS price_usd
    FROM champion_holder ch"""

replacement = """      ) AS price_usd,
      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS volume_h24
    FROM champion_holder ch"""

if needle not in section:
    raise SystemExit("Price query insertion point not found. No changes made.")

section = section.replace(needle, replacement, 1)

needle = """    console.log(`MINT: ${row.mint}`);"""

replacement = """    const volume = Number(row.volume_h24);
    console.log(`TOTAL 24H TRADING VOLUME: ${
      Number.isFinite(volume) && volume >= 0
        ? "$" + volume.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD"
        : "WAITING FOR VOLUME DATA"
    }`);
    console.log(`MINT: ${row.mint}`);"""

if needle not in section:
    raise SystemExit("Champion display insertion point not found. No changes made.")

section = section.replace(needle, replacement, 1)
s = s[:start] + section + s[end:]
p.write_text(s)
print("[APPLIED] Champion Holder: current USD price + total 24-hour trading volume.")
