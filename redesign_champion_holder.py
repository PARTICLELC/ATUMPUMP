from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index('  for (const row of rows) {', s.index('function championHolder()'))
end = s.index('\n  }\n}', start) + len('\n  }')

new = r'''  const usd = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "WAITING FOR DATA";
    return "$" + number.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 14
    }) + " USD";
  };

  const signedUsd = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "WAITING FOR DATA";
    return `${number >= 0 ? "+" : "-"}${usd(Math.abs(number))}`;
  };

  for (const row of rows) {
    const price = Number(row.price_usd);
    const opening = Number(row.opening_price_usd);
    const movement = price - opening;
    const gainPercent = opening > 0
      ? ((price - opening) / opening) * 100
      : NaN;

    const volume = Number(row.volume_h24);
    const marketCap = Number(row.market_cap);
    const gain = Number.isFinite(gainPercent)
      ? `${gainPercent >= 0 ? "+" : ""}${gainPercent.toFixed(2)}%`
      : "WAITING FOR OPENING PRICE";

    const line = "━".repeat(68);
    const thin = "─".repeat(68);

    console.log("");
    console.log(`${C.green}${line}${C.reset}`);
    console.log(`${C.green}  🏆  CURRENT CHAMPION${C.reset}`);
    console.log(`${C.green}${line}${C.reset}`);
    console.log(`${C.white}  TOKEN       ${row.token_name || "NAME NOT REGISTERED"}`);
    console.log(`  TICKER      ${row.token_symbol || "TICKER NOT REGISTERED"}${C.reset}`);
    console.log(`${C.green}  ROUND GAIN  ${gain}${C.reset}`);
    console.log(`${C.green}${thin}${C.reset}`);
    console.log(`${C.white}  CURRENT PRICE   ${usd(price)}`);
    console.log(`  OPENING PRICE   ${usd(opening)}`);
    console.log(`  USD MOVEMENT    ${signedUsd(movement)}`);
    console.log(`  24H VOLUME      ${usd(volume)}`);
    console.log(`  MARKET CAP      ${usd(marketCap)}`);
    console.log(`  ROUND           ${row.round_id}`);
    console.log(`  SAMPLES         ${row.sample_count}`);
    console.log(`  SINCE           ${row.since_at}`);
    console.log(`  PAIR            ${row.pair_address || "PAIR NOT AVAILABLE"}`);
    console.log(`  MINT            ${row.mint}${C.reset}`);
    console.log(`${C.green}${line}${C.reset}`);
  }'''

s = s[:start] + new + s[end:]
p.write_text(s)
print("[APPLIED] Module 03 champion profile now matches the white/neon-green professional theme.")
