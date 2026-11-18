import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });

const db = new DatabaseSync("data/atumpump.sqlite");

db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS system_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    discovery_source TEXT,
    pair_address TEXT,
    quote_mint TEXT,
    eligible INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_number INTEGER NOT NULL UNIQUE,
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    completed_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    winner_mint TEXT,
    winner_movement_sol REAL
);

CREATE TABLE IF NOT EXISTS price_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    price_sol REAL NOT NULL,
    source TEXT NOT NULL,
    pair_address TEXT,
    FOREIGN KEY (mint) REFERENCES tokens(mint)
);

CREATE INDEX IF NOT EXISTS idx_observations_mint_time
ON price_observations(mint, observed_at);

CREATE INDEX IF NOT EXISTS idx_observations_time
ON price_observations(observed_at);

CREATE TABLE IF NOT EXISTS round_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    mint TEXT NOT NULL,
    opening_price_sol REAL,
    opening_at INTEGER,
    closing_price_sol REAL,
    closing_at INTEGER,
    movement_sol REAL,
    qualified INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (round_id) REFERENCES rounds(id),
    FOREIGN KEY (mint) REFERENCES tokens(mint),
    UNIQUE(round_id, mint)
);

CREATE INDEX IF NOT EXISTS idx_round_entries_ranking
ON round_entries(round_id, qualified, movement_sol DESC);

CREATE TABLE IF NOT EXISTS round_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    mint TEXT NOT NULL,
    rank INTEGER NOT NULL,
    opening_price_sol REAL,
    closing_price_sol REAL,
    movement_sol REAL NOT NULL,
    recorded_at INTEGER NOT NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id),
    FOREIGN KEY (mint) REFERENCES tokens(mint),
    UNIQUE(round_id, mint),
    UNIQUE(round_id, rank)
);

CREATE TABLE IF NOT EXISTS championship_watchlist (
    mint TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL,
    reason TEXT NOT NULL,
    FOREIGN KEY (mint) REFERENCES tokens(mint)
);

CREATE TABLE IF NOT EXISTS champion_stats (
    mint TEXT PRIMARY KEY,
    trophy_count INTEGER NOT NULL DEFAULT 0,
    consecutive_wins INTEGER NOT NULL DEFAULT 0,
    appearances INTEGER NOT NULL DEFAULT 0,
    podium_finishes INTEGER NOT NULL DEFAULT 0,
    best_movement_sol REAL NOT NULL DEFAULT 0,
    last_championship_at INTEGER,
    FOREIGN KEY (mint) REFERENCES tokens(mint)
);

CREATE TABLE IF NOT EXISTS champion_holder (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mint TEXT,
    since_at INTEGER,
    round_id INTEGER,
    FOREIGN KEY (mint) REFERENCES tokens(mint),
    FOREIGN KEY (round_id) REFERENCES rounds(id)
);

CREATE TABLE IF NOT EXISTS championship_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    mint TEXT NOT NULL,
    awarded_at INTEGER NOT NULL,
    trophy_increment INTEGER NOT NULL DEFAULT 1,
    movement_sol REAL NOT NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id),
    FOREIGN KEY (mint) REFERENCES tokens(mint),
    UNIQUE(round_id)
);

INSERT OR IGNORE INTO system_meta (key, value)
VALUES
    ('system_name', 'ATUMPUMP'),
    ('round_duration_seconds', '432'),
    ('scoring_metric', 'absolute_sol_per_token_movement'),
    ('championship_mode', 'infinite');

INSERT OR IGNORE INTO champion_holder (id, mint, since_at, round_id)
VALUES (1, NULL, NULL, NULL);
`);

const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
`).all();

console.log("========== ATUMPUMP DATABASE ==========");
console.log("Database: data/atumpump.sqlite");
console.log("SQLite tables:", tables.length);

for (const table of tables) {
    console.log("[READY]", table.name);
}

console.log("\n[PASS] Championship database initialized.");
console.log("[PASS] Round duration: 432 seconds.");
console.log("[PASS] Permanent trophy and champion history tables created.");
console.log("[PASS] No sample tokens or fake championship results inserted.");

db.close();
