const tokens = [
  "BQo18x16LuYdFwZHyq578qc5enqQW57LTE9Cgwzqpump",
  "92x8GUXBMq8wnjg7Eppp3ms7cq84he9KsZ9udAqSCALL",
  "E7nEqHdxTnBEjaaqVXMqf5BMQU9ZHB5gSTefA9kPwgWf"
];

let tradeCount = 0;

console.log("========== PUMPPORTAL TRADE STREAM ==========");

const socket = new WebSocket("wss://pumpportal.fun/api/data");

const timeout = setTimeout(() => {
  console.log("[TEST WINDOW COMPLETE]");
  socket.close();
}, 60000);

socket.onopen = () => {
  console.log("[CONNECTED]");

  socket.send(JSON.stringify({
    method: "subscribeTokenTrade",
    keys: tokens
  }));

  console.log("[SUBSCRIBED TOKENS]", tokens.length);
};

socket.onmessage = event => {
  let data;

  try {
    data = JSON.parse(String(event.data));
  } catch {
    return;
  }

  if (data.mint && data.txType) {
    tradeCount++;

    const solAmount = Number(data.solAmount);
    const tokenAmount = Number(data.tokenAmount);

    const price = tokenAmount > 0
      ? solAmount / tokenAmount
      : null;

    console.log(JSON.stringify({
      trade: tradeCount,
      mint: data.mint,
      type: data.txType,
      solAmount,
      tokenAmount,
      priceSolPerToken: price,
      marketCapSol: data.marketCapSol,
      signature: data.signature
    }, null, 2));
  } else {
    console.log("[SERVER]", JSON.stringify(data));
  }
};

socket.onerror = error => {
  console.log("[ERROR]", error.message || error);
};

socket.onclose = () => {
  clearTimeout(timeout);
  console.log("[DISCONNECTED]");
  console.log("TOTAL TRADES:", tradeCount);
};
