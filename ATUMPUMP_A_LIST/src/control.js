
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const HOME = os.homedir();
const MAIN = path.join(HOME, "ATUMPUMP");
const ALIST = path.join(MAIN, "ATUMPUMP_A_LIST");
const REGISTRY = path.join(MAIN, "data/market_service_pids.json");
const ENGINE_PID = path.join(ALIST, "data/live_engine.pid");
const ENGINE_LOG = path.join(ALIST, "logs/live_engine.log");
const GECKO_LOG = path.join(MAIN, "logs/geckoterminal_liquidity.log");
const DISCOVERY_LOG = path.join(MAIN, "logs/infinite_pair_discovery.log");

const readRegistry = () => {
  try { return JSON.parse(fs.readFileSync(REGISTRY, "utf8")); }
  catch { return {}; }
};

const writeRegistry = value => {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(value, null, 2));
};

function commandLine(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
  } catch { return ""; }
}

function alive(pid, expected) {
  if (!pid || !/^\d+$/.test(String(pid))) return false;
  const cmd = commandLine(pid);
  return !!cmd && cmd.includes(expected);
}

function getPid(file, registryKey, expected) {
  let pid = 0;
  try { pid = Number(fs.readFileSync(file, "utf8").trim()); } catch {}
  if (alive(pid, expected)) return pid;

  const registry = readRegistry();
  pid = Number(registry[registryKey] || 0);
  return alive(pid, expected) ? pid : 0;
}

function launch(name, cwd, args, pidFile, expected) {
  const existing = getPid(pidFile, name, expected);
  if (existing) return { pid: existing, started: false };

  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  const child = spawn(process.execPath, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  if (!child.pid) throw new Error(`${name}: process launch failed`);
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));

  if (name === "gecko" || name === "discovery") {
    const registry = readRegistry();
    registry[name] = child.pid;
    writeRegistry(registry);
  }
  return { pid: child.pid, started: true };
}

function stop(pid, expected) {
  if (!alive(pid, expected)) return "NOT RUNNING";
  try {
    process.kill(pid, "SIGTERM");
    return "STOP SIGNAL SENT";
  } catch (e) {
    return `STOP ERROR: ${e.message}`;
  }
}

function stopDiscovery() {
  const registry = readRegistry();
  const pid = Number(registry.discovery || 0);
  const result = stop(pid, "infinite_pair_discovery.mjs");
  if (result !== "NOT RUNNING") {
    delete registry.discovery;
    writeRegistry(registry);
  }
  return result;
}

export function startAll() {
  // The discovery script also calls a DexScreener profile endpoint.
  // It is intentionally disabled.
  const discovery = stopDiscovery();

  const gecko = launch(
    "gecko",
    MAIN,
    ["src/geckoterminal_liquidity.mjs"],
    path.join(MAIN, "data/gecko_service.pid"),
    "geckoterminal_liquidity.mjs"
  );

  const engine = launch(
    "engine",
    ALIST,
    ["--env-file=.env", "src/cli.js", "start"],
    ENGINE_PID,
    "src/cli.js start"
  );

  return {
    discovery,
    gecko: `${gecko.started ? "STARTED" : "ALREADY ACTIVE"} PID ${gecko.pid}`,
    engine: `${engine.started ? "STARTED" : "ALREADY ACTIVE"} PID ${engine.pid}`
  };
}

export function stopAll() {
  const enginePid = getPid(ENGINE_PID, "engine", "src/cli.js start");
  const geckoPid = getPid(
    path.join(MAIN, "data/gecko_service.pid"),
    "gecko",
    "geckoterminal_liquidity.mjs"
  );

  const result = {
    engine: stop(enginePid, "src/cli.js start"),
    gecko: stop(geckoPid, "geckoterminal_liquidity.mjs"),
    discovery: stopDiscovery()
  };

  const registry = readRegistry();
  delete registry.gecko;
  delete registry.discovery;
  writeRegistry(registry);

  return result;
}

function latestLogTime(file, pattern) {
  try {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").reverse();
    const line = lines.find(x => pattern.test(x));
    if (!line) return 0;
    const match = line.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/);
    if (match) return Date.parse(match[0]);
    return fs.statSync(file).mtimeMs;
  } catch { return 0; }
}

function observationStats(dbPath, table, timeColumn = "observed_at") {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const result = db.prepare(`
      SELECT COUNT(*) AS total,
             COUNT(DISTINCT mint || '|' || pair_address) AS pairs,
             MAX(${timeColumn}) AS latest,
             SUM(CASE WHEN ${timeColumn} >= ? THEN 1 ELSE 0 END) AS fresh
      FROM ${table}
    `).get(Date.now() - 300000);

    return {
      total: Number(result.total || 0),
      pairs: Number(result.pairs || 0),
      latest: Number(result.latest || 0),
      fresh: Number(result.fresh || 0)
    };
  } catch (e) {
    return { error: e.message, total: 0, pairs: 0, latest: 0, fresh: 0 };
  } finally {
    try { db?.close(); } catch {}
  }
}

const stamp = value => value
  ? new Date(value).toLocaleTimeString()
  : "NO DATA";

function serviceState(pid, expected) {
  return alive(pid, expected) ? "ACTIVE" : "STOPPED";
}

export function getLiveStatus(gameDb, config) {
  const enginePid = getPid(ENGINE_PID, "engine", "src/cli.js start");
  const geckoPid = getPid(
    path.join(MAIN, "data/gecko_service.pid"),
    "gecko",
    "geckoterminal_liquidity.mjs"
  );
  const registry = readRegistry();
  const discoveryPid = Number(registry.discovery || 0);
  const discoveryActive = alive(discoveryPid, "infinite_pair_discovery.mjs");

  const game = observationStats(config.dbPath, "observations");
  const source = config.sourceDbPath
    ? observationStats(config.sourceDbPath, "market_pair_observations")
    : { error: "SOURCE DB NOT CONFIGURED", total: 0, pairs: 0, latest: 0, fresh: 0 };

  const engineLog = latestLogTime(ENGINE_LOG, /pairs=.*ingested=/);
  const geckoLog = latestLogTime(GECKO_LOG, /\[GECKO PRICE\]/);

  const engineFresh = engineLog > 0 && Date.now() - engineLog < 30000;
  const geckoFresh = geckoLog > 0 && Date.now() - geckoLog < 300000;

  const audit = {
    engine: serviceState(enginePid, "src/cli.js start"),
    engineHeartbeat: engineFresh ? "LIVE" : "STALE",
    gecko: serviceState(geckoPid, "geckoterminal_liquidity.mjs"),
    geckoPrices: geckoFresh ? "LIVE" : "STALE",
    discovery: discoveryActive ? "ACTIVE — DISABLE" : "OFF (DEXSCREENER BLOCKED)",
    gameObservations: game,
    sourceObservations: source,
    engineLast: stamp(engineLog),
    geckoLast: stamp(geckoLog)
  };

  return audit;
}
