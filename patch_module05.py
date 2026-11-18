from pathlib import Path

path = Path("src/control_center.mjs")
source = path.read_text()

source = source.replace(
'''  const cutoff = Date.now() - 360 * 60 * 1000;

  const stats = exists("champion_stats")''',
'''  const cutoff = Date.now() - 360 * 60 * 1000;

  const formatSol = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    return number.toFixed(18).replace(/\\.?0+$/, "");
  };

  const field = (label, value) =>
    console.log(`${C.white}${label.padEnd(25)}${C.reset}${value}`);

  const stats = exists("champion_stats")'''
)

source = source.replace(
'''  console.log(`${C.green}🏆 PERMANENT TROPHY HOLDERS${C.reset}`);

  if (!stats.length) {
    console.log("No trophy holders recorded.");
  }

  for (const row of stats) {
    console.log("--------------------------------------------");
    const identity = DB.prepare(`
      SELECT name, symbol FROM tokens WHERE mint=?
    `).get(row.mint);

    console.log(`EXACT TOKEN NAME: ${identity?.name ?? "NAME NOT REGISTERED"}`);
    console.log(`TOKEN TICKER: ${identity?.symbol ?? "SYMBOL NOT REGISTERED"}`);
    console.log(`FULL MINT ADDRESS: ${row.mint}`);
    console.log(`Trophies: ${row.trophy_count}`);
    console.log(`Consecutive wins: ${row.consecutive_wins}`);
    console.log(`Appearances: ${row.appearances}`);
    console.log(`Podium finishes: ${row.podium_finishes}`);
    console.log(`Best movement: ${row.best_movement_sol} SOL`);

    const timestamp = Number(row.last_championship_at);
    console.log(
      `Last championship: ${
        Number.isFinite(timestamp) && timestamp > 0
          ? new Date(timestamp).toLocaleString()
          : "N/A"
      }`
    );
  }

  console.log(`\\n${C.white}DIRECTION POWER — LAST 360 MINUTES${C.reset}`);''',
'''  console.log(`\\n${C.green}🏆 PERMANENT TROPHY HOLDERS${C.reset}`);
  console.log(`${C.white}LEGENDARY REGISTRY${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

  if (!stats.length) {
    console.log(`${C.white}No trophy holders recorded.${C.reset}`);
  }

  for (const row of stats) {
    const identity = DB.prepare(`
      SELECT name, symbol FROM tokens WHERE mint=?
    `).get(row.mint);

    console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
    console.log(`${C.white}${identity?.name ?? "NAME NOT REGISTERED"}${C.reset}  ${C.green}🏆 ${row.trophy_count} TROPHIES${C.reset}`);
    field("TOKEN TICKER", identity?.symbol ?? "SYMBOL NOT REGISTERED");
    field("FULL MINT ADDRESS", row.mint);
    field("CONSECUTIVE WINS", row.consecutive_wins);
    field("APPEARANCES", row.appearances);
    field("PODIUM FINISHES", row.podium_finishes);
    field("BEST MOVEMENT", `${formatSol(row.best_movement_sol)} SOL`);

    const timestamp = Number(row.last_championship_at);
    field(
      "LAST CHAMPIONSHIP",
      Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp).toLocaleString()
        : "N/A"
    );
  }
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

  console.log(`\\n${C.green}DIRECTION POWER — LAST 360 MINUTES${C.reset}`);
  console.log(`${C.white}12-ROUND DIRECTIONAL CONSISTENCY${C.reset}`);
  console.log(`${C.green}${"─".repeat(72)}${C.reset}`);'''
)

source = source.replace(
'''    console.log("--------------------------------------------");
    console.log(`${color}${item.status}${C.reset}`);
    const identity = DB.prepare(`
      SELECT name, symbol FROM tokens WHERE mint=?
    `).get(item.mint);

    console.log(`EXACT TOKEN NAME: ${identity?.name ?? item.name ?? "NAME NOT REGISTERED"}`);
    console.log(`TOKEN TICKER: ${identity?.symbol ?? item.symbol ?? "SYMBOL NOT REGISTERED"}`);
    console.log(`FULL MINT ADDRESS: ${item.mint}`);
    console.log(`Direction: ${item.direction}`);
    console.log(`Matching rounds: ${item.count}/12`);
    console.log(`Up rounds: ${item.up}`);
    console.log(`Down rounds: ${item.down}`);
    console.log(`Permanent trophies: ${
      DB.prepare(`
        SELECT trophy_count FROM champion_stats WHERE mint=?
      `).get(item.mint)?.trophy_count ?? 0
    }`);''',
'''    console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
    console.log(`${color}${item.status}${C.reset}`);
    const identity = DB.prepare(`
      SELECT name, symbol FROM tokens WHERE mint=?
    `).get(item.mint);

    console.log(`${C.white}${identity?.name ?? item.name ?? "NAME NOT REGISTERED"}${C.reset}`);
    field("TOKEN TICKER", identity?.symbol ?? item.symbol ?? "SYMBOL NOT REGISTERED");
    field("FULL MINT ADDRESS", item.mint);
    field("DIRECTION", `${C.green}${item.direction}${C.reset}`);
    field("MATCHING ROUNDS", `${item.count}/12`);
    field("UP ROUNDS", item.up);
    field("DOWN ROUNDS", item.down);
    field("PERMANENT TROPHIES", DB.prepare(`
      SELECT trophy_count FROM champion_stats WHERE mint=?
    `).get(item.mint)?.trophy_count ?? 0);'''
)

