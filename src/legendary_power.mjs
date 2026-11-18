export function refreshLegendaryPower(DB) {
  DB.exec(`
    CREATE TABLE IF NOT EXISTS legendary_awards (
      mint TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      tier TEXT NOT NULL,
      matching_rounds INTEGER NOT NULL,
      up_rounds INTEGER NOT NULL,
      down_rounds INTEGER NOT NULL,
      first_earned_at INTEGER NOT NULL,
      last_confirmed_at INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS legendary_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      previous_tier TEXT,
      new_tier TEXT NOT NULL,
      direction TEXT NOT NULL,
      matching_rounds INTEGER NOT NULL,
      awarded_at INTEGER NOT NULL
    );
  `);

  const now = Date.now();
  const cutoff = now - 360 * 60 * 1000;

  const rounds = DB.prepare(`
    SELECT id, completed_at
    FROM rounds
    WHERE status='completed'
      AND completed_at >= ?
      AND completed_at <= ?
    ORDER BY completed_at DESC, id DESC
    LIMIT 12
  `).all(cutoff, now);

  if (rounds.length !== 12) {
    console.log(
      `[LEGENDARY REGISTRY] Waiting for 12 completed rounds: ${rounds.length}/12`
    );

    return {
      evaluated: false,
      rounds: rounds.length,
      awards: 0
    };
  }

  const ids = rounds.map(round => round.id);
  const placeholders = ids.map(() => "?").join(",");

  const entries = DB.prepare(`
    SELECT re.mint, re.round_id, re.movement_sol
    FROM round_entries re
    WHERE re.round_id IN (${placeholders})
      AND re.movement_sol IS NOT NULL
  `).all(...ids);

  const movements = new Map();

  for (const entry of entries) {
    const value = Number(entry.movement_sol);

    if (!Number.isFinite(value) || value === 0) continue;

    if (!movements.has(entry.mint)) {
      movements.set(entry.mint, new Map());
    }

    movements.get(entry.mint).set(entry.round_id, value);
  }

  const selectAward = DB.prepare(`
    SELECT * FROM legendary_awards WHERE mint=?
  `);

  const saveAward = DB.prepare(`
    INSERT INTO legendary_awards (
      mint, direction, tier, matching_rounds,
      up_rounds, down_rounds, first_earned_at,
      last_confirmed_at, window_start, window_end
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET
      direction=excluded.direction,
      tier=excluded.tier,
      matching_rounds=excluded.matching_rounds,
      up_rounds=excluded.up_rounds,
      down_rounds=excluded.down_rounds,
      last_confirmed_at=excluded.last_confirmed_at,
      window_start=excluded.window_start,
      window_end=excluded.window_end
  `);

  const saveEvent = DB.prepare(`
    INSERT INTO legendary_events (
      mint, previous_tier, new_tier,
      direction, matching_rounds, awarded_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let awarded = 0;

  DB.exec("BEGIN IMMEDIATE");
  try {
    for (const [mint, roundMap] of movements) {
      let up = 0;
      let down = 0;

      for (const movement of roundMap.values()) {
        if (movement > 0) up++;
        if (movement < 0) down++;
      }

      const direction = up > down ? "UP" : down > up ? "DOWN" : null;
      const matching = Math.max(up, down);

      let tier = null;

      if (matching >= 10 && matching <= 12) {
        tier = "SUPER LEGENDARY";
      } else if (matching === 8 || matching === 9) {
        tier = "LEGENDARY";
      }

      if (!tier || !direction) continue;

      const previous = selectAward.get(mint);
      const changed = !previous ||
        previous.tier !== tier ||
        previous.direction !== direction;

      saveAward.run(
        mint,
        direction,
        tier,
        matching,
        up,
        down,
        previous?.first_earned_at ?? now,
        now,
        rounds[rounds.length - 1].completed_at,
        rounds[0].completed_at
      );

      if (changed) {
        saveEvent.run(
          mint,
          previous?.tier ?? null,
          tier,
          direction,
          matching,
          now
        );
        awarded++;
      }
    }
    DB.exec("COMMIT");
  } catch (error) {
    DB.exec("ROLLBACK");
    throw error;
  }

  console.log("\n========== PERMANENT LEGENDARY AWARD REGISTRY ==========");
  console.log(`Rounds evaluated: ${rounds.length}/12`);
  console.log(`New awards or upgrades: ${awarded}`);

  const records = DB.prepare(`
    SELECT * FROM legendary_awards
    ORDER BY
      CASE tier
        WHEN 'SUPER LEGENDARY' THEN 1
        ELSE 2
      END,
      matching_rounds DESC
  `).all();

  for (const record of records) {
    console.log("--------------------------------------------");
    const identity = DB.prepare(`
      SELECT name, symbol FROM tokens WHERE mint=?
    `).get(record.mint);

    console.log(`${record.tier} ${record.direction === "UP" ? "↑" : "↓"}`);
    console.log(`EXACT TOKEN NAME: ${identity?.name ?? "NAME NOT REGISTERED"}`);
    console.log(`TOKEN TICKER: ${identity?.symbol ?? "SYMBOL NOT REGISTERED"}`);
    console.log(`FULL MINT ADDRESS: ${record.mint}`);
    console.log(`Direction: ${record.direction}`);
    console.log(`Matching rounds: ${record.matching_rounds}/12`);
    console.log(`UP: ${record.up_rounds} | DOWN: ${record.down_rounds}`);
    console.log(`First earned: ${new Date(record.first_earned_at).toLocaleString()}`);
    console.log(`Last confirmed: ${new Date(record.last_confirmed_at).toLocaleString()}`);
  }

  console.log("TROPHY TOTALS: UNCHANGED");
  console.log("========================================================");

  return {
    evaluated: true,
    rounds: rounds.length,
    awards: records.length
  };
}
