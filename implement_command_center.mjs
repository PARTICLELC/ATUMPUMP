import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const pidFile = path.join(root, "data", "market_service_pids.json");

const SERVICES = {
  discovery: {
    label: "INFINITE PAIR DISCOVERY",
    file: "src/infinite_pair_discovery.mjs",
    log: "logs/infinite_pair_discovery.log"
  },
  gecko: {
    label: "GECKOTERMINAL LIQUIDITY",
    file: "src/geckoterminal_liquidity.mjs",
    log: "logs/geckoterminal_liquidity.log"
  },
  dexscreener: {
    label: "DEXSCREENER LIQUIDITY REFRESH",
    file: "src/liquidity_refresh.mjs",
    log: "logs/liquidity_refresh.log"
  },
  capture: {
    label: "MARKET CAPTURE",
    file: "src/market_capture.mjs",
    log: "logs/market_capture.log"
  }
};

function readPids() {
  try {
    return JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return {};
  }
}

function savePids(pids) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify(pids, null, 2));
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function startService(key) {
  const service = SERVICES[key];
  if (!service) return;

  const pids = readPids();

  if (isRunning(pids[key])) {
    console.log(`[ONLINE] ${service.label} — PID ${pids[key]}`);
    return;
  }

  const script = path.join(root, service.file);

  if (!fs.existsSync(script)) {
    console.log(`[MISSING] ${service.label}: ${service.file}`);
    return;
  }

  fs.mkdirSync(path.dirname(path.join(root, service.log)), {
    recursive: true
  });

  const logFd = fs.openSync(path.join(root, service.log), "a");

  const child = spawn(process.execPath, [script], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });

  fs.closeSync(logFd);

  child.once("error", error => {
    console.error(`[START ERROR] ${service.label}: ${error.message}`);
  });

  child.unref();

  pids[key] = child.pid;
  savePids(pids);

  console.log(`[STARTED] ${service.label} — PID ${child.pid}`);
  console.log(`[LOG] ${service.log}`);
}

function startAllServices() {
  console.log("\n========== STARTING ALL MARKET SERVICES ==========");

  for (const key of Object.keys(SERVICES)) {
    startService(key);
  }

  console.log("==================================================");
}

function stopAllServices() {
  console.log("\n========== STOPPING CONTROLLED MARKET SERVICES ==========");

  const pids = readPids();

  for (const [key, service] of Object.entries(SERVICES)) {
    const pid = pids[key];

    if (!isRunning(pid)) {
      console.log(`[OFFLINE] ${service.label}`);
      delete pids[key];
      continue;
    }

    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`[STOP SIGNAL SENT] ${service.label} — PID ${pid}`);
      delete pids[key];
    } catch (error) {
      console.log(`[STOP ERROR] ${service.label}: ${error.message}`);
    }
  }

  savePids(pids);
  console.log("=========================================================");
}

function serviceStatus() {
  console.log("\n========== MARKET SERVICE STATUS ==========");

  const pids = readPids();

  for (const [key, service] of Object.entries(SERVICES)) {
    const pid = pids[key];

    console.log(
      `${service.label}: ${
        isRunning(pid) ? `ONLINE — PID ${pid}` : "OFFLINE"
      }`
    );
  }

  console.log("============================================");
}

function pairIntelligenceCenter() {
  title("12 — ATUMPUMP PAIR INTELLIGENCE CENTER");

  const registered = count("market_pairs");
  const active = exists("market_pairs")
    ? DB.prepare("SELECT COUNT(*) AS n FROM market_pairs WHERE active=1").get().n
    : 0;

  console.log("\n01 — PAIR REGISTRY");
  console.log(`Registered pairs: ${registered}`);
  console.log(`Active pairs: ${active}`);
  console.log(`Pair identities: ${count("pair_identity_history")}`);
  console.log(`Active identities: ${count("pair_identity_history")}`);

  console.log("\n02 — LIQUIDITY SOURCE COVERAGE");

  if (exists("market_pairs")) {
    const pairColumns = columns("market_pairs");

    if (pairColumns.includes("liquidity_source")) {
      const sources = DB.prepare(`
        SELECT liquidity_source, COUNT(*) AS pairs
        FROM market_pairs
        WHERE active=1 AND liquidity_source IS NOT NULL
        GROUP BY liquidity_source
        ORDER BY pairs DESC
      `).all();

      for (const source of sources) {
        console.log(`${source.liquidity_source}: ${source.pairs}`);
      }
    }

    if (pairColumns.includes("liquidity_usd")) {
      const total = DB.prepare(`
        SELECT SUM(liquidity_usd) AS total
        FROM market_pairs
        WHERE active=1
      `).get();

      console.log(`Latest reported liquidity: $${fmt(total.total)}`);

      console.log("\n03 — TOP REPORTED LIQUIDITY");

      const top = DB.prepare(`
        SELECT pair_address, liquidity_usd, last_seen_at
        FROM market_pairs
        WHERE active=1 AND liquidity_usd IS NOT NULL
        ORDER BY liquidity_usd DESC
        LIMIT 10
      `).all();

      for (const row of top) {
        console.log(
          `${row.pair_address} | $${fmt(row.liquidity_usd)} | ` +
          `${row.last_seen_at ?? "N/A"}`
        );
      }
    }
  }

  console.log("\n04 — OBSERVATION COUNTS");
  console.log(`Market pair observations: ${count("market_pair_observations")}`);
  console.log(`Liquidity observations: ${count("liquidity_source_observations")}`);
  console.log(`Pair change events: ${count("pair_change_events")}`);
  console.log(`Discovery events: ${count("discovery_events")}`);

  console.log("\n[ONLINE] PAIR INTELLIGENCE CENTER");
}
