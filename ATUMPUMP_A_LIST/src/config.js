import path from 'node:path';

export function loadConfig() {
  const mode = process.env.A_LIST_MODE || 'demo';

  return {
    mode,

    dbPath: path.resolve(
      process.env.A_LIST_DB_PATH || './data/a_list.sqlite'
    ),

    sourceDbPath: process.env.ATUMPUMP_DB_PATH
      ? path.resolve(process.env.ATUMPUMP_DB_PATH)
      : '',

    sqlFile: path.resolve(
      process.env.MODULE21_SQL_FILE || './config/module21.example.sql'
    ),

    startingBalance: Number(
      process.env.A_LIST_STARTING_BALANCE || 10000
    ),

    heartbeatMs: Math.max(
      1000,
      Number(process.env.A_LIST_HEARTBEAT_MS || 5000)
    ),

    scanLimit: Math.max(
      1,
      Number(process.env.A_LIST_SCAN_LIMIT || 20000)
    ),

    feeBps: Number(process.env.A_LIST_FEE_BPS || 50),
    slippageBps: Number(process.env.A_LIST_SLIPPAGE_BPS || 25),

    maxPositionPct: Number(
      process.env.A_LIST_NPC_MAX_POSITION_PCT || 15
    ),

    maxOpenPositions: Number(
      process.env.A_LIST_MAX_OPEN_POSITIONS || 8
    ),

    roundMs: Number(
      process.env.A_LIST_ROUND_HOURS || 72
    ) * 3600000,

    holdMs: Number(
      process.env.A_LIST_HOLD_DAYS || 9
    ) * 86400000
  };
}
