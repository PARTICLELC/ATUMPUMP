function gateFor(candles) {
  const last3  = candles.slice(-3);
  const last12 = candles.slice(-12);

  const isUp = c => Number(c.close) > Number(c.open) * 0.98;
  const isUp3 = last3.length === 3 && last3.every(isUp);

  const explosive = last3.some(c => Number(c.open) > 0 && Number(c.close) >= Number(c.open) * 1.8);

  const twelveDay = last12.length >= 8 && last12.filter(isUp).length >= 8;

  const threeDay = isUp3;

  return [
    explosive ? { state: 'EXPLODE DOMINANCE',  gate: 'THREE_CANDLE_100_PERCENT_GROWTH', candles: last3  } : null,
    twelveDay ? { state: '12 DAY CANDIDATE',   gate: '12_UP_0_DOWN',                   candles: last12 } : null,
    threeDay  ? { state: '3 DAY CANDIDATE',    gate: '3_UP_0_DOWN',                    candles: last3  } : null,
  ].filter(Boolean);
}
