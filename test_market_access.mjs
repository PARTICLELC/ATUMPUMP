import PumpFun from "pumpfun-api";

const pump = new PumpFun();

async function test(label, callback) {
  console.log(`\n========== ${label} ==========`);
  try {
    const result = await callback();
    console.log("STATUS: SUCCESS");
    console.log(JSON.stringify(result, null, 2).slice(0, 7000));
    return result;
  } catch (error) {
    console.log("STATUS: FAILED");
    console.log(error.message);
    return null;
  }
}

const coins = await test("COIN DISCOVERY", () =>
  pump.coins.getCoins({
    limit: 5,
    offset: 0,
    order: "desc",
    includeNsfw: true
  })
);

await test("LATEST TOKEN", () => pump.coins.getLatestCoin());

await test("KING OF THE HILL", () =>
  pump.coins.getKingOfTheHill({ includeNsfw: true })
);

await test("SOL PRICE", () => pump.solPrice());

if (Array.isArray(coins) && coins.length > 0) {
  const mint = coins[0].mint;

  console.log("\nTEST MINT:", mint);

  await test("TOKEN CANDLESTICKS", () =>
    pump.coins.getCoinCandlesticks(mint, {
      limit: 10,
      offset: 0,
      timeframe: 1
    })
  );
}
