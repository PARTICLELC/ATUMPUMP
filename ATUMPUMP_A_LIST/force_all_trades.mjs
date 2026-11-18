import { openDatabase } from './src/db.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const now = Date.now();

const rows = db.prepare(`
  SELECT o.mint, o.pair_address, o.price, o.observed_at, o.source
  FROM observations o
  JOIN (
    SELECT mint, pair_address, MAX(observed_at) t
    FROM observations
    GROUP BY mint, pair_address
  ) x ON x.mint = o.mint AND x.pair_address = o.pair_address AND x.t = o.observed_at
  WHERE o.price > 0
`).all();

const prices = new Map(rows.map(r => [r.mint + "|" + r.pair_address, r]));

const cfg = {
  feeBps: 50,
  slippageBps: 25,
  maxPositionPct: 15,
  maxOpenPositions: 8,
  holdMs: 9 * 86400000
};

const { processNpc } = await import('./src/engine/trading.js');

for (let npc = 1; npc <= 10; npc++) {
  processNpc(db, npc, cfg, prices, now);
}

console.log("=== ALL NPCS TRADED ===");
db.close();
