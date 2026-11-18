import { openDatabase } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { DatabaseSync } from "node:sqlite";
import { markToMarket } from "../src/engine/trading.js";
import { verifyAudit } from "../src/engine/audit.js";

const config = loadConfig();
const game = openDatabase(config.dbPath);

function clear() {
  process.stdout.write("\x1Bc");
}
const money = n => "$" + Number(n||0).toFixed(2);

async function tick() {

  console.log("ATUMPUMP FULL LIVE DASHBOARD  " + new Date().toISOString());
  console.log("=".repeat(70));

  let livePrices = new Map();
  try {
    if (process.env.ATUMPUMP_DB_PATH) {
      const src = new DatabaseSync(process.env.ATUMPUMP_DB_PATH, {readOnly:true});
      const rows = src.prepare("SELECT mint, pair_address, price_sol AS price, market_cap, observed_at FROM market_pair_observations WHERE price_sol > 0 ORDER BY observed_at DESC").all();
      const seen = new Set();
      const unique = [];
      for (const r of rows) {
        const k = r.mint+"|"+r.pair_address;
        if (!seen.has(k)) { seen.add(k); unique.push(r); }
      }
      rows.length = 0;
      rows.push(...unique);
      src.close();
      livePrices = new Map(rows.map(r => [r.mint+"|"+r.pair_address, r]));
    }
  } catch(e) {}

  const pairNames = new Map(game.prepare("SELECT mint,pair_address,symbol,name FROM pairs").all().map(r => [r.mint+"|"+r.pair_address, r]));
  const pairLabel = r => {
    const p = pairNames.get(r.mint+"|"+r.pair_address);
    if (!p) return r.mint.slice(0,12);
    return (p.symbol ? "$"+p.symbol : p.name || r.mint.slice(0,8));
  };

  const selected = 1;
  const npc = game.prepare("SELECT n.*,p.starting_cash,p.cash,p.realized_pnl FROM npc_profiles n JOIN portfolios p ON p.npc_id=n.id WHERE n.id=?").get(selected);
  const prices = livePrices;
  const portfolio = markToMarket(game, selected, prices);
  const round = game.prepare("SELECT * FROM rounds WHERE status='active' ORDER BY id DESC LIMIT 1").get();

  console.log("PROFILE " + selected + "/10  " + npc.name + " | " + npc.strategy);
  console.log("CASH " + money(portfolio.cash) + " | EQUITY " + money(portfolio.equity) + " | REALIZED " + money(portfolio.realized) + " | UNREALIZED " + money(portfolio.unrealized));
  console.log("ROUND " + (round?.id||"-") + " | ENDS " + (round ? new Date(round.ends_at).toISOString() : "-"));
  console.log("");

  const open = game.prepare("SELECT * FROM trades WHERE npc_id=? AND status='OPEN' ORDER BY entry_at DESC LIMIT 20").all(selected);
  console.log("OPEN TRADES");
  console.log("pair".padEnd(22)+"entry".padEnd(12)+"now".padEnd(12)+"gain".padEnd(10)+"mcap");
  for (const t of open) {
    const key = t.mint+"|"+t.pair_address;
    const live = prices.get(key);
    const current = live?.price || t.entry_price;
    const gain = (current - t.entry_price) * t.quantity - (t.entry_fee||0);
    console.log(
      pairLabel(t).padEnd(22) +
      Number(t.entry_price).toExponential(2).padEnd(12) +
      Number(current).toExponential(2).padEnd(12) +
      ((gain>=0?"+":"")+gain.toFixed(2)).padEnd(10) +
      (live?.market_cap ? "$"+Number(live.market_cap).toLocaleString() : "-")
    );
  }
  console.log("");

  const closed = game.prepare("SELECT * FROM trades WHERE npc_id=? AND status='CLOSED' ORDER BY exit_at DESC LIMIT 5").all(selected);
  console.log("RECENT CLOSED (" + closed.length + ")");
  for (const t of closed) console.log("  " + pairLabel(t) + "  pnl:" + money(t.realized_pnl));
  console.log("");

  const dominance = game.prepare("SELECT * FROM dominance ORDER BY activated_at DESC LIMIT 15").all();
  console.log("DOMINANCE RADAR");
  for (const d of dominance) {
    const live = prices.get(d.mint+"|"+d.pair_address);
    console.log("  " + pairLabel(d).padEnd(20) + d.state.padEnd(18) + (live?.market_cap ? "$"+Number(live.market_cap).toLocaleString() : "-"));
  }
  console.log("");

  const raw = game.prepare("SELECT n.id,n.name,p.starting_cash,p.cash,p.realized_pnl FROM npc_profiles n JOIN portfolios p ON p.npc_id=n.id").all();
  const board = raw.map(n => {
    const port = markToMarket(game, n.id, prices);
    return { name: n.name, growth: port.equity - n.starting_cash, equity: port.equity };
  }).sort((a,b) => b.growth - a.growth);
  console.log("LEADERBOARD");
  board.forEach((n,i) => console.log("  " + (i+1) + ". " + n.name.padEnd(10) + " growth:" + money(n.growth).padEnd(12) + " equity:" + money(n.equity)));

  const audit = verifyAudit(game);
  console.log("");
  console.log("AUDIT: " + (audit.valid?"VALID":"FAILED") + " | EVENTS " + audit.count);
  console.log("=".repeat(70));
}

console.log("FULL LIVE DASHBOARD STARTED");
setInterval(tick, 8000);
tick();
