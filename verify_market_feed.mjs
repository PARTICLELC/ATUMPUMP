const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

console.log("========== DEXSCREENER TOKEN PAIR VALIDATION ==========");

try {
  const profileResponse = await fetch(
    "https://api.dexscreener.com/token-profiles/latest/v1"
  );

  if (!profileResponse.ok) {
    throw new Error(`Profiles HTTP ${profileResponse.status}`);
  }

  const profiles = await profileResponse.json();

  const solanaProfiles = profiles
    .filter(item => item.chainId === "solana")
    .slice(0, 10);

  console.log("Solana profiles:", solanaProfiles.length);

  if (solanaProfiles.length) {
    const addresses = solanaProfiles
      .map(item => item.tokenAddress)
      .join(",");

    const pairResponse = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${addresses}`
    );

    console.log("PAIR HTTP:", pairResponse.status);

    if (!pairResponse.ok) {
      throw new Error(`Pair HTTP ${pairResponse.status}`);
    }

    const pairs = await pairResponse.json();

    const pumpPairs = pairs.filter(
      pair => pair.dexId === "pumpfun"
    );

    console.log("Total returned pairs:", pairs.length);
    console.log("Pump.fun pairs:", pumpPairs.length);

    for (const pair of pumpPairs.slice(0, 5)) {
      console.log(JSON.stringify({
        name: pair.baseToken?.name,
        symbol: pair.baseToken?.symbol,
        mint: pair.baseToken?.address,
        dex: pair.dexId,
        quoteSymbol: pair.quoteToken?.symbol,
        quoteAddress: pair.quoteToken?.address,
        priceNative: pair.priceNative,
        priceUsd: pair.priceUsd,
        pairAddress: pair.pairAddress,
        pairCreatedAt: pair.pairCreatedAt
      }, null, 2));
    }
  }
} catch (error) {
  console.log("[DEX ERROR]", error.message);
}

console.log("\n========== PUMPPORTAL 60-SECOND DISCOVERY ==========");

let eventCount = 0;

try {
  const socket = new WebSocket("wss://pumpportal.fun/api/data");

  await new Promise(resolve => {
    const timeout = setTimeout(() => {
      console.log("Discovery window complete.");
      socket.close();
    }, 60000);

    socket.onopen = () => {
      console.log("[CONNECTED]");
      socket.send(JSON.stringify({
        method: "subscribeNewToken"
      }));
    };

    socket.onmessage = event => {
      let data;

      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (data.mint) {
        eventCount++;
        console.log(`[TOKEN EVENT ${eventCount}]`, JSON.stringify(data).slice(0, 1500));
      } else {
        console.log("[SERVER]", JSON.stringify(data));
      }
    };

    socket.onerror = () => {
      console.log("[WEBSOCKET ERROR]");
    };

    socket.onclose = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
} catch (error) {
  console.log("[PUMPPORTAL ERROR]", error.message);
}

console.log("\n========== FINAL FEED REPORT ==========");
console.log("PumpPortal token events received:", eventCount);
console.log("Test completed.");
