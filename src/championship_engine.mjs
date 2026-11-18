import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const DB = new DatabaseSync("data/atumpump.sqlite");
const ROUND_MS = 432000;
const LOOP_MS = 1000;
const DISPLAY_MS = 15000;
const BATCH_SIZE = 30;
const CAPTURE_MS = 31000;

DB.exec("PRAGMA foreign_keys = ON");
DB.exec("PRAGMA busy_timeout = 5000");
DB.exec("PRAGMA journal_mode = WAL");
DB.exec("PRAGMA synchronous = NORMAL");

const resultColumns = DB.prepare("PRAGMA table_info(round_results)").all();
if (!resultColumns.some(column => column.name === "pair_address")) {
  DB.exec("ALTER TABLE round_results ADD COLUMN pair_address TEXT");
}

const roundColumns = DB.prepare("PRAGMA table_info(rounds)").all();
if (!roundColumns.some(column => column.name === "previous_audit_hash")) {
  DB.exec("ALTER TABLE rounds ADD COLUMN previous_audit_hash TEXT");
}
if (!roundColumns.some(column => column.name === "audit_hash")) {
  DB.exec("ALTER TABLE rounds ADD COLUMN audit_hash TEXT");
}
if (!roundColumns.some(column => column.name === "audit_payload")) {
  DB.exec("ALTER TABLE rounds ADD COLUMN audit_payload TEXT");
}


