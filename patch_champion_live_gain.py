from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

old_sql = '''      ) AS market_cap
    FROM champion_holder ch
    LEFT JOIN tokens t ON t.mint = ch.mint'''

new_sql = '''      ) AS market_cap,
      (
        SELECT mpo.price_sol * COALESCE(
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
              AND po.observed_at <= mpo.observed_at
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          ),
          (
            SELECT po.sol_usd
            FROM price_observations po
            WHERE po.sol_usd > 0
            ORDER BY po.observed_at DESC, po.id DESC
            LIMIT 1
          )
        )
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
          AND mpo.observed_at >= ch.since_at
        ORDER BY mpo.observed_at ASC, mpo.id ASC
        LIMIT 1
      ) AS opening_price_usd,
      (
        SELECT COUNT(*)
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
          AND mpo.observed_at >= ch.since_at
      ) AS sample_count,
      (
        SELECT mpo.pair_address
        FROM market_pair_observations mpo
        WHERE mpo.mint = ch.mint
          AND mpo.price_sol > 0
          AND mpo.pair_address IS NOT NULL
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS pair_address
    FROM champion_holder ch
    LEFT JOIN tokens t ON t.mint = ch.mint'''

if old_sql not in s:
    raise SystemExit("PATCH STOPPED: Champion Holder SQL anchor not found.")

s = s.replace(old_sql, new_sql, 1)

old_display = '''    console.log(`MINT: ${row.mint}`);
    console.log(`SINCE: ${row.since_at}`);'''

new_display = '''    const opening = Number(row.opening_price_usd);
    const movement = price - opening;
    const gainPercent = opening > 0
      ? ((price - opening) / opening) * 100
      : NaN;

    console.log(`LIVE GAIN PERCENTAGE: ${
      Number.isFinite(gainPercent)
        ? (gainPercent >= 0 ? "+" : "") + gainPercent.toFixed(2) + "%"
        : "WAITING FOR OPENING PRICE"
    }`);
    console.log(`ROUND MOVEMENT: ${
      Number.isFinite(gainPercent)
        ? (gainPercent >= 0 ? "+" : "") + gainPercent.toFixed(2) + "%"
        : "WAITING FOR OPENING PRICE"
    }`);
    console.log(`USD MOVEMENT: ${
      Number.isFinite(movement)
        ? (movement >= 0 ? "+" : "-") + "$" + Math.abs(movement).toExponential(10)
        : "WAITING FOR PRICE DATA"
    }`);
    console.log(`OPEN USD: ${
      opening > 0 ? "$" + opening.toExponential(10) : "WAITING FOR OPENING PRICE"
    }`);
    console.log(`CURRENT USD: ${
      price > 0 ? "$" + price.toExponential(10) : "WAITING FOR PRICE DATA"
    }`);
    console.log(`SAMPLES: ${row.sample_count}`);
    console.log(`PAIR: ${row.pair_address || "PAIR NOT AVAILABLE"}`);
    console.log(`MINT: ${row.mint}`);
    console.log(`SINCE: ${row.since_at}`);'''

if old_display not in s:
    raise SystemExit("PATCH STOPPED: Champion Holder display anchor not found.")

s = s.replace(old_display, new_display, 1)
p.write_text(s)
print("[APPLIED] Champion Holder live gain, USD movement, opening/current USD, samples, and pair.")
