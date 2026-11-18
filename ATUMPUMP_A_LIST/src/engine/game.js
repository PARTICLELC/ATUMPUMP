import {
  ingestObservations,
  rebuildDailyCandles,
  evaluateDominance
} from './scanner.js';

import { processNpc } from './trading.js';
import { settleChampionshipIfDue } from './championship.js';
import { recordEvent } from './audit.js';

export async function heartbeat(db, adapter, config, now = Date.now()) {
  const rows = await adapter.scan(db);

  const ingested = ingestObservations(db, rows, now);

  // Only today's candle data is refreshed during normal live operation.
  rebuildDailyCandles(db, now, false);

  const dominance = evaluateDominance(db, now);

  // Build a complete valuation map for every currently OPEN position.
  // Incremental Module 21 scans may not contain every held pair.
  const latestHeldPrices = db.prepare(`
    SELECT
      tr.mint,
      tr.pair_address,
      o.price,
      o.observed_at,
      o.source
    FROM (
      SELECT DISTINCT mint, pair_address
      FROM trades
      WHERE status = 'OPEN'
    ) tr
    JOIN observations o
      ON o.id = (
        SELECT o2.id
        FROM observations o2
        WHERE o2.mint = tr.mint
          AND o2.pair_address = tr.pair_address
        ORDER BY o2.observed_at DESC, o2.id DESC
        LIMIT 1
      )
  `).all();

  const prices = new Map();

  for (const r of latestHeldPrices) {
    prices.set(`${r.mint}|${r.pair_address}`, {
      price: Number(r.price),
      observed_at: Number(r.observed_at),
      source: r.source
    });
  }

  // New Module 21 observations override stored prices only when newer.
  for (const r of rows) {
    const key = `${r.mint}|${r.pair_address}`;
    const previous = prices.get(key);

    if (
      !previous ||
      Number(r.observed_at) >= Number(previous.observed_at || 0)
    ) {
      prices.set(key, r);
    }
  }

  // Every NPC evaluates its strategy on every heartbeat.
  for (let npc = 1; npc <= 10; npc++) {
    processNpc(db,npc,config,prices,now);
  }

  const championship = settleChampionshipIfDue(
    db,config,prices,now
  );

  db.prepare(`
    INSERT INTO service_state(key,value,updated_at)
    VALUES('last_heartbeat',?,?)
    ON CONFLICT(key) DO UPDATE SET
      value=excluded.value,
      updated_at=excluded.updated_at
  `).run(
    JSON.stringify({
      pairs: rows.length,
      ingested,
      dominance: dominance.length,
      npc_evaluations: 10
    }),
    now
  );

  if (dominance.length) {
    recordEvent(
      db,
      'SCAN_DOMINANCE_SUMMARY',
      {count:dominance.length},
      now
    );
  }

  return {
    pairs: rows.length,
    ingested,
    dominance,
    championship
  };
}
