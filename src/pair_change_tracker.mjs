import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");

DB.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 15000;

  CREATE TABLE IF NOT EXISTS pair_change_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    event_type TEXT NOT NULL,
    previous_pair_address TEXT,
    new_pair_address TEXT,
    previous_eligible INTEGER,
    new_eligible INTEGER,
    event_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pair_identity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    pair_address TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    retired_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_pair_events_mint_time
    ON pair_change_events(mint, event_at);

  CREATE INDEX IF NOT EXISTS idx_pair_events_time
    ON pair_change_events(event_at);

  CREATE INDEX IF NOT EXISTS idx_pair_history_mint
    ON pair_identity_history(mint);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_pair_identity_active
    ON pair_identity_history(mint)
    WHERE active = 1;

  DROP TRIGGER IF EXISTS atumpump_pair_change_update;
  DROP TRIGGER IF EXISTS atumpump_pair_change_insert;
  DROP TRIGGER IF EXISTS atumpump_pair_eligibility_update;

  CREATE TRIGGER atumpump_pair_change_update
  AFTER UPDATE OF pair_address ON tokens
  WHEN OLD.pair_address IS NOT NEW.pair_address
  BEGIN
    INSERT INTO pair_change_events (
      mint, event_type, previous_pair_address,
      new_pair_address, previous_eligible,
      new_eligible, event_at
    )
    VALUES (
      NEW.mint,
      CASE
        WHEN OLD.pair_address IS NULL
          AND NEW.pair_address IS NOT NULL THEN 'PAIR_ASSIGNED'
        WHEN OLD.pair_address IS NOT NULL
          AND NEW.pair_address IS NULL THEN 'PAIR_REMOVED'
        ELSE 'PAIR_CHANGED'
      END,
      OLD.pair_address,
      NEW.pair_address,
      OLD.eligible,
      NEW.eligible,
      CAST(strftime('%s','now') AS INTEGER) * 1000
    );

    UPDATE pair_identity_history
    SET active = 0,
        retired_at = CAST(strftime('%s','now') AS INTEGER) * 1000
    WHERE mint = OLD.mint AND active = 1;

    INSERT INTO pair_identity_history (
      mint, pair_address, assigned_at, active
    )
    SELECT
      NEW.mint,
      NEW.pair_address,
      CAST(strftime('%s','now') AS INTEGER) * 1000,
      1
    WHERE NEW.pair_address IS NOT NULL;
  END;

  CREATE TRIGGER atumpump_pair_change_insert
  AFTER INSERT ON tokens
  WHEN NEW.pair_address IS NOT NULL
  BEGIN
    INSERT INTO pair_change_events (
      mint, event_type, previous_pair_address,
      new_pair_address, previous_eligible,
      new_eligible, event_at
    )
    VALUES (
      NEW.mint, 'PAIR_DISCOVERED', NULL,
      NEW.pair_address, NULL, NEW.eligible,
      CAST(strftime('%s','now') AS INTEGER) * 1000
    );

    INSERT INTO pair_identity_history (
      mint, pair_address, assigned_at, active
    )
    VALUES (
      NEW.mint, NEW.pair_address,
      CAST(strftime('%s','now') AS INTEGER) * 1000,
      1
    );
  END;

  CREATE TRIGGER atumpump_pair_eligibility_update
  AFTER UPDATE OF eligible ON tokens
  WHEN OLD.eligible IS NOT NEW.eligible
  BEGIN
    INSERT INTO pair_change_events (
      mint, event_type, previous_pair_address,
      new_pair_address, previous_eligible,
      new_eligible, event_at
    )
    VALUES (
      NEW.mint,
      CASE WHEN NEW.eligible = 1
        THEN 'PAIR_ACTIVATED'
        ELSE 'PAIR_DEACTIVATED'
      END,
      NEW.pair_address,
      NEW.pair_address,
      OLD.eligible,
      NEW.eligible,
      CAST(strftime('%s','now') AS INTEGER) * 1000
    );
  END;
`);

const seed = DB.prepare(`
  INSERT INTO pair_identity_history (
    mint, pair_address, assigned_at, active
  )
  SELECT
    t.mint,
    t.pair_address,
    COALESCE(t.last_seen_at, CAST(strftime('%s','now') AS INTEGER) * 1000),
    1
  FROM tokens t
  WHERE t.pair_address IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pair_identity_history h
      WHERE h.mint = t.mint AND h.active = 1
    )
`);

const seeded = seed.run();

const counts = DB.prepare(`
  SELECT
    (SELECT COUNT(*) FROM pair_identity_history) AS identities,
    (SELECT COUNT(*) FROM pair_identity_history WHERE active = 1) AS active,
    (SELECT COUNT(*) FROM pair_change_events) AS events
`).get();

console.log("========== ATUMPUMP PAIR CHANGE TRACKER ==========");
console.log("[ONLINE] Automatic pair-change triggers installed.");
console.log("[ONLINE] Pair identity history initialized.");
console.log(`[SEEDED] ${seeded.changes} existing pair identities`);
console.log(`[HISTORY] ${counts.identities} total identities`);
console.log(`[ACTIVE] ${counts.active} active identities`);
console.log(`[EVENTS] ${counts.events} recorded change events`);
console.log("[READY] Future pair changes will be recorded automatically.");

DB.close();
