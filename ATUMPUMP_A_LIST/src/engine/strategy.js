
export function fibonacciGoldenRatio(low, high) {
  if (!(low>0) || !(high>low)) return null;
  return high - 0.618*(high-low);
}
export function findEntrySetup(candles, currentPrice, previousPrice=null) {
  if(candles.length<3 || !(currentPrice>0) || !(previousPrice>0)) return null;
  const impulse=candles.slice(-3);
  const low=Math.min(...impulse.map(c=>c.low));
  const high=Math.max(...impulse.map(c=>c.high));
  const level=fibonacciGoldenRatio(low,high);
  if(!level || previousPrice>level || currentPrice<=previousPrice) return null;
  return {swing_low:low,swing_high:high,golden_ratio:level,price:currentPrice,
    reversal_confirmed:true};
}
export function shouldExit(position, currentPrice, now, holdMs) {
  if(now-position.entry_at>=holdMs) return {exit:true,reason:'NINE_DAY_HORIZON'};
  if(currentPrice<=position.entry_price*0.75) return {exit:true,reason:'TREND_FAILURE_GUARD'};
  return {exit:false};
}
