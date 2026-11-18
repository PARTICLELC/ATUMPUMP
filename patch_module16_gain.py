from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

old = '''    console.log("\\n========== 🏆 POSITIVE MOVERS ==========");
    console.log("HIERARCHY: LARGEST ABSOLUTE USD MOVEMENT — LAST 432 SECONDS");
    console.log(`Pairs with movement: ${entries.length}`);
    console.log(
      "RANK  TOKEN          OPEN USD              CURRENT USD           MOVEMENT USD"
    );
    console.log("-".repeat(88));

    if (!entries.length) {
      console.log("No qualifying price movements recorded in the 432-second window.");
    }

    entries.forEach((entry, index) => {
      const symbol = String(entry.symbol ?? "UNKNOWN").slice(0, 13);
      const opening = "$" + Number(entry.opening_price_usd).toExponential(8);
      const current = "$" + Number(entry.current_price_usd).toExponential(8);
      const movement = "+$" + Number(entry.movement_usd).toExponential(8);
      const medal = index === 0 ? "🏆" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${String(index + 1).padStart(2, " ")} `;

      console.log(
        `${medal} ${symbol.padEnd(13)} ${opening.padEnd(20)} ${current.padEnd(20)} ${movement}`
      );
      console.log(`     MINT: ${entry.mint}`);
      console.log(`     PAIR: ${entry.pair_address ?? "N/A"}`);
    });
'''

new = '''    entries.sort((a, b) => {
      const aPercent = Number(a.opening_price_usd) > 0
        ? ((Number(a.current_price_usd) - Number(a.opening_price_usd)) / Number(a.opening_price_usd)) * 100
        : -Infinity;
      const bPercent = Number(b.opening_price_usd) > 0
        ? ((Number(b.current_price_usd) - Number(b.opening_price_usd)) / Number(b.opening_price_usd)) * 100
        : -Infinity;
      return bPercent - aPercent;
    });

    console.log("\\n========== 🏆 POSITIVE MOVERS ==========");
    console.log("HIERARCHY: HIGHEST ROUND GAIN PERCENTAGE → LOWEST");
    console.log(`Pairs with movement: ${entries.length}`);
    console.log("RANK  TOKEN          GAIN %       OPEN USD              CURRENT USD           MOVEMENT USD");
    console.log("-".repeat(112));

    if (!entries.length) {
      console.log("No qualifying price movements recorded in the 432-second window.");
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

      console.log(
        `${medal} ${symbol.padEnd(13)} ${gain.padEnd(11)} ${opening.padEnd(20)} ${current.padEnd(20)} ${movement}`
      );
      console.log(`     MINT: ${entry.mint}`);
      console.log(`     PAIR: ${entry.pair_address ?? "N/A"}`);
    });
'''

if old not in s:
    raise SystemExit("Module 16 display block did not match. No changes made.")

s = s.replace(old, new, 1)
p.write_text(s)
print("[APPLIED] Module 16: percentage-gain ranking and display.")
