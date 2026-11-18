import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/atumpump.sqlite");
const INTERVAL = 5000;
let busy = false;

const latestSolUsd = db.prepare(`
  SELECT sol_usd
  FROM price_observations
  WHERE sol_usd > 0
  ORDER BY observed_at DESC, id DESC
  LIMIT 1
`);

const pendingPairs = db.prepare(`
  SELECT
    mpo.mint,
    mpo.pair_address,
    mpo.observed_at,
    mpo.price_sol
  FROM market_pair_observations mpo
  WHERE mpo.price_sol > 0
    AND mpo.pair_address IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM price_observations po
      WHERE po.pair_address = mpo.pair_address
        AND po.observed_at = mpo.observed_at
        AND po.source = 'pair_usd_bridge'
    )
  ORDER BY mpo.observed_at ASC
  LIMIT 1000
`);

const insertUsd = db.prepare(`
  INSERT INTO price_observations
    (mint, observed_at, price_sol, source, pair_address, price_usd, sol_usd)
  VALUES (?, ?, ?, 'pair_usd_bridge', ?, ?, ?)
`);

function bridge() {
  if (busy) return;
  busy = true;

  try {
    const rate = Number(latestSolUsd.get()?.sol_usd || 0);

    if (!Number.isFinite(rate) || rate <= 0) {
      console.log("[BRIDGE] Waiting for a valid SOL/USD conversion rate.");
      return;
    }

    const rows = pendingPairs.all();
    let inserted = 0;

    const transaction = db.transaction(() => {
      for (const row of rows) {
        const priceSol = Number(row.price_sol);
        const priceUsd = priceSol * rate;

        if (
          !Number.isFinite(priceUsd) ||
          priceUsd <= 0 ||
          !row.mint ||
          !row.pair_address
        ) continue;

        insertUsd.run(
          row.mint,
          row.observed_at,
          priceSol,
          row.pair_address,
          priceUsd,
          rate
        );

        inserted++;
      }
    });

    transaction();

    if (inserted) {
      console.log(`[BRIDGE] USD observations connected: ${inserted}`);
    }
  } catch (error) {
    console.log("[BRIDGE ERROR] " + error.message);
  } finally {
    busy = false;
  }
}

console.log("[ONLINE] Registered-pair USD bridge.");
bridge();
setInterval(bridge, INTERVAL);