source = source.replace(
'''  console.log("--------------------------------------------");
  console.log("DIRECTION POWER DOES NOT MODIFY TROPHY TOTALS.");''',
'''  console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
  console.log(`${C.white}DIRECTION POWER DOES NOT MODIFY TROPHY TOTALS.${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);'''
)

source = source.replace(
'''    console.log("RECENT CHAMPIONSHIP WINNERS — FULL TOKEN IDENTITY");
    console.log("GAIN = ROUND CLOSING PRICE VS ROUND OPENING PRICE");
    console.log("------------------------------------------------------------");''',
'''    console.log(`\\n${C.green}CHAMPIONSHIP TROPHY EVENTS${C.reset}`);
    console.log(`${C.white}RECENT WINNERS — FULL TOKEN IDENTITY${C.reset}`);
    console.log(`${C.white}GAIN = ROUND CLOSING PRICE VS ROUND OPENING PRICE${C.reset}`);
    console.log(`${C.green}${"=".repeat(72)}${C.reset}`);'''
)

source = source.replace(
'''      console.log("------------------------------------------------------------");
      console.log(`EVENT ID: ${event.id}`);
      console.log(`ROUND: ${event.round_id}`);
      console.log(`EXACT TOKEN NAME: ${event.name ?? "NAME NOT REGISTERED"}`);
      console.log(`TOKEN TICKER: ${event.symbol ?? "SYMBOL NOT REGISTERED"}`);
      console.log(`FULL MINT ADDRESS: ${event.mint}`);
      console.log(`ROUND GAIN: ${gainText}`);
      console.log(`OPENING PRICE: ${event.opening_price_sol ?? "N/A"} SOL`);
      console.log(`CLOSING PRICE: ${event.closing_price_sol ?? "N/A"} SOL`);
      console.log(`MOVEMENT: ${event.movement_sol} SOL`);
      console.log(`TROPHIES AWARDED: +${event.trophy_increment}`);
      console.log(`PAIR ADDRESS: ${event.pair_address ?? "PAIR NOT REGISTERED"}`);
      console.log(`AWARDED AT: ${
        Number.isFinite(awardedAt) && awardedAt > 0
          ? new Date(awardedAt).toLocaleString()
          : "N/A"
      }`);''',
'''      console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
      console.log(`${C.green}EVENT ${event.id}  |  ROUND ${event.round_id}${C.reset}`);
      console.log(`${C.white}${event.name ?? "NAME NOT REGISTERED"}${C.reset}  ${C.green}${gainText}${C.reset}`);
      field("TOKEN TICKER", event.symbol ?? "SYMBOL NOT REGISTERED");
      field("FULL MINT ADDRESS", event.mint);
      field("OPENING PRICE", `${formatSol(event.opening_price_sol)} SOL`);
      field("CLOSING PRICE", `${formatSol(event.closing_price_sol)} SOL`);
      field("MOVEMENT", `${formatSol(event.movement_sol)} SOL`);
      field("TROPHIES AWARDED", `${C.green}+${event.trophy_increment}${C.reset}`);
      field("PAIR ADDRESS", event.pair_address ?? "PAIR NOT REGISTERED");
      field(
        "AWARDED AT",
        Number.isFinite(awardedAt) && awardedAt > 0
          ? new Date(awardedAt).toLocaleString()
          : "N/A"
      );'''
)

source = source.replace(
'''    console.log("------------------------------------------------------------");
  }
}

function archive()''',
'''    console.log(`${C.green}${"=".repeat(72)}${C.reset}`);
  }
}

function archive()'''
)

path.write_text(source)
print("[APPLIED] Module 05 trophy registry, Direction Power, and event-history display.")
