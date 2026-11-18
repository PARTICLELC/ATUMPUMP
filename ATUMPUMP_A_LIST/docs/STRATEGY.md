# Strategy specification
- Gate A: 3 latest closed UTC daily candles all close > open.
- Gate B: 12 latest closed UTC daily candles all close > open.
- Gate C: Gate A plus day-2 close >= 2 * day-1 close and day-3 close >= 2 * day-2 close.
- EXPLODE DOMINANCE is emitted only after the third candle is closed.
- The 12-day confirmation is separate from accelerated Gate C.
- Fibonacci retracement uses `H - 0.618 * (H - L)`.
- Entry is evaluated only against an observed market price after the retracement level is reached.
- Nine-day horizon is enforced by trade manager; a 25% entry-price drawdown is an example protective trend-failure exit in this starter implementation.
- All fills are demo-only, include configurable fee/slippage, and store the observation source and timestamp.
