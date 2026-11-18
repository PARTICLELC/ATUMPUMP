from pathlib import Path

file = Path("src/control_center.mjs")
source = file.read_text()

old_query = """      ) AS volume_h24
    FROM champion_holder ch"""

new_query = """      ) AS volume_h24,
      (
        SELECT mpo.market_cap
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.market_cap IS NOT NULL
          AND mpo.market_cap > 0
        ORDER BY mpo.observed_at DESC
        LIMIT 1
      ) AS market_cap
    FROM champion_holder ch"""

if old_query in source:
    source = source.replace(old_query, new_query, 1)
elif "AS market_cap" not in source:
    raise SystemExit("STOP: Champion Holder query insertion point not found.")

old_display = """    console.log(`MINT: ${row.mint}`);"""

new_display = """    const marketCap = Number(row.market_cap);
    console.log(`MARKET CAPITALIZATION: ${
      Number.isFinite(marketCap) && marketCap > 0
        ? "$" + marketCap.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }) + " USD"
        : "WAITING FOR MARKET CAP DATA"
    }`);
    console.log(`MINT: ${row.mint}`);"""

if old_display in source:
    source = source.replace(old_display, new_display, 1)
elif "MARKET CAPITALIZATION:" not in source:
    raise SystemExit("STOP: Champion Holder display insertion point not found.")

file.write_text(source)
print("[APPLIED] Champion Holder market capitalization.")
