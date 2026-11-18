import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function createModule21Adapter(config) {
  if (!config.sourceDbPath) {
    throw new Error('ATUMPUMP_DB_PATH is required.');
  }

  if (!fs.existsSync(config.sourceDbPath)) {
    throw new Error(`ATUMPUMP database not found: ${config.sourceDbPath}`);
  }

  if (!fs.existsSync(config.sqlFile)) {
    throw new Error(`Module 21 SQL file not found: ${config.sqlFile}`);
  }

  const source = new DatabaseSync(config.sourceDbPath, { readOnly: true });
  source.exec('PRAGMA query_only=ON;');

  const sql = fs.readFileSync(config.sqlFile, 'utf8')
    .replace(/--.*$/gm, '')
    .trim();

  if (!sql || !/^\s*SELECT\b/i.test(sql)) {
    source.close();
    throw new Error('Module 21 SQL file must contain a SELECT query.');
  }

  const liveQuery = source.prepare(sql);

  const historyQuery = source.prepare(`
    SELECT
      o.mint,
      o.pair_address,
      o.price_sol AS price,
      o.observed_at,
      COALESCE(t.symbol, 'UNKNOWN') AS symbol,
      COALESCE(t.name, '') AS name
    FROM market_pair_observations o
    JOIN market_pairs mp
      ON mp.mint = o.mint
     AND mp.pair_address = o.pair_address
    LEFT JOIN tokens t ON t.mint = o.mint
    WHERE mp.active = 1
      AND o.price_sol > 0
    ORDER BY o.mint, o.pair_address, o.observed_at, o.id
  `);

  return {
    async scan(db) {
      const sinceRow = db.prepare(
        `SELECT COALESCE(MAX(observed_at),0) AS t FROM observations WHERE source='ATUMPUMP_MODULE_21'`
      ).get();
      const rows = liveQuery.all({ since: sinceRow.t, limit: config.scanLimit });

      return rows.map(r => ({
        mint: String(r.mint || ''),
        pair_address: String(r.pair_address || ''),
        symbol: String(r.symbol || 'UNKNOWN'),
        name: String(r.name || ''),
        price: Number(r.price),
        observed_at: Number(r.observed_at),
        source: String(r.source || 'ATUMPUMP_MODULE_21')
      })).filter(r =>
        r.mint &&
        r.pair_address &&
        r.price > 0 &&
        Number.isFinite(r.observed_at)
      );
    },

    backfill(db) {
      const state = db.prepare(`
        SELECT value FROM service_state
        WHERE key = 'module21_history_backfill_v1'
      `).get();

      if (state?.value === 'complete') {
        console.log('MODULE 21 HISTORY: already imported');
        return 0;
      }

      console.log('MODULE 21 HISTORY: importing source observations');

      const insertPair = db.prepare(`
        INSERT INTO pairs(
          mint,pair_address,symbol,name,source,first_seen_at,last_seen_at
        )
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(mint,pair_address) DO UPDATE SET
          symbol=excluded.symbol,
          name=excluded.name,
          first_seen_at=MIN(pairs.first_seen_at,excluded.first_seen_at),
          last_seen_at=MAX(pairs.last_seen_at,excluded.last_seen_at)
      `);

      const insertObservation = db.prepare(`
        INSERT OR IGNORE INTO observations(
          mint,pair_address,price,observed_at,source
        )
        VALUES(?,?,?,?,?)
      `);

      let scanned = 0;
      let inserted = 0;

      db.exec('BEGIN');

      try {
        for (const r of historyQuery.iterate()) {
          const mint = String(r.mint || '');
          const pair = String(r.pair_address || '');
          const price = Number(r.price);
          const observedAt = Number(r.observed_at);

          if (
            !mint ||
            !pair ||
            !(price > 0) ||
            !Number.isFinite(observedAt)
          ) continue;

          insertPair.run(
            mint,
            pair,
            String(r.symbol || 'UNKNOWN'),
            String(r.name || ''),
            'ATUMPUMP_MODULE_21_HISTORY',
            observedAt,
            observedAt
          );

          const result = insertObservation.run(
            mint,
            pair,
            price,
            observedAt,
            'ATUMPUMP_MODULE_21_HISTORY'
          );

          scanned++;
          inserted += Number(result.changes || 0);

          if (scanned % 50000 === 0) {
            console.log(
              `HISTORY IMPORT: scanned=${scanned} inserted=${inserted}`
            );
          }
        }

        db.prepare(`
          INSERT INTO service_state(key,value,updated_at)
          VALUES('module21_history_backfill_v1','complete',?)
          ON CONFLICT(key) DO UPDATE SET
            value='complete',
            updated_at=excluded.updated_at
        `).run(Date.now());

        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      console.log(
        `HISTORY IMPORT COMPLETE: scanned=${scanned} inserted=${inserted}`
      );

      return inserted;
    },

    close() {
      source.close();
    }
  };
}
