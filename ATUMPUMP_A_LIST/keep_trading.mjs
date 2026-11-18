import { openDatabase } from './src/db.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);

function cycle() {
  try {
    const now = Date.now();
    const pairs = db.prepare(`
      SELECT d.mint, d.pair_address, o.price, o.observed_at, o.source
      FROM dominance d
      JOIN observations o ON o.mint = d.mint AND o.pair_address = d.pair_address
      WHERE o.price > 0
      GROUP BY d.mint, d.pair_address
      ORDER BY RANDOM()
      LIMIT 20
    `).all();

    if (!pairs.length) {
      console.log(new Date().toISOString(), "no pairs");
      return;
    }

    let opened = 0;
    for (let npcId = 1; npcId <= 10; npcId++) {
      const openCount = db.prepare("SELECT COUNT(*) n FROM trades WHERE npc_id=? AND status='OPEN'").get(npcId).n;
      if (openCount >= 20) continue;

      const portfolio = db.prepare("SELECT cash FROM portfolios WHERE npc_id=?").get(npcId);
      if (!portfolio || portfolio.cash < 50) continue;

      const p = pairs[Math.floor(Math.random() * pairs.length)];
      const fill = p.price * 1.002;
      const budget = Math.min(120, portfolio.cash * 0.15);
      const fee = budget * 0.005;
      const qty = (budget - fee) / fill;
      if (!(qty > 0)) continue;

      const exists = db.prepare("SELECT id FROM trades WHERE npc_id=? AND mint=? AND pair_address=? AND status='OPEN'").get(npcId, p.mint, p.pair_address);
      if (exists) continue;

      db.prepare(`
        INSERT INTO trades(npc_id, mint, pair_address, status, entry_price, quantity, entry_fee, entry_at, source, source_observed_at)
        VALUES(?,?,?,'OPEN',?,?,?,?,?,?)
      `).run(npcId, p.mint, p.pair_address, fill, qty, fee, now, p.source || 'KEEP', p.observed_at);

      db.prepare("UPDATE portfolios SET cash = cash - ?, updated_at = ? WHERE npc_id = ?").run(budget, now, npcId);
      opened++;
    }
    console.log(new Date().toISOString(), `opened ${opened}`);
  } catch (e) {
    console.log(new Date().toISOString(), "ERROR:", e.message);
  }
}

console.log("KEEP TRADING STARTED");
setInterval(cycle, 5000);
cycle();
