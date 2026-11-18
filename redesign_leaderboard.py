from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("function leaderboard() {")
end = s.index("\nfunction championHolder()", start)

new = r'''function leaderboard() {
  const reset = C.reset;
  const green = C.green;
  const white = C.white;
  const dim = C.dim;

  const line = "━".repeat(76);
  const thin = "─".repeat(76);

  const formatTokenUsd = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    return "$" + number.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 14
    });
  };

  const formatMarketUsd = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0
      ? "$" + number.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      : "WAITING FOR DATA";
  };

  console.log(`\n${green}${line}${reset}`);
  console.log(`${green}  02  /  LIVE USD MOVEMENT CHAMPIONSHIP${reset}`);
  console.log(`${green}${line}${reset}`);

  const end = Date.now();
  const start = end - 432000;
  const entries = rollingUsdMovers();

  console.log(`${white}  WINDOW START     ${new Date(start).toLocaleString()}`);
  console.log(`  WINDOW END       ${new Date(end).toLocaleString()}`);
  console.log(`  DURATION         432 SECONDS`);
  console.log(`  QUALIFIED PAIRS  ${entries.length}${reset}`);
  console.log("");
  console.log(`${green}  RANKING: HIGHEST PERCENTAGE MOVEMENT → LOWEST${reset}`);
  console.log(`${green}${thin}${reset}`);

  if (!entries.length) {
    console.log(`${white}  Waiting for two observations per pair and a round opening price.${reset}`);
    return;
  }

  const medals = ["🏆", "🥈", "🥉"];

  const marketDataQuery = DB.prepare(`
    SELECT
      (
        SELECT mpo.volume_h24
        FROM market_pair_observations mpo
        WHERE mpo.mint = ?
          AND mpo.pair_address = ?
          AND mpo.volume_h24 IS NOT NULL
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS volume_h24,
      (
        SELECT mpo.market_cap
        FROM market_pair_observations mpo
        WHERE mpo.mint = ?
          AND mpo.pair_address = ?
          AND mpo.market_cap IS NOT NULL
          AND mpo.market_cap > 0
        ORDER BY mpo.observed_at DESC, mpo.id DESC
        LIMIT 1
      ) AS market_cap
  `);

  for (const [index, entry] of entries.entries()) {
    const movement = Number(entry.movement_usd);
    const percent = Number(entry.movement_percent);
    const opening = Number(entry.opening_price_usd);
    const current = Number(entry.current_price_usd);

    const market = marketDataQuery.get(
      entry.mint,
      entry.pair_address,
      entry.mint,
      entry.pair_address
    );

    const gain = `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
    const movementText =
      `${movement >= 0 ? "+" : "-"}${formatTokenUsd(Math.abs(movement))}`;

    const rank = medals[index] || `#${String(index + 1).padStart(2, "0")}`;
    const identity = `${entry.name || "UNKNOWN"} (${entry.symbol || "UNKNOWN"})`;

    console.log("");
    console.log(`${green}  ${rank}  ${identity}${reset}`);
    console.log(`${green}  ROUND GAIN  ${gain}${reset}`);
    console.log(`${white}  PRICE       ${formatTokenUsd(current)}`);
    console.log(`  USD CHANGE  ${movementText}`);
    console.log(`  OPEN / NOW  ${formatTokenUsd(opening)}  →  ${formatTokenUsd(current)}`);
    console.log(`  MARKET CAP  ${formatMarketUsd(market.market_cap)}`);
    console.log(`  24H VOLUME  ${formatMarketUsd(market.volume_h24)}`);
    console.log(`  SAMPLES     ${entry.sample_count}`);
    console.log(`  MINT        ${entry.mint}`);
    console.log(`  PAIR        ${entry.pair_address}${reset}`);
    console.log(`${dim}${thin}${reset}`);
  }

  console.log(`${green}  END OF TOP ${entries.length} MOVERS${reset}`);
  console.log(`${white}  MEASUREMENT WINDOW: 432 SECONDS${reset}`);
  console.log(`${green}${line}${reset}`);
}
'''

s = s[:start] + new + s[end:]
p.write_text(s)
print("[APPLIED] Module 02 professional white/neon-green leaderboard.")
