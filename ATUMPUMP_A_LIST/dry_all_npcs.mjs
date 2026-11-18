import { openDatabase } from './src/db.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const now = Date.now();

// Grab up to 10 priced dominance pairs
const pairs = db.prepare(`
  SELECT d.mint, d.pair_address, o.price, o.observed_at, o.source
  FROM dominance d
  JOIN observations o ON o.mint = d.mint AND o.pair_address = d.pair_address
  WHERE o.price > 0
  GROUP BY d.mint, d.pair_address
  ORDER BY o.observed_at DESC
  LIMIT 10
`).all();

if (!pairs.length) {
  console.log("No priced pairs");
  process.exit(1);
}

const insert = db.prepare(`
  INSERT INTO trades(
    npc_id, mint, pair_address, status,
    entry_price, quantity, entry_fee, entry_at,
    source, source_observed_at
  ) VALUES(?,?,?,'OPEN',?,?,?,?,?,?)
`);

const updateCash = db.prepare(`
  UPDATE portfolios SET cash = cash - ?, updated_at = ? WHERE npc_id = ?
`);

let opened = 0;
for (let i = 0; i < Math.min(10, pairs.length); i++) {
  const npcId = i + 1;
  const p = pairs[i];
  const fill = p.price * 1.002;
  const budget = 400;
  const fee = budget * 0.005;
  const qty = (budget - fee) / fill;

  // Skip if this NPC already has an open trade on this pair
  const exists = db.prepare(`
    SELECT id FROM trades
    WHERE npc_id=? AND mint=? AND pair_address=? AND status='OPEN'
  `).get(npcId, p.mint, p.pair_address);
  if (exists) continue;

  insert.run(
    npcId, p.mint, p.pair_address,
    fill, qty, fee, now,
    p.source || 'DRY_RUN', p.observed_at
  );
  updateCash.run(budget, now, npcId);
  opened++;
  console.log(`NPC-${String(npcId).padStart(2,'0')} opened trade on ${p.mint.slice(0,8)}...`);
}

console.log(`\\n=== DRY RUN COMPLETE: ${opened} new open trades ===`);
db.close();
