# ATUMPUMP A-LIST — 100 PIP GROWTH+ DOMINANCE GAME

Autonomous, spectator-only crypto trading simulation for ten NPCs. Node.js 24+, SQLite, live market observations, daily-candle dominance gates, Fibonacci retracement monitoring, nine-day trade horizon, 72-hour championships, XP, achievements, and hash-chained audit events.

## Safety and scope
- **Demo-only execution.** No wallet, private key, exchange order, or real-money execution code exists in this package.
- Trades are simulated against recorded market observations. A fill is never created without a source observation.
- Live mode fails closed unless the Module 21 adapter is configured and returns valid pair/price data.
- This is a runnable game-engine foundation. Your existing ATUMPUMP database schema and Module 21 query are not assumed; configure the adapter in `.env` to match your local schema.
- The package does not modify or delete your existing ATUMPUMP database.

## Requirements
- Node.js 24.x (uses built-in `node:sqlite`)
- Termux or Linux/macOS shell
- `unzip`

## Install
```bash
unzip ATUMPUMP_A_LIST.zip
cd ATUMPUMP_A_LIST
chmod +x MASTER_COMMAND.sh
./MASTER_COMMAND.sh install
```

## Start in self-contained demonstration mode
```bash
./MASTER_COMMAND.sh demo
```
Demo mode uses deterministic synthetic market data and is clearly marked DEMO. It is for testing the game loop, not evidence of live-market performance.

## Connect ATUMPUMP Module 21
1. Copy `.env.example` to `.env`.
2. Set `A_LIST_MODE=live`.
3. Set `ATUMPUMP_DB_PATH` to your existing `~/ATUMPUMP/data/atumpump.sqlite`.
4. Configure `MODULE21_SQL` to return columns:
   `mint, pair_address, symbol, name, price, observed_at, source`.
5. SQL must use SQLite named parameter `:limit` and return the latest usable observation per pair. Example template is in `config/module21.example.sql`.
6. Run `./MASTER_COMMAND.sh check`, then `./MASTER_COMMAND.sh start`.

Do not guess the query against your live schema. Inspect Module 21's actual query and adapt the example. `ATUMPUMP_DB_PATH` is opened read-only.

## Commands
```bash
./MASTER_COMMAND.sh install   # initialize local game DB
./MASTER_COMMAND.sh check     # configuration and runtime checks
./MASTER_COMMAND.sh demo      # run with synthetic demo feed
./MASTER_COMMAND.sh start     # run configured live feed
./MASTER_COMMAND.sh status    # show game status
./MASTER_COMMAND.sh dashboard # terminal spectator dashboard
./MASTER_COMMAND.sh test      # run tests
./MASTER_COMMAND.sh stop      # stop background service
./MASTER_COMMAND.sh pack      # create a fresh zip
```

## Spectator controls
- Press `S` in the dashboard to switch NPC profile.
- Press `Q` to exit the dashboard only; NPC service continues if separately running.
- NPCs run independently of the selected viewing profile.

## Strategy rules implemented
- Three consecutive closed bullish daily candles: Gate A.
- Twelve consecutive closed bullish daily candles: Gate B.
- Accelerated Gate C: three consecutive bullish daily candles, with each close at least 2x the previous close, and no bearish candle in the three-day sequence.
- EXPLODE DOMINANCE activates only after the third candle is closed and verified.
- Twelve-day confirmation remains separate from accelerated qualification.
- Golden ratio: `H - 0.618 * (H - L)` for a bullish impulse from swing low L to swing high H. Entry requires a later observed price at/under the level followed by a confirmed upward reversal.
- Position horizon: nine days maximum; strategy exits may occur earlier on trend-break conditions.
- Championship duration: 72 hours.
- Ten isolated NPC demo accounts.
- Event ledger uses SHA-256 hash chaining.

## Important candle convention
Daily candles are UTC calendar days. A candle is considered closed only after the next UTC midnight. The scanner uses actual OHLC observations supplied by the market adapter. It does not infer a daily candle from a single current price.

## Architecture
- `src/adapters/module21.js`: read-only ATUMPUMP feed adapter.
- `src/adapters/demo.js`: deterministic demo feed.
- `src/engine/scanner.js`: daily candle construction and candidate gates.
- `src/engine/strategy.js`: swing, golden-ratio, reversal and exits.
- `src/engine/trading.js`: simulated execution and portfolio accounting.
- `src/engine/championship.js`: 72-hour rounds and champion ranking.
- `src/engine/audit.js`: append-only SHA-256 event chain.
- `src/engine/game.js`: orchestrator and ten NPC profiles.
- `src/dashboard.js`: spectator terminal with S profile switching.
- `src/db.js`: persistent SQLite schema and queries.

## First-run behavior
The first initialization creates ten NPCs and a new 72-hour round. Each NPC starts with the configured demo balance. Existing game state is preserved on subsequent starts. To reset, manually back up and remove only `data/a_list.sqlite`; never point reset commands at the ATUMPUMP source database.
