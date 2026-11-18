const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function httpTest(label, url) {
  console.log(`\n========== ${label} ==========`);

  try {
    const response = await fetch(url, {
      headers: { "accept": "application/json" },
      signal: AbortSignal.timeout(12000)
    });

    console.log("HTTP:", response.status);

    const body = await response.text();
    console.log(body.slice(0, 2500));
  } catch (error) {
    console.log("ERROR:", error.message);
  }
}

await httpTest(
  "DEXSCREENER LATEST TOKEN PROFILES",
  "https://api.dexscreener.com/token-profiles/latest/v1"
);

await httpTest(
  "DEXSCREENER SOLANA TOKEN SEARCH",
  "https://api.dexscreener.com/latest/dex/search?q=SOL"
);

console.log("\n========== PUMPPORTAL WEBSOCKET ==========");

try {
  const socket = new WebSocket("wss://pumpportal.fun/api/data");

  const timeout = setTimeout(() => {
    console.log("[TIMEOUT] No token event received during test window.");
    socket.close();
  }, 20000);

  socket.onopen = () => {
    console.log("[CONNECTED] PumpPortal WebSocket");
    socket.send(JSON.stringify({ method: "subscribeNewToken" }));
    console.log("[SUBSCRIBED] New token events");
  };

  socket.onmessage = event => {
    console.log("[LIVE EVENT]");
    console.log(String(event.data).slice(0, 4000));
  };

  socket.onerror = error => {
    console.log("[WEBSOCKET ERROR]", error.message || error);
  };

  socket.onclose = () => {
    clearTimeout(timeout);
    console.log("[DISCONNECTED]");
  };

  await sleep(22000);
  clearTimeout(timeout);
  socket.close();

} catch (error) {
  console.log("[WEBSOCKET FAILED]", error.message);
}
