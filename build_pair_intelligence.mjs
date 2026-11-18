import fs from "node:fs";

const capturePath = "src/market_capture.mjs";
const enginePath = "src/championship_engine.mjs";

let capture = fs.readFileSync(capturePath, "utf8");
let engine = fs.readFileSync(enginePath, "utf8");

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`PATCH STOPPED: Could not locate ${label}. No files written.`);
  }
  return source.replace(before, after);
}

// ============================================================
// MARKET CAPTURE — PAIR REGISTRY AND HISTORICAL OBSERVATIONS
// ============================================================

capture = replaceOnce(
  capture,
  'db.exec("PRAGMA synchronous = NORMAL");',
  `db.exec("PRAGMA synchronous = NORMAL");

db.exec(\`
  CREATE TABLE IF NOT EXISTS market_pairs (
    pair_address TEXT PRIMARY KEY,
    mint TEXT NOT NULL,
    dex_id TEXT,
    chain_id TEXT,
    quote_mint TEXT,
    pair_url TEXT,
    price_sol REAL,
    liquidity_usd REAL,
    volume_h24 REAL,
    fdv REAL,
    market_cap REAL,
    pair_created_at INTEGER,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_market_pairs_mint
    ON market_pairs(mint);

  CREATE INDEX IF NOT EXISTS idx_market_pairs_last_seen
    ON market_pairs(last_seen_at);

  CREATE TABLE IF NOT EXISTS market_pair_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_address TEXT NOT NULL,
    mint TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    price_sol REAL NOT NULL,
    liquidity_usd REAL,
    volume_h24 REAL,
    fdv REAL,
    market_cap REAL
  );

  CREATE INDEX IF NOT EXISTS idx_pair_observations_address_time
    ON market_pair_observations(pair_address, observed_at);

  CREATE INDEX IF NOT EXISTS idx_pair_observations_mint_time
    ON market_pair_observations(mint, observed_at);
\`);

console.log("[DATABASE] Trading-pair intelligence tables ready.");`,
  "capture database initialization"
);

capture = replaceOnce(
  capture,
  `const updatePair = db.prepare(\`
  UPDATE tokens
  SET pair_address = ?, quote_mint = ?, eligible = ?
  WHERE mint = ?
\`);`,
  `const updatePair = db.prepare(\`
  UPDATE tokens
  SET pair_address = ?, quote_mint = ?, eligible = ?
  WHERE mint = ?
\`);

const upsertMarketPair = db.prepare(\`
  INSERT INTO market_pairs (
    pair_address, mint, dex_id, chain_id, quote_mint, pair_url,
    price_sol, liquidity_usd, volume_h24, fdv, market_cap,
    pair_created_at, first_seen_at, last_seen_at, active
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(pair_address) DO UPDATE SET
    mint = excluded.mint,
    dex_id = excluded.dex_id,
    chain_id = excluded.chain_id,
    quote_mint = excluded.quote_mint,
    pair_url = excluded.pair_url,
    price_sol = excluded.price_sol,
    liquidity_usd = excluded.liquidity_usd,
    volume_h24 = excluded.volume_h24,
    fdv = excluded.fdv,
    market_cap = excluded.market_cap,
    pair_created_at = COALESCE(
      excluded.pair_created_at,
      market_pairs.pair_created_at
    ),
    last_seen_at = excluded.last_seen_at,
    active = 1
\`);

const insertPairObservation = db.prepare(\`
  INSERT INTO market_pair_observations (
    pair_address, mint, observed_at, price_sol,
    liquidity_usd, volume_h24, fdv, market_cap
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
\`);`,
  "pair SQL statements"
);

capture = replaceOnce(
  capture,
  `        updatePair.run(
          pair.pairAddress ?? null,
          SOL_MINT,
          1,
          mint
        );

        insertObservation.run(`,
  `        updatePair.run(
          pair.pairAddress ?? null,
          SOL_MINT,
          1,
          mint
        );

        const liquidityUsd = Number(pair.liquidity?.usd);
        const volumeH24 = Number(pair.volume?.h24);
        const fdv = Number(pair.fdv);
        const marketCap = Number(pair.marketCap);
        const pairCreatedAt = Number(pair.pairCreatedAt);

        const pairValues = {
          liquidity: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
          volume: Number.isFinite(volumeH24) ? volumeH24 : null,
          fdv: Number.isFinite(fdv) ? fdv : null,
          marketCap: Number.isFinite(marketCap) ? marketCap : null
        };

        upsertMarketPair.run(
          pair.pairAddress,
          mint,
          pair.dexId ?? null,
          pair.chainId ?? "solana",
          pair.quoteToken?.address ?? SOL_MINT,
          pair.url ?? null,
          price,
          pairValues.liquidity,
          pairValues.volume,
          pairValues.fdv,
          pairValues.marketCap,
          Number.isFinite(pairCreatedAt) ? pairCreatedAt : null,
          now,
          now
        );

        insertPairObservation.run(
          pair.pairAddress,
          mint,
          now,
          price,
          pairValues.liquidity,
          pairValues.volume,
          pairValues.fdv,
          pairValues.marketCap
        );

        insertObservation.run(`,
  "pair capture insertion"
);

