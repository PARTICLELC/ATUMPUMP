import { openDatabase } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { DatabaseSync } from "node:sqlite";

const config = loadConfig();
const game = openDatabase(config.dbPath);

function clear() {
  process.stdout.write("\x1Bc");
}

async function tick() {
  clear();
  console.log("ATUMPUMP LIVE SYNC  " + new Date().toISOString());
  console.log("-".repeat(70));

  let livePrices = new Map();
  try {
    if (process.env.ATUMPUMP_DB_PATH) {
      const src = new DatabaseSync(process.env.ATUMPUMP_DB_PATH, {readOnly:true});
      const rows = src.prepare("SELECT mint, pair_address, price_sol AS price, market_cap, observed_at FROM market_pair_observations WHERE price_sol > 0 GROUP BY mint, pair_address HAVING MAX(observed_at)").all();
      src.close();
      livePrices = new Map(rows.map(r => [r.mint+"|"+r.pair_address, r]));
    }
  } catch (e) {
    console.log("source read error:", e.message);
  }

  const open = game.prepare("SELECT t.*, p.symbol, p.name FROM trades t LEFT JOIN pairs p ON p.mint=t.mint AND p.pair_address=t.pair_address WHERE t.status='OPEN' ORDER BY t.entry_at DESC LIMIT 30").all();

  console.log("OPEN TRADES (live)");
  console.log("pair".padEnd(28) + "entry".padEnd(14) + "now".padEnd(14) + "gain".padEnd(12) + "mcap");
  console.log("-".repeat(70));

  for (const t of open) {
    const key = t.mint+"|"+t.pair_address;
    const live = livePrices.get(key);
    const current = live?.price || t.entry_price;
    const gain = (current - t.entry_price) * t.quantity - (t.entry_fee||0);
    const label = (t.symbol ? "$"+t.symbol : t.mint.slice(0,8)).padEnd(28);
    const entry = Number(t.entry_price).toExponential(3).padEnd(14);
    const nowp = Number(current).toExponential(3).padEnd(14);
    const g = ((gain>=0?"+":"")+gain.toFixed(2)).padEnd(12);
    const mcap = live?.market_cap ? "$"+Number(live.market_cap).toLocaleString() : "-";
    console.log(label + entry + nowp + g + mcap);
  }

  console.log("-".repeat(70));
  console.log("Ctrl+C to stop");
}

console.log("LIVE SYNC STARTED");
setInterval(tick, 4000);
tick();
