import fs from 'node:fs';

import { loadConfig } from './config.js';
import { openDatabase, initializeGame } from './db.js';

import { createDemoAdapter } from './adapters/demo.js';
import { createModule21Adapter } from './adapters/module21.js';

import { heartbeat } from './engine/game.js';
import { rebuildDailyCandles } from './engine/scanner.js';

import { dashboardLoop, renderDashboard } from './dashboard.js';
import { verifyAudit } from './engine/audit.js';

const config = loadConfig();

function usage() {
  console.log('Commands: install | check | demo | start | status | dashboard');
}

function setup() {
  const db = openDatabase(config.dbPath);
  initializeGame(db,config.startingBalance);
  return db;
}

const command = process.argv[2] || 'help';

if (command === 'install') {
  const db = setup();
  console.log(`A-LIST initialized: ${config.dbPath}`);
  db.close();

} else if (command === 'check') {
  console.log(`Node ${process.version}`);
  console.log(`Mode: ${config.mode}`);
  console.log(`Game DB: ${config.dbPath}`);

  if (config.mode === 'live') {
    if (!config.sourceDbPath) {
      throw new Error('Set ATUMPUMP_DB_PATH.');
    }

    if (!fs.existsSync(config.sourceDbPath)) {
      throw new Error('ATUMPUMP source database path does not exist.');
    }

    if (!fs.existsSync(config.sqlFile)) {
      throw new Error('Module 21 SQL file does not exist.');
    }

    console.log('Live source path and SQL file exist.');
  } else {
    console.log('Demo adapter selected.');
  }

} else if (command === 'status') {
  const db = setup();

  console.log(
    'NPC profiles:',
    db.prepare('SELECT COUNT(*) n FROM npc_profiles').get().n
  );

  console.log(
    'Pairs:',
    db.prepare('SELECT COUNT(*) n FROM pairs').get().n
  );

  console.log(
    'Observations:',
    db.prepare('SELECT COUNT(*) n FROM observations').get().n
  );

  console.log(
    'Open trades:',
    db.prepare("SELECT COUNT(*) n FROM trades WHERE status='OPEN'").get().n
  );

  console.log(
    'Dominance records:',
    db.prepare('SELECT COUNT(*) n FROM dominance').get().n
  );

  console.log('Audit:',verifyAudit(db));

  renderDashboard(db,1);
  db.close();

} else if (command === 'dashboard') {
  // Dashboard reads existing game state; never initialize or rewrite NPC profiles.
  const db = openDatabase(config.dbPath);
  try {
    await dashboardLoop(db);
  } finally {
    db.close();
  }

} else if (command === 'demo' || command === 'start') {
  // Existing live game: open without rerunning initializeGame().
  // Demo retains its normal initialization path.
  const db = command === 'start' && config.mode === 'live'
    ? openDatabase(config.dbPath)
    : setup();

  const adapter =
    config.mode === 'live' && command !== 'demo'
      ? createModule21Adapter(config)
      : createDemoAdapter();

  if (command === 'start' && config.mode !== 'live') {
    console.log(
      'A_LIST_MODE is not live; running demo adapter.'
    );
  }

  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;

    console.log('\nA-LIST STOPPING...');
    adapter.close?.();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT',stop);
  process.on('SIGTERM',stop);

  if (command === 'start' && config.mode === 'live') {
    console.log('A-LIST LIVE INITIALIZATION STARTED.');

    const imported = adapter.backfill(db);

    const candles = rebuildDailyCandles(
      db,
      Date.now(),
      true
    );

    console.log(`HISTORICAL OBSERVATIONS IMPORTED: ${imported}`);
    console.log(`HISTORICAL CANDLES BUILT: ${candles}`);
  }

  console.log(
    `A-LIST ${config.mode.toUpperCase()} ENGINE STARTED.`
  );

  console.log(`SCAN LIMIT: ${config.scanLimit}`);
  console.log(`HEARTBEAT: ${config.heartbeatMs}ms`);
  console.log('NPC EVALUATORS: 10');
  console.log('ENGINE MODE: CONTINUOUS');

  while (!stopping) {
    const started = Date.now();

    try {
      const result = await heartbeat(
        db,adapter,config
      );

      console.log(
        new Date().toISOString(),
        `pairs=${result.pairs}`,
        `ingested=${result.ingested}`,
        `dominance=${result.dominance.length}`,
        'npc_evaluations=10',
        result.championship
          ? `winner=NPC-${result.championship.winner.npc_id}`
          : ''
      );

    } catch (error) {
      console.error(
        'HEARTBEAT ERROR:',
        error.stack || error.message
      );
    }

    const elapsed = Date.now() - started;
    const wait = Math.max(
      0,
      config.heartbeatMs - elapsed
    );

    if (!stopping && wait > 0) {
      await new Promise(resolve => setTimeout(resolve,wait));
    }
  }

} else {
  usage();
}
