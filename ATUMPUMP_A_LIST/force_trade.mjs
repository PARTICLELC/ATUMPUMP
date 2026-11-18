import { openDatabase } from './src/db.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const now = Date.now();

const pair = db.prepare(`
  SELECT d.mint, d.pair_address, o.price, o.observed_at, o.source
  FROM dominance d
  JOIN observations o ON o.mint = d.mint AND o.pair_address = d.pair_address
  WHERE o.price > 0
  ORDER BY o.observed_at DESC
  LIMIT 1
`).get();

if (!pair) {
  console.log('No priced dominance pair found');
  process.exit(1);
}

const npcId = 1;
const fill = pair.price * 1.0025;
const budget = 500;
const fee = budget * 0.005;
const quantity = (budget - fee) / fill;

const trade = db.prepare(`
  INSERT INTO trades(
    npc_id, mint, pair_address, status,
    entry_price, quantity, entry_fee, entry_at,
    source, source_observed_at
  ) VALUES(?,?,?,'OPEN',?,?,?,?,?,?)
`).run(
  npcId, pair.mint, pair.pair_address,
  fill, quantity, fee, now,
  pair.source || 'MANUAL_LIVE', pair.observed_at
);

db.prepare('UPDATE portfolios SET cash = cash - ?, updated_at = ? WHERE npc_id = ?')
  .run(budget, now, npcId);

console.log('LIVE TRADE OPENED');
console.log('NPC:', npcId);
console.log('Mint:', pair.mint);
console.log('Fill:', fill);
console.log('Qty:', quantity.toFixed(6));
console.log('Trade ID:', trade.lastInsertRowid);

db.close();
