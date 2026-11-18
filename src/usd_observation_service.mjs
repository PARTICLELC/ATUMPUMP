import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");
const INTERVAL = 15000;
const BATCH_SIZE = 30;

let busy = false;

const activeRound = DB.prepare(`
  SELECT id, round_number
  FROM rounds
  WHERE status = 'active'
  ORDER BY id DESC
  LIMIT 1
`);

const activeEntries = DB.prepare(`
  SELECT re.mint, re.market_pair, re.token_pair
  FROM round_entries re
  WHERE re.round_id = ?
`);

const insertUsd = DB.prepare(`
  INSERT INTO price_observations
    (mint, observed_at, price_sol, source, pair_address, price_usd, sol_usd)
  VALUES (?, ?, ?, 'dexscreener_usd_background', ?, ?, ?)
`);

const updateOpening = DB.prepare(`
  UPDATE round_entries
  SET opening_price_usd =
    CASE
      WHEN opening_price_usd IS NULL
      THEN opening_price_sol * ?
      ELSE opening_price_usd
    END
  WHERE round_id = ? AND mint = ?
`);

async function capture() {
  if (busy) return;
  busy = true;

  try {
    const round = activeRound.get();

    if (!round) {
      console.log("[USD] No active round.");
      return;
    }

    const entries = activeEntries.all(round.id);
    if (!entries.length) {
      console.log(`[USD] Round ${round.round_number}: no entries.`);
      return;
    }

    let saved = 0;

    for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
      const batch = entries.slice(offset, offset + BATCH_SIZE);
      const mints = batch.map(entry => entry.mint);

      const response = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`,
        {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(20000)
        }
      );

      if (response.status === 429) {
        console.log("[USD] HTTP 429; next cycle will retry.");
        return;
      }

      if (!response.ok) {
        throw new Error(`DexScreener HTTP ${response.status}`);
      }

      const pairs = await response.json();

      for (const entry of batch) {
        const candidates = pairs.filter(pair =>
          pair.chainId === "solana" &&
          pair.baseToken?.address === entry.mint
        );

        if (!candidates.length) continue;

        const expectedPair = entry.market_pair || entry.token_pair;

        const pair =
          candidates.find(candidate =>
            expectedPair && candidate.pairAddress === expectedPair
          ) ||
          candidates.sort((a, b) =>
            Number(b.liquidity?.usd || 0) -
            Number(a.liquidity?.usd || 0)
          )[0];

        const priceUsd = Number(pair.priceUsd);
        const priceSol = Number(pair.priceNative);
        const solUsd = priceUsd / priceSol;
        const pairAddress = pair.pairAddress;

        if (
          !Number.isFinite(priceUsd) ||
          !Number.isFinite(priceSol) ||
          !Number.isFinite(solUsd) ||
          priceUsd <= 0 ||
          priceSol <= 0 ||
          solUsd <= 0 ||
          !pairAddress
        ) continue;

        const now = Date.now();

        insertUsd.run(
          entry.mint,
          now,
          priceSol,
          pairAddress,
          priceUsd,
          solUsd
        );

        updateOpening.run(solUsd, round.id, entry.mint);
        saved++;
      }
    }

    console.log(
      `[USD] Round ${round.round_number}: ${saved}/${entries.length} observations saved.`
    );
  } catch (error) {
    console.log("[USD ERROR] " + error.stack);
  } finally {
    busy = false;
  }
}

console.log("[ONLINE] USD observation service.");
await capture();
setInterval(capture, INTERVAL);
