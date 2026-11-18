# Data model
The SQLite schema is created by `src/db.js`. It separates market observations, derived daily candles, dominance states, NPC accounts, orders/trades, championships, achievements, pattern history, and audit events.

`observations` are append-only source observations. `daily_candles` are derived UTC OHLC records. Only completed UTC days (`closed=1`) qualify for dominance. `trades` represent demo fills only and retain source + source observation time. `audit_events` form a SHA-256 linked chain.

The source ATUMPUMP database is never modified by the adapter.
