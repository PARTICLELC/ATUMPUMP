from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("async function liveRoundWatch() {")
end = s.index("\nconst actions =", start)

replacement = r'''async function liveRoundWatch() {
  const cyan = C.cyan;
  const gold = C.gold;
  const green = C.green;
  const red = C.red;
  const reset = C.reset;

  function renderLiveRound() {
    const lines = [];
    const log = (...args) => lines.push(args.join(" "));

    const round = latestRound();

    log(`${cyan}============================================================`);
    log(" 16 — LIVE ROUND WATCH");
    log("============================================================" + reset);

    if (!round) {
      log(`${C.dim}No active championship round.${reset}`);
    } else {
      const remaining = Math.max(
        0,
        Math.ceil((Number(round.ends_at) - Date.now()) / 1000)
      );

      log(`${cyan}LOCAL TIME:${reset} ${new Date().toLocaleString()}`);
      log(`${cyan}ROUND:${reset} ${round.round_number}`);
      log(`${cyan}COUNTDOWN:${reset} ${Math.floor(remaining / 60)}m ${String(remaining % 60).padStart(2, "0")}s`);

      const entries = rollingUsdMovers();

      entries.sort((a, b) => {
        const ap = Number(a.opening_price_usd) > 0
          ? (Number(a.current_price_usd) / Number(a.opening_price_usd) - 1) * 100
          : -Infinity;
        const bp = Number(b.opening_price_usd) > 0
          ? (Number(b.current_price_usd) / Number(b.opening_price_usd) - 1) * 100
          : -Infinity;
        return bp - ap;
      });

      log("");
      log(`${gold}========== 🏆 POSITIVE MOVERS ==========${reset}`);
      log(`${cyan}HIERARCHY: HIGHEST ROUND GAIN PERCENTAGE → LOWEST${reset}`);
      log(`${cyan}Pairs with movement:${reset} ${entries.length}`);
      log(`${cyan}RANK  TOKEN          GAIN %       OPEN USD              CURRENT USD           MOVEMENT USD${reset}`);
      log(`${cyan}${"─".repeat(112)}${reset}`);

      if (!entries.length) {
        log(`${C.dim}No qualifying price movements recorded in the 432-second window.${reset}`);
      }

      entries.forEach((entry, index) => {
        const symbol = String(entry.symbol ?? "UNKNOWN").slice(0, 13);
        const openingValue = Number(entry.opening_price_usd);
        const currentValue = Number(entry.current_price_usd);
        const movementValue = currentValue - openingValue;
        const percent = openingValue > 0
          ? (movementValue / openingValue) * 100
          : 0;

        const gain = `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
        const opening = "$" + openingValue.toExponential(8);
        const current = "$" + currentValue.toExponential(8);
        const movement = `${movementValue >= 0 ? "+" : "-"}$${Math.abs(movementValue).toExponential(8)}`;
        const medal = index === 0 ? "🏆" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${String(index + 1).padStart(2, " ")} `;
        const gainColor = percent > 0 ? green : percent < 0 ? red : cyan;

        log(
          `${gold}${medal}${reset} ${cyan}${symbol.padEnd(13)}${reset} ${gainColor}${gain.padEnd(11)}${reset} ${opening.padEnd(20)} ${current.padEnd(20)} ${gainColor}${movement}${reset}`
        );
        log(`     ${cyan}MINT:${reset} ${entry.mint}`);
        log(`     ${cyan}PAIR:${reset} ${entry.pair_address ?? "N/A"}`);
      });
    }

    log("");
    log(`${green}[ONLINE]${reset} LIVE ROUND WATCH — refresh every 2 seconds.`);
    log(`${gold}[CONTROL]${reset} Press ENTER to stop watching and return.`);

    const frame = lines.join("\n");
    process.stdout.write("\x1b[H" + frame + "\n\x1b[J");
  }

  process.stdout.write("\x1b[2J\x1b[H");
  await refreshRoundUsdPrices(latestRound());
  renderLiveRound();

  const usdRefresh = setInterval(async () => {
    try {
      await refreshRoundUsdPrices(latestRound());
      renderLiveRound();
    } catch (error) {
      process.stderr.write(`\n[USD REFRESH ERROR] ${error.message}\n`);
    }
  }, 15000);

  const refresh = setInterval(() => {
    try {
      renderLiveRound();
    } catch (error) {
      process.stderr.write(`\n[LIVE WATCH ERROR] ${error.message}\n`);
    }
  }, 2000);

  try {
    await ask("");
  } finally {
    clearInterval(refresh);
    clearInterval(usdRefresh);
    process.stdout.write("\x1b[2J\x1b[H");
  }
}
'''

s = s[:start] + replacement + s[end:]
p.write_text(s)
print("[APPLIED] Restored cyan/gold professional Live Round Watch layout.")
