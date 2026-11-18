import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=60000; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_profiles(
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, strategy TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolios(
      npc_id INTEGER PRIMARY KEY REFERENCES npc_profiles(id),
      starting_cash REAL NOT NULL, cash REAL NOT NULL, realized_pnl REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pairs(
      mint TEXT NOT NULL, pair_address TEXT NOT NULL, symbol TEXT, name TEXT,
      source TEXT, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
      PRIMARY KEY(mint,pair_address)
    );
    CREATE TABLE IF NOT EXISTS observations(
      id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, pair_address TEXT NOT NULL,
      price REAL NOT NULL, observed_at INTEGER NOT NULL, source TEXT NOT NULL,
      UNIQUE(mint,pair_address,observed_at,source)
    );
    CREATE INDEX IF NOT EXISTS obs_pair_time ON observations(mint,pair_address,observed_at);
    CREATE TABLE IF NOT EXISTS daily_candles(
      mint TEXT NOT NULL, pair_address TEXT NOT NULL, day_utc TEXT NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      samples INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(mint,pair_address,day_utc)
    );
    CREATE TABLE IF NOT EXISTS dominance(
      id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, pair_address TEXT NOT NULL,
      state TEXT NOT NULL, gate TEXT, candle_days TEXT NOT NULL,
      candle_data TEXT NOT NULL, activated_at INTEGER NOT NULL,
      UNIQUE(mint,pair_address,state,activated_at)
    );
    CREATE TABLE IF NOT EXISTS watched_pairs(
      npc_id INTEGER NOT NULL, mint TEXT NOT NULL, pair_address TEXT NOT NULL,
      state TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(npc_id,mint,pair_address)
    );
    CREATE TABLE IF NOT EXISTS signals(
      id INTEGER PRIMARY KEY AUTOINCREMENT, npc_id INTEGER NOT NULL,
      mint TEXT NOT NULL, pair_address TEXT NOT NULL, kind TEXT NOT NULL,
      reference_price REAL, created_at INTEGER NOT NULL, details TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trades(
      id INTEGER PRIMARY KEY AUTOINCREMENT, npc_id INTEGER NOT NULL,
      mint TEXT NOT NULL, pair_address TEXT NOT NULL, status TEXT NOT NULL,
      entry_price REAL NOT NULL, quantity REAL NOT NULL, entry_fee REAL NOT NULL,
      entry_at INTEGER NOT NULL, exit_price REAL, exit_fee REAL,
      exit_at INTEGER, realized_pnl REAL, exit_reason TEXT,
      source TEXT NOT NULL, source_observed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trades_open ON trades(npc_id,status);
    CREATE TABLE IF NOT EXISTS rounds(
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL, status TEXT NOT NULL, winner_npc_id INTEGER,
      finalized_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS round_results(
      round_id INTEGER NOT NULL, npc_id INTEGER NOT NULL, equity REAL NOT NULL,
      return_pct REAL NOT NULL, rank INTEGER NOT NULL,
      PRIMARY KEY(round_id,npc_id)
    );
    CREATE TABLE IF NOT EXISTS achievements(
      id INTEGER PRIMARY KEY AUTOINCREMENT, npc_id INTEGER NOT NULL,
      code TEXT NOT NULL, earned_at INTEGER NOT NULL, detail TEXT NOT NULL,
      UNIQUE(npc_id,code)
    );
    CREATE TABLE IF NOT EXISTS xp_ledger(
      id INTEGER PRIMARY KEY AUTOINCREMENT, npc_id INTEGER NOT NULL,
      amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pattern_history(
      id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, pair_address TEXT NOT NULL,
      pattern_json TEXT NOT NULL, outcome_json TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL,
      previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS service_state(
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function initializeGame(db, startingBalance) {
  const names = [
    ['NPC-01','Momentum Seeker'],['NPC-02','Clean Trend Analyst'],
    ['NPC-03','Golden Retracement'],['NPC-04','Candle Streak Hunter'],
    ['NPC-05','Pattern Archivist'],['NPC-06','Breakout Observer'],
    ['NPC-07','Conservative Trend'],['NPC-08','Acceleration Scout'],
    ['NPC-09','Structure Reader'],['NPC-10','Dominance Tracker']
  ];
  const insertNpc = db.prepare('INSERT OR IGNORE INTO npc_profiles(id,name,strategy,created_at) VALUES(?,?,?,?)');
  const insertPortfolio = db.prepare('INSERT OR IGNORE INTO portfolios(npc_id,starting_cash,cash,updated_at) VALUES(?,?,?,?)');
  const setUnifiedStrategy = db.prepare(
    'UPDATE npc_profiles SET strategy=? WHERE id=?'
  );
  const now = Date.now();
  for (let i=0;i<names.length;i++) {
    // insertNpc.run  // locked — do not reset profiles(i+1,names[i][0],names[i][1],now);
    setUnifiedStrategy.run('EXPLODE_DOMINANCE_GOLDEN_RETRACEMENT_REVERSAL', i+1);
    insertPortfolio.run(i+1,startingBalance,startingBalance,now);
  }
  const active = db.prepare("SELECT id FROM rounds WHERE status='active' ORDER BY id DESC LIMIT 1").get();
  if (!active) db.prepare("INSERT INTO rounds(started_at,ends_at,status) VALUES(?,?,'active')").run(now,now+72*3600000);
}
