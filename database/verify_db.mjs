import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";

const path = "data/atumpump.sqlite";

console.log("========== ATUMPUMP DATABASE INTEGRITY ==========");

if (!existsSync(path)) {
    throw new Error("Database file missing.");
}

console.log("[PASS] Database file exists.");
console.log("[SIZE]", statSync(path).size, "bytes");

let db = new DatabaseSync(path);

const integrity = db.prepare("PRAGMA integrity_check").get();
console.log("[INTEGRITY]", integrity.integrity_check);

const duration = db.prepare(`
    SELECT value
    FROM system_meta
    WHERE key = 'round_duration_seconds'
`).get();

console.log("[ROUND DURATION]", duration?.value, "seconds");

const holder = db.prepare(`
    SELECT id, mint, since_at, round_id
    FROM champion_holder
    WHERE id = 1
`).get();

console.log("[CHAMPION HOLDER RECORD]", JSON.stringify(holder));

const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
console.log("[FOREIGN KEY ERRORS]", foreignKeys.length);

db.close();

db = new DatabaseSync(path);

const persistedHolder = db.prepare(`
    SELECT id FROM champion_holder WHERE id = 1
`).get();

console.log(
    "[PERSISTENCE]",
    persistedHolder ? "PASS" : "FAIL"
);

const appTables = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
`).get();

console.log("[APPLICATION TABLES]", appTables.count);

if (
    integrity.integrity_check !== "ok" ||
    duration?.value !== "432" ||
    !persistedHolder ||
    foreignKeys.length !== 0
) {
    db.close();
    throw new Error("Database integrity verification failed.");
}

console.log("\n[PASS] DATABASE INTEGRITY VERIFIED.");
db.close();
