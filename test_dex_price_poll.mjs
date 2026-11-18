const tokens = [
  "BQo18x16LuYdFwZHyq578qc5enqQW57LTE9Cgwzqpump",
  "92x8GUXBMq8wnjg7Eppp3ms7cq84he9KsZ9udAqSCALL",
  "E7nEqHdxTnBEjaaqVXMqf5BMQU9ZHB5gSTefA9kPwgWf"
];

async function poll(label) {
  console.log(`\n========== ${label} ==========`);

  const url =
    `https://api.dexscreener.com/tokens/v1/solana/${tokens.join(",")}`;

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });

    console.log("HTTP:", response.status);

    if (!response.ok) {
      console.log((await response.text()).slice(0, 1000));
      return;
    }

    const pairs = await response.json();

    for (const mint of tokens) {
      const matches = pairs.filter(
        pair => pair.baseToken?.address === mint
      );

      console.log(`\nTOKEN: ${mint}`);
      console.log("Pairs:", matches.length);

      for (const pair of matches) {
        console.log(JSON.stringify({
          dex: pair.dexId,
          symbol: pair.baseToken?.symbol,
          quoteSymbol: pair.quoteToken?.symbol,
          quoteAddress: pair.quoteToken?.address,
          priceNative: pair.priceNative,
          priceUsd: pair.priceUsd,
          liquidityUsd: pair.liquidity?.usd,
          pairCreatedAt: pair.pairCreatedAt
        }, null, 2));
      }
    }
  } catch (error) {
    console.log("[ERROR]", error.message);
  }
}

await poll("PRICE SNAPSHOT 1");

console.log("\nWaiting 15 seconds...");
await new Promise(resolve => setTimeout(resolve, 15000));

await poll("PRICE SNAPSHOT 2");

console.log("\n========== TEST COMPLETE ==========");
