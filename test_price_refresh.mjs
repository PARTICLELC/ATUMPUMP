const tokens = [
  "BQo18x16LuYdFwZHyq578qc5enqQW57LTE9Cgwzqpump",
  "92x8GUXBMq8wnjg7Eppp3ms7cq84he9KsZ9udAqSCALL",
  "E7nEqHdxTnBEjaaqVXMqf5BMQU9ZHB5gSTefA9kPwgWf"
];

const SOL = "So11111111111111111111111111111111111111112";
const history = new Map();

async function snapshot(label) {
  console.log(`\n========== ${label} ==========`);

  const url =
    `https://api.dexscreener.com/tokens/v1/solana/${tokens.join(",")}`;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  console.log("HTTP:", response.status);
  console.log("Cache-Control:", response.headers.get("cache-control"));
  console.log("Age:", response.headers.get("age"));
  console.log("Date:", response.headers.get("date"));

  if (!response.ok) {
    console.log((await response.text()).slice(0, 1000));
    return;
  }

  const pairs = await response.json();

  for (const mint of tokens) {
    const pair = pairs.find(
      item =>
        item.baseToken?.address === mint &&
        item.quoteToken?.address === SOL &&
        item.dexId === "pumpfun"
    );

    if (!pair) {
      console.log(mint, "NO QUALIFYING SOL PAIR");
      continue;
    }

    const price = Number(pair.priceNative);

    if (!Number.isFinite(price) || price <= 0) {
      console.log(mint, "INVALID PRICE");
      continue;
    }

    const previous = history.get(mint);

    console.log(JSON.stringify({
      mint,
      symbol: pair.baseToken.symbol,
      priceSol: price,
      previousPriceSol: previous ?? null,
      changeSol: previous === undefined ? null : price - previous,
      pairAddress: pair.pairAddress
    }, null, 2));

    history.set(mint, price);
  }
}

try {
  await snapshot("SNAPSHOT 1");

  console.log("\nWaiting 65 seconds for the next observation...");
  await new Promise(resolve => setTimeout(resolve, 65000));

  await snapshot("SNAPSHOT 2");

} catch (error) {
  console.log("[ERROR]", error.message);
}

console.log("\n========== REFRESH TEST COMPLETE ==========");
