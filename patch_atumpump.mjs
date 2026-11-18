import fs from "node:fs";

const capturePath = "src/market_capture.mjs";
const enginePath = "src/championship_engine.mjs";

let capture = fs.readFileSync(capturePath, "utf8");
let engine = fs.readFileSync(enginePath, "utf8");

const oldRotation = `const getUnobservedTokens = db.prepare(\`
  SELECT
    t.mint,
    (
      SELECT MAX(p.observed_at)
      FROM price_observations p
      WHERE p.mint = t.mint
    ) AS last_observation
  FROM tokens t
  ORDER BY
    COALESCE(t.last_checked_at, 0) ASC,
    t.first_seen_at ASC
  LIMIT ?
\`);`;

const newRotation = `const getUnobservedTokens = db.prepare(\`
  SELECT t.mint
  FROM tokens t
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1
      FROM round_entries re
      JOIN rounds r ON r.id = re.round_id
      WHERE re.mint = t.mint AND r.status = 'active'
    ) THEN 0 ELSE 1 END ASC,
    CASE WHEN EXISTS (
      SELECT 1
      FROM round_entries re
      JOIN rounds r ON r.id = re.round_id
      WHERE re.mint = t.mint AND r.status = 'active'
    ) THEN COALESCE(t.last_checked_at, 0) ELSE 0 END ASC,
    COALESCE(t.last_checked_at, 0) ASC,
    t.first_seen_at ASC
  LIMIT ?
\`);`;

if (!capture.includes(oldRotation)) {
  throw new Error("Could not locate original token rotation query. No files changed.");
}

capture = capture.replace(oldRotation, newRotation);

const oldFilter = `        const matchingPairs = pairs.filter(
          pair => pair.baseToken?.address === mint
        );`;

const newFilter = `        const matchingPairs = pairs.filter(
          pair => pair.baseToken?.address === mint
        );`;

if (!capture.includes(oldFilter)) {
  throw new Error("Could not locate pair filtering code.");
}

capture = capture.replace(oldFilter, newFilter);

if (!engine.includes('import { DatabaseSync } from "node:sqlite";')) {
  throw new Error("Could not locate engine import.");
}

engine = engine.replace(
  'import { DatabaseSync } from "node:sqlite";',
  'import { DatabaseSync } from "node:sqlite";\nimport { createHash } from "node:crypto";'
);

const pragmaAnchor = `DB.exec("PRAGMA busy_timeout = 5000");`;

const schemaAddition = `
DB.exec("PRAGMA journal_mode = WAL");
DB.exec("PRAGMA synchronous = NORMAL");

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
`;

if (!engine.includes(pragmaAnchor)) {
  throw new Error("Could not locate engine PRAGMA section.");
}

engine = engine.replace(pragmaAnchor, pragmaAnchor + schemaAddition);

const sqlAnchor = `  complete: DB.prepare(\`
    UPDATE rounds
    SET completed_at = ?,
        status = 'completed',
        winner_mint = ?,
        winner_movement_sol = ?
    WHERE id = ? AND status = 'active'
  \`)
};`;

const sqlAddition = `  complete: DB.prepare(\`
    UPDATE rounds
    SET completed_at = ?,
        status = 'completed',
        winner_mint = ?,
        winner_movement_sol = ?
    WHERE id = ? AND status = 'active'
  \`),

  previousAudit: DB.prepare(\`
    SELECT audit_hash
    FROM rounds
    WHERE status = 'completed' AND audit_hash IS NOT NULL
    ORDER BY round_number DESC
    LIMIT 1
  \`),

  saveAudit: DB.prepare(\`
    UPDATE rounds
    SET previous_audit_hash = ?,
        audit_payload = ?,
        audit_hash = ?
    WHERE id = ?
  \`)
};`;

if (!engine.includes(sqlAnchor)) {
  throw new Error("Could not locate engine SQL statement section.");
}

engine = engine.replace(sqlAnchor, sqlAddition);

const displayAnchor = `  const board = [];

  for (const entry of entries) {`;

const displayReplacement = `  const board = [];
  let sampled = 0;

  for (const entry of entries) {`;

if (!engine.includes(displayAnchor)) {
  throw new Error("Could not locate leaderboard sample counter.");
}

engine = engine.replace(displayAnchor, displayReplacement);

const sampleAnchor = `    if (!latest || latest.observed_at <= entry.opening_at) continue;

    const movement = latest.price_sol - entry.opening_price_sol;`;

const sampleReplacement = `    if (!latest || latest.observed_at <= entry.opening_at) continue;

    sampled++;

    const movement = latest.price_sol - entry.opening_price_sol;`;

if (!engine.includes(sampleAnchor)) {
  throw new Error("Could not locate live observation counter.");
}

engine = engine.replace(sampleAnchor, sampleReplacement);

const displayHeader = `    \`\${board.length} positive movers\`
  );`;

const displayHeaderReplacement = `    \`\${board.length} positive movers | \${sampled}/\${entries.length} sampled\`
  );`;

if (!engine.includes(displayHeader)) {
  throw new Error("Could not locate leaderboard header.");
}

engine = engine.replace(displayHeader, displayHeaderReplacement);

const rankingAnchor = `    const winner = ranked[0] ?? null;

    if (winner) {`;

const rankingReplacement = `    const winner = ranked[0] ?? null;

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
          movement_sol: item.movement_sol
        })),
      rankings: ranked.map((item, index) => ({
        rank: index + 1,
        mint: item.mint,
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
      .update(previousHash + "\\n" + auditPayload, "utf8")
      .digest("hex");

    sql.saveAudit.run(previousHash, auditPayload, auditHash, round.id);

    if (winner) {`;

if (!engine.includes(rankingAnchor)) {
  throw new Error("Could not locate round completion ranking section.");
}

engine = engine.replace(rankingAnchor, rankingReplacement);

const auditOutputAnchor = `    console.log("Positive ranked results:", ranked.length);`;

const auditOutputReplacement = `    console.log("Positive ranked results:", ranked.length);
    console.log("AUDIT STANDARD: SHA-256");
    console.log("PREVIOUS HASH:", previousHash);
    console.log("ROUND HASH:", auditHash);`;

if (!engine.includes(auditOutputAnchor)) {
  throw new Error("Could not locate round completion output.");
}

engine = engine.replace(auditOutputAnchor, auditOutputReplacement);

fs.writeFileSync(capturePath, capture);
fs.writeFileSync(enginePath, engine);

console.log("[PATCHED] Active-round capture priority enabled.");
console.log("[PATCHED] Live sample counter enabled.");
console.log("[PATCHED] SHA-256 chained round audit enabled.");
console.log("[PATCHED] SQLite WAL mode enabled.");