// ============================================================
// CHAMPIONSHIP ENGINE — PAIR DISPLAY AND ARCHIVAL IDENTITY
// ============================================================

engine = replaceOnce(
  engine,
  'DB.exec("PRAGMA synchronous = NORMAL");',
  `DB.exec("PRAGMA synchronous = NORMAL");

const resultColumns = DB.prepare("PRAGMA table_info(round_results)").all();
if (!resultColumns.some(column => column.name === "pair_address")) {
  DB.exec("ALTER TABLE round_results ADD COLUMN pair_address TEXT");
}`,
  "round result pair migration"
);

engine = replaceOnce(
  engine,
  `    SELECT re.*, t.symbol, t.name
    FROM round_entries re
    JOIN tokens t ON t.mint = re.mint
    WHERE re.round_id = ?`,
  `    SELECT re.*, t.symbol, t.name, t.pair_address
    FROM round_entries re
    JOIN tokens t ON t.mint = re.mint
    WHERE re.round_id = ?`,
  "leaderboard pair identity query"
);

engine = replaceOnce(
  engine,
  `    SELECT re.mint, t.symbol,
           re.opening_price_sol,
           re.closing_price_sol,
           re.movement_sol
    FROM round_entries re`,
  `    SELECT re.mint, t.symbol, t.pair_address,
           re.opening_price_sol,
           re.closing_price_sol,
           re.movement_sol
    FROM round_entries re`,
  "ranking pair identity query"
);

engine = replaceOnce(
  engine,
  `    INSERT INTO round_results
      (round_id, mint, rank, opening_price_sol,
       closing_price_sol, movement_sol, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  `      INSERT INTO round_results
      (round_id, mint, rank, opening_price_sol,
       closing_price_sol, movement_sol, recorded_at, pair_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  "round result insert pair column"
);

engine = replaceOnce(
  engine,
  `        item.movement_sol,
        now
      );`,
  `        item.movement_sol,
        now,
        item.pair_address ?? null
      );`,
  "round result pair value"
);

engine = replaceOnce(
  engine,
  `          mint: item.mint,
          movement_sol: item.movement_sol
        })),
      rankings: ranked.map((item, index) => ({
        rank: index + 1,
        mint: item.mint,
        opening_price_sol: item.opening_price_sol,`,
  `          mint: item.mint,
          movement_sol: item.movement_sol,
          pair_address: DB.prepare(
            "SELECT pair_address FROM tokens WHERE mint = ?"
          ).get(item.mint)?.pair_address ?? null
        })),
      rankings: ranked.map((item, index) => ({
        rank: index + 1,
        mint: item.mint,
        pair_address: item.pair_address ?? null,
        opening_price_sol: item.opening_price_sol,`,
  "audit pair identity"
);

engine = replaceOnce(
  engine,
  `        symbol: entry.symbol ?? entry.name ?? "UNKNOWN",
        mint: entry.mint,
        opening: entry.opening_price_sol,`,
  `        symbol: entry.symbol ?? entry.name ?? "UNKNOWN",
        mint: entry.mint,
        pair: entry.pair_address ?? "PAIR NOT REGISTERED",
        opening: entry.opening_price_sol,`,
  "live leaderboard pair field"
);

engine = replaceOnce(
  engine,
  `    console.log(
      \`\${String(index + 1).padEnd(5)} \` +
      \`\${item.symbol.slice(0, 16).padEnd(16)} \` +
      \`\${item.opening.toExponential(8).padEnd(18)} \` +
      \`\${item.current.toExponential(8).padEnd(18)} \` +
      \`+\${item.movement.toExponential(8)}\`
    );`,
  `    console.log(
      \`\${String(index + 1).padEnd(5)} \` +
      \`\${item.symbol.slice(0, 16).padEnd(16)} \` +
      \`\${item.opening.toExponential(8).padEnd(18)} \` +
      \`\${item.current.toExponential(8).padEnd(18)} \` +
      \`+\${item.movement.toExponential(8)}\`
    );
    console.log(
      \`      PAIR: \${item.pair}\`
    );`,
  "leaderboard pair display"
);

fs.writeFileSync(capturePath, capture);
fs.writeFileSync(enginePath, engine);

console.log("[PASS] Pair registry created.");
console.log("[PASS] Pair observation history created.");
console.log("[PASS] Pair liquidity and volume capture installed.");
console.log("[PASS] Pair address added to leaderboard records.");
console.log("[PASS] Pair address added to round archives.");
console.log("[PASS] Pair identity included in audit payload.");