const sql = {
  active: DB.prepare(`
    SELECT * FROM rounds
    WHERE status = 'active'
    ORDER BY id DESC LIMIT 1
  `),

  nextNumber: DB.prepare(`
    SELECT COALESCE(MAX(round_number), 0) + 1 AS n
    FROM rounds
  `),

  eligibleCount: DB.prepare(`
    SELECT COUNT(*) AS n FROM tokens WHERE eligible = 1
  `),

  candidates: DB.prepare(`
    SELECT
      t.mint,
      p.observed_at,
      p.price_sol,
      COALESCE(
        (
          SELECT baseline.price_sol
          FROM price_observations baseline
          WHERE baseline.mint = t.mint
            AND baseline.observed_at <= ?
            AND baseline.observed_at >= ?
            AND baseline.price_sol > 0
          ORDER BY baseline.observed_at DESC, baseline.id DESC
          LIMIT 1
        ),
        (
          SELECT baseline.price_sol
          FROM price_observations baseline
          WHERE baseline.mint = t.mint
            AND baseline.observed_at >= ?
            AND baseline.observed_at < p.observed_at
            AND baseline.price_sol > 0
          ORDER BY baseline.observed_at ASC, baseline.id ASC
          LIMIT 1
        )
      ) AS baseline_price_sol
    FROM tokens t
    JOIN price_observations p ON p.id = (
      SELECT p2.id
      FROM price_observations p2
      WHERE p2.mint = t.mint
        AND p2.observed_at <= ?
        AND p2.observed_at >= ?
        AND p2.price_sol > 0
      ORDER BY p2.observed_at DESC, p2.id DESC
      LIMIT 1
    )
    WHERE t.eligible = 1
      AND p.price_sol > 0
    ORDER BY t.mint
  `),

  insertRound: DB.prepare(`
    INSERT INTO rounds (round_number, started_at, ends_at, status)
    VALUES (?, ?, ?, 'active')
  `),

  insertEntry: DB.prepare(`
    INSERT OR IGNORE INTO round_entries
      (round_id, mint, opening_price_sol, opening_at, qualified)
    VALUES (?, ?, ?, ?, ?)
  `),

  entries: DB.prepare(`
    SELECT re.*, t.symbol, t.name, t.pair_address
    FROM round_entries re
    JOIN tokens t ON t.mint = re.mint
    WHERE re.round_id = ?
  `),

  latest: DB.prepare(`
    SELECT observed_at, price_sol
    FROM price_observations
    WHERE mint = ?
      AND observed_at > ?
      AND observed_at <= ?
    ORDER BY observed_at DESC, id DESC
    LIMIT 1
  `),

  updateEntry: DB.prepare(`
    UPDATE round_entries
    SET closing_price_sol = ?,
        closing_at = ?,
        movement_sol = ?,
        qualified = 1
    WHERE id = ?
  `),

  invalidateEntry: DB.prepare(`
    UPDATE round_entries
    SET closing_price_sol = NULL,
        closing_at = NULL,
        movement_sol = NULL,
        qualified = 0
    WHERE id = ?
  `),

  qualified: DB.prepare(`
    SELECT mint, movement_sol
    FROM round_entries
    WHERE round_id = ? AND qualified = 1
  `),

  ranking: DB.prepare(`
    SELECT re.mint, t.symbol, t.pair_address,
           re.opening_price_sol,
           re.closing_price_sol,
           re.movement_sol
    FROM round_entries re
    JOIN tokens t ON t.mint = re.mint
    WHERE re.round_id = ?
      AND re.qualified = 1
      AND re.movement_sol > 0
    ORDER BY re.movement_sol DESC, re.mint ASC
  `),

  stats: DB.prepare(`
    INSERT INTO champion_stats
      (mint, appearances, podium_finishes, best_movement_sol)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET
      appearances = champion_stats.appearances + 1,
      podium_finishes =
        champion_stats.podium_finishes + excluded.podium_finishes,
      best_movement_sol =
        MAX(champion_stats.best_movement_sol, excluded.best_movement_sol)
  `),

  holder: DB.prepare(`
    SELECT mint FROM champion_holder WHERE id = 1
  `),

  resetStreaks: DB.prepare(`
    UPDATE champion_stats SET consecutive_wins = 0
    WHERE mint <> ?
  `),

  resetAllStreaks: DB.prepare(`
    UPDATE champion_stats SET consecutive_wins = 0
  `),

  streak: DB.prepare(`
    SELECT consecutive_wins
    FROM champion_stats WHERE mint = ?
  `),

  award: DB.prepare(`
    UPDATE champion_stats
    SET trophy_count = trophy_count + 1,
        consecutive_wins = ?,
        last_championship_at = ?
    WHERE mint = ?
  `),

  setHolder: DB.prepare(`
    UPDATE champion_holder
    SET mint = ?, since_at = ?, round_id = ?
    WHERE id = 1
  `),

  watchlist: DB.prepare(`
    INSERT INTO championship_watchlist (mint, added_at, reason)
    VALUES (?, ?, 'round_champion')
    ON CONFLICT(mint) DO NOTHING
  `),

  event: DB.prepare(`
    INSERT INTO championship_events
      (round_id, mint, awarded_at, trophy_increment, movement_sol)
    VALUES (?, ?, ?, 1, ?)
  `),

  result: DB.prepare(`
      INSERT INTO round_results
      (round_id, mint, rank, opening_price_sol,
       closing_price_sol, movement_sol, recorded_at, pair_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  complete: DB.prepare(`
    UPDATE rounds
    SET completed_at = ?,
        status = 'completed',
        winner_mint = ?,
        winner_movement_sol = ?
    WHERE id = ? AND status = 'active'
  `),

  previousAudit: DB.prepare(`
    SELECT audit_hash
    FROM rounds
    WHERE status = 'completed' AND audit_hash IS NOT NULL
    ORDER BY round_number DESC
    LIMIT 1
  `),

  saveAudit: DB.prepare(`
    UPDATE rounds
    SET previous_audit_hash = ?,
        audit_payload = ?,
        audit_hash = ?
    WHERE id = ?
  `)
};

let stopping = false;
let lastDisplay = 0;

function transaction(fn) {
  DB.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    DB.exec("COMMIT");
    return value;
  } catch (error) {
    DB.exec("ROLLBACK");
    throw error;
  }
}

function freshnessWindow() {
  const count = sql.eligibleCount.get().n;
  const rotation = Math.ceil(Math.max(1, count) / BATCH_SIZE) * CAPTURE_MS;
  return Math.min(ROUND_MS, Math.max(120000, rotation + 15000));
}

function startRound(now) {
  const freshness = freshnessWindow();
  const candidates = sql.candidates.all(
    now - ROUND_MS,
    now - 3600000,
    now - 3600000,
    now,
    now - freshness
  );

  if (!candidates.length) {
    console.log(
      "[ROUND WAIT] No fresh eligible token observations available."
    );
    return;
  }

  transaction(() => {
    const number = sql.nextNumber.get().n;
    const inserted = sql.insertRound.run(number, now, now + ROUND_MS);
    const id = Number(inserted.lastInsertRowid);

    for (const token of candidates) {
      const baseline = Number(token.baseline_price_sol);
      const current = Number(token.price_sol);
      const qualified =
        baseline > 0 &&
        current > 0 &&
        ((current / baseline) - 1) * 100 >= 13
          ? 1
          : 0;

      sql.insertEntry.run(
        id,
        token.mint,
        token.price_sol,
        token.observed_at,
        qualified
      );
    }

    console.log("\n========== CHAMPIONSHIP ROUND STARTED ==========");
    console.log("Round:", number);
    console.log("Round ID:", id);
    console.log("Opening:", new Date(now).toISOString());
    console.log("Closing:", new Date(now + ROUND_MS).toISOString());
    console.log("Duration: 432 seconds");
    console.log("Fresh eligible round entries:", candidates.length);
    console.log("LEADERBOARD QUALIFICATION: +13.00% PERSONAL PIP GAIN | 60-MINUTE BASELINE");
    console.log("Freshness window:", Math.round(freshness / 1000), "seconds");
    console.log("=================================================\n");
  });
}

function showLeaderboard(round) {
  const now = Date.now();
  const freshness = freshnessWindow();

  const rows = DB.prepare(`
    SELECT
      t.mint,
      COALESCE(t.symbol, t.name, 'UNKNOWN') AS symbol,
      t.pair_address,
      current_price.price_sol AS current_price,
      current_price.observed_at AS current_at,
      baseline.price_sol AS baseline_price,
      baseline.observed_at AS baseline_at
    FROM tokens t
    JOIN price_observations current_price
      ON current_price.id = (
        SELECT p.id
        FROM price_observations p
        WHERE p.mint = t.mint
          AND p.price_sol > 0
          AND p.observed_at <= ?
          AND p.observed_at >= ?
        ORDER BY p.observed_at DESC, p.id DESC
        LIMIT 1
      )
    JOIN price_observations baseline
      ON baseline.id = (
        SELECT b.id
        FROM price_observations b
        WHERE b.mint = t.mint
          AND b.price_sol > 0
          AND b.observed_at <= current_price.observed_at - 3600000
          AND b.observed_at >= current_price.observed_at - 7200000
        ORDER BY b.observed_at DESC, b.id DESC
        LIMIT 1
      )
    WHERE t.eligible = 1
    ORDER BY t.mint
  `).all(
    now,
    now - freshness
  );

  const board = rows.map(item => ({
    ...item,
    gainPct: ((item.current_price / item.baseline_price) - 1) * 100
  })).filter(item => item.gainPct >= 13)
    .sort((a, b) => b.gainPct - a.gainPct || a.mint.localeCompare(b.mint));

  console.log(
    `\n[PERSONAL PIP LEADERBOARD] ROUND ${round.round_number}`
  );
  console.log("RULE: +13% OR HIGHER | PERSONAL 60-MINUTE BASELINE");
  console.log(`ELIGIBLE TOKENS SCANNED: ${rows.length}`);
  console.log(`QUALIFIED TOKENS: ${board.length}`);
  console.log("RANK  TOKEN                 PERSONAL PIP GAIN");
  console.log("------------------------------------------------");

  for (const [index, item] of board.entries()) {
    console.log(
      `${String(index + 1).padEnd(5)} ` +
      `${item.symbol.slice(0, 20).padEnd(20)} ` +
      `+${item.gainPct.toFixed(2)}%`
    );
    console.log(`      MINT: ${item.mint}`);
    console.log(`      PAIR: ${item.pair_address ?? "NOT REGISTERED"}`);
  }

  if (!board.length) {
    console.log("No tokens currently meet the +13% personal pip threshold.");
  }
}
function finishRound(round, now) {
  const freshness = freshnessWindow();

  transaction(() => {
    for (const entry of sql.entries.all(round.id)) {
      const closing = sql.latest.get(
        entry.mint,
        round.started_at,
        round.ends_at
      );

      if (
        !closing ||
        closing.observed_at <= entry.opening_at ||
        closing.observed_at < round.ends_at - freshness
      ) {
        sql.invalidateEntry.run(entry.id);
        continue;
      }

      const movement =
        closing.price_sol - entry.opening_price_sol;

      sql.updateEntry.run(
        closing.price_sol,
        closing.observed_at,
        movement,
        entry.id
      );
    }

    const qualified = sql.qualified.all(round.id);
    const ranked = sql.ranking.all(round.id);
    const previousHolder = sql.holder.get()?.mint ?? null;

    for (const item of qualified) {
      const rank = ranked.findIndex(row => row.mint === item.mint) + 1;
      const podium = rank >= 1 && rank <= 3 ? 1 : 0;

      sql.stats.run(item.mint, podium, item.movement_sol);
    }

    ranked.forEach((item, index) => {
      sql.result.run(
        round.id,
        item.mint,
        index + 1,
        item.opening_price_sol,
        item.closing_price_sol,
        item.movement_sol,
        now,
        item.pair_address ?? null
      );
    });

    const winner = ranked[0] ?? null;

    // Canonical round record: stable field names, sorted token lists.
    // SHA-256 hash chain links this record to the previous completed round.
    const previousHash = sql.previousAudit.get()?.audit_hash ?? "ATUMPUMP-GENESIS";

    const auditPayload = JSON.stringify({
      system: "ATUMPUMP",
      standard: "SHA-256",
      round_number: round.round_number,
      round_id: round.id,
      started_at: round.started_at,
      ends_at: round.ends_at,
      completed_at: now,
      scoring: "closing_sol_minus_opening_sol",
      qualified: [...qualified]
        .sort((a, b) => a.mint.localeCompare(b.mint))
        .map(item => ({
          mint: item.mint,
          movement_sol: item.movement_sol,
          pair_address: DB.prepare(
            "SELECT pair_address FROM tokens WHERE mint = ?"
          ).get(item.mint)?.pair_address ?? null
        })),
      rankings: ranked.map((item, index) => ({
        rank: index + 1,
        mint: item.mint,
        pair_address: item.pair_address ?? null,
        opening_price_sol: item.opening_price_sol,
        closing_price_sol: item.closing_price_sol,
        movement_sol: item.movement_sol
      })),
      winner: winner ? {
        mint: winner.mint,
        movement_sol: winner.movement_sol
      } : null
    });

    const auditHash = createHash("sha256")
      .update(previousHash + "\n" + auditPayload, "utf8")
      .digest("hex");

    sql.saveAudit.run(previousHash, auditPayload, auditHash, round.id);

    if (winner) {
      sql.resetStreaks.run(winner.mint);

      const oldStreak =
        previousHolder === winner.mint
          ? (sql.streak.get(winner.mint)?.consecutive_wins ?? 0)
          : 0;

      sql.award.run(oldStreak + 1, now, winner.mint);
      sql.setHolder.run(winner.mint, now, round.id);

      const winnerGainPercent =
        winner.opening_price_sol > 0 && winner.closing_price_sol > 0
          ? ((winner.closing_price_sol / winner.opening_price_sol) - 1) * 100
          : null;

      if (
        winnerGainPercent !== null &&
        Number.isFinite(winnerGainPercent) &&
        winnerGainPercent >= 80
      ) {
        sql.watchlist.run(winner.mint, now);
        console.log(
          "[WATCHLIST ADDED] Champion gain:",
          winnerGainPercent.toFixed(2) + "%"
        );
      } else {
        console.log(
          "[WATCHLIST SKIPPED] Champion gain:",
          winnerGainPercent === null
            ? "UNAVAILABLE"
            : winnerGainPercent.toFixed(2) + "%",
          "| Required: +80.00%"
        );
      }

      sql.event.run(round.id, winner.mint, now, winner.movement_sol);
    } else {
      sql.resetAllStreaks.run();
    }

    sql.complete.run(
      now,
      winner?.mint ?? null,
      winner?.movement_sol ?? null,
      round.id
    );

    console.log("\n========== ROUND COMPLETED ==========");
    console.log("Round:", round.round_number);
    console.log("Qualified tokens:", qualified.length);
    console.log("Positive ranked results:", ranked.length);
    console.log("AUDIT STANDARD: SHA-256");
    console.log("PREVIOUS HASH:", previousHash);
    console.log("ROUND HASH:", auditHash);

    if (winner) {
      console.log("CHAMPION:", winner.symbol);
      console.log("MINT:", winner.mint);
      console.log("OPENING SOL:", winner.opening_price_sol);
      console.log("CLOSING SOL:", winner.closing_price_sol);
      console.log("WINNING MOVEMENT:", `+${winner.movement_sol} SOL`);
    } else {
      console.log("CHAMPION: No positive qualified movement.");
    }

    console.log("=====================================\n");
  });
}

async function main() {
  console.log("========== ATUMPUMP CHAMPIONSHIP ENGINE ==========");
  console.log("Duration: 432 seconds");
  console.log("Scoring: closing SOL - opening SOL");
  console.log("Mode: INFINITE ROUNDS");
  console.log("Market capture must run in another Termux session.");
  console.log("==================================================");

  while (!stopping) {
    try {
      const round = sql.active.get();

      if (!round) {
        startRound(Date.now());
      } else if (Date.now() >= round.ends_at) {
        finishRound(round, Date.now());
      } else if (Date.now() - lastDisplay >= DISPLAY_MS) {
        showLeaderboard(round);
        lastDisplay = Date.now();
      }
    } catch (error) {
      console.error("[ENGINE ERROR]", error.stack ?? error.message);
    }

    await new Promise(resolve => setTimeout(resolve, LOOP_MS));
  }
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\n[SHUTDOWN] Active round remains saved for restart recovery.");
  DB.close();
  console.log("[OFFLINE] Championship engine stopped.");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await main();
