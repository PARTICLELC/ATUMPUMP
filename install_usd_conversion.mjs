import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const db = new DatabaseSync("data/atumpump.sqlite");

function addColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[DATABASE] Added ${table}.${column}`);
  }
}

addColumn("price_observations", "price_usd", "REAL");
addColumn("price_observations", "sol_usd", "REAL");
addColumn("round_entries", "opening_price_usd", "REAL");

db.close();

const path = "src/control_center.mjs";
let source = fs.readFileSync(path, "utf8");

if (!source.includes("async function refreshRoundUsdPrices(")) {
  const anchor = "async function liveRoundWatch()";
  if (!source.includes(anchor)) {
    throw new Error("Module 16 was not found.");
  }

  const helper = `
async function refreshRoundUsdPrices(round) {
  if (!round) return;

  const entries = DB.prepare(\`
    SELECT e.mint, e.opening_price_sol,
      t.pair_address AS token_pair,
      mp.pair_address AS market_pair
    FROM round_entries e
    LEFT JOIN tokens t ON t.mint=e.mint
    LEFT JOIN market_pairs mp ON mp.mint=e.mint AND mp.active=1
    WHERE e.round_id=?
  \`).all(round.id);

  const mints = [...new Set(entries.map(e => e.mint).filter(Boolean))];

  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const endpoint =
      "https://api.dexscreener.com/tokens/v1/solana/" +
      batch.join(",");

    try {
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" }
      });

      if (!response.ok) {
        console.log("[USD FEED] DexScreener HTTP " + response.status);
        continue;
      }

      const pairs = await response.json();
      if (!Array.isArray(pairs)) continue;

      for (const entry of entries) {
        if (!batch.includes(entry.mint)) continue;

        const candidates = pairs.filter(pair =>
          pair.baseToken?.address === entry.mint &&
          Number(pair.priceUsd) > 0 &&
          Number(pair.priceNative) > 0
        );

        if (!candidates.length) continue;

        const expectedPair = entry.market_pair || entry.token_pair;
        const pair = candidates.find(p =>
          expectedPair && p.pairAddress === expectedPair
        ) || candidates.sort(
          (a, b) =>
            Number(b.liquidity?.usd || 0) -
            Number(a.liquidity?.usd || 0)
        )[0];

        const priceUsd = Number(pair.priceUsd);
        const priceNative = Number(pair.priceNative);
        const solUsd = priceUsd / priceNative;
        const pairAddress = pair.pairAddress;

        if (
          !Number.isFinite(priceUsd) ||
          !Number.isFinite(solUsd) ||
          priceUsd <= 0 ||
          solUsd <= 0
        ) continue;

        const now = Date.now();

        const latest = DB.prepare(\`
          SELECT id FROM price_observations
          WHERE mint=? AND pair_address=?
          ORDER BY observed_at DESC, id DESC LIMIT 1
        \`).get(entry.mint, pairAddress);

        if (latest) {
          DB.prepare(\`
            UPDATE price_observations
            SET price_usd=?, sol_usd=?
            WHERE id=?
          \`).run(priceUsd, solUsd, latest.id);
        } else {
          DB.prepare(\`
            INSERT INTO price_observations
              (mint, observed_at, price_sol, source, pair_address, price_usd, sol_usd)
            VALUES (?, ?, ?, 'dexscreener_usd', ?, ?, ?)
          \`).run(
            entry.mint, now, priceNative,
            pairAddress, priceUsd, solUsd
          );
        }

        DB.prepare(\`
          UPDATE round_entries
          SET opening_price_usd =
            CASE
              WHEN opening_price_usd IS NULL
              THEN opening_price_sol * ?
              ELSE opening_price_usd
            END
          WHERE round_id=? AND mint=?
        \`).run(solUsd, round.id, entry.mint);
      }
    } catch (error) {
      console.log("[USD FEED ERROR] " + error.message);
    }
  }
}
`;

  source = source.replace(anchor, helper + "\n" + anchor);
}

const functionStart = source.indexOf("async function liveRoundWatch()");
if (functionStart < 0) throw new Error("Module 16 not found.");

const queryStart = source.indexOf(
  "    const entries = DB.prepare(`",
  functionStart
);
const displayStart = source.indexOf(
  '    console.log("\\n========== 🏆 POSITIVE MOVERS ==========");',
  queryStart
);

if (queryStart < 0 || displayStart < 0) {
  throw new Error("Could not locate Module 16 leaderboard query.");
}

const replacement = `
    const entries = DB.prepare(\`
      SELECT
        e.mint,
        t.symbol,
        t.name,
        t.pair_address,
        e.opening_price_usd,
        p.price_usd AS current_price_usd,
        p.observed_at AS latest_observation,
        p.price_usd - e.opening_price_usd AS movement_usd
      FROM round_entries e
      LEFT JOIN tokens t ON t.mint=e.mint
      LEFT JOIN price_observations p
        ON p.id=(
          SELECT po.id
          FROM price_observations po
          WHERE po.mint=e.mint
            AND po.price_usd IS NOT NULL
            AND po.observed_at >= e.opening_at
          ORDER BY po.observed_at DESC, po.id DESC
          LIMIT 1
        )
      WHERE e.round_id=?
        AND e.opening_price_usd IS NOT NULL
        AND p.price_usd IS NOT NULL
        AND p.price_usd > e.opening_price_usd
      ORDER BY movement_usd DESC, e.mint ASC
    \`).all(round.id)
      .sort((a, b) =>
        Number(b.movement_usd) - Number(a.movement_usd)
      );

`;

source = source.slice(0, queryStart) +
  replacement +
  source.slice(displayStart);

source = source.replace(
  '    console.log("HIERARCHY: HIGHEST POSITIVE SOL MOVEMENT → LOWEST");',
  '    console.log("HIERARCHY: HIGHEST POSITIVE USD MOVEMENT → LOWEST");'
);

source = source.replace(
  '    console.log("RANK  TOKEN          OPEN SOL             CURRENT SOL          MOVEMENT SOL");',
  '    console.log("RANK  TOKEN          OPEN USD              CURRENT USD           MOVEMENT USD");'
);

source = source.replace(
  '    console.log(`Positive movers: ${entries.length}`);',
  '    console.log(`Positive USD movers: ${entries.length}`);'
);

source = source.replace(
  '      const opening = Number(entry.opening_price_sol).toExponential(8);\n      const current = Number(entry.current_price_sol).toExponential(8);\n      const movement = \`+\${Number(entry.movement_sol).toExponential(8)}\`;',
  '      const opening = "$" + Number(entry.opening_price_usd).toExponential(8);\n      const current = "$" + Number(entry.current_price_usd).toExponential(8);\n      const movement = "+$" + Number(entry.movement_usd).toExponential(8);'
);

const renderAnchor = "  renderLiveRound();";
if (!source.includes(renderAnchor)) {
  throw new Error("Module 16 render startup not found.");
}

source = source.replace(
  renderAnchor,
  `  await refreshRoundUsdPrices(latestRound());
  renderLiveRound();

  const usdRefresh = setInterval(async () => {
    try {
      await refreshRoundUsdPrices(latestRound());
      renderLiveRound();
    } catch (error) {
      console.log("[USD REFRESH ERROR] " + error.message);
    }
  }, 15000);`
);

source = source.replace(
  "    clearInterval(refresh);",
  "    clearInterval(refresh);\n    clearInterval(usdRefresh);"
);

fs.writeFileSync(path, source);

console.log("[INSTALLED] ATUMPUMP USD CONVERSION KIT");
console.log("[INSTALLED] DexScreener USD price capture");
console.log("[INSTALLED] SOL/USD conversion ratio capture");
console.log("[INSTALLED] Round opening USD snapshots");
console.log("[INSTALLED] Module 16 USD movement ranking");
