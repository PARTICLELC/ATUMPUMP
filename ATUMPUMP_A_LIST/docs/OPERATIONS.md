# Operations and recovery
1. Back up `data/a_list.sqlite` before upgrades.
2. Stop the A-LIST process before replacing source files.
3. Never use the ATUMPUMP source database as `A_LIST_DB_PATH`.
4. Set `ATUMPUMP_DB_PATH` read-only source and adapt Module 21 SQL.
5. Confirm UTC candle boundaries and source timestamps are milliseconds.
6. Check `audit_events` integrity with `node src/cli.js status`.
7. A missing live feed does not create fills. Heartbeat errors are logged and retried.
8. Demo mode is synthetic and must never be mixed with live-mode reporting.
