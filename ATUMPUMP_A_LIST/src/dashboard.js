import readline from 'node:readline';
import { markToMarket } from './engine/trading.js';
import { verifyAudit } from './engine/audit.js';
import { startAll, stopAll, getLiveStatus } from './control.js';
import { loadConfig } from './config.js';


async function startRound(db) {
  const now = Date.now();
  const ends = now + 72 * 3600000;
  db.prepare("UPDATE rounds SET status='closed' WHERE status='active'").run();
  db.prepare("INSERT INTO rounds(started_at, ends_at, status) VALUES(?,?, 'active')").run(now, ends);
  console.log("\n=== NEW ROUND STARTED ===");

  const { processNpc } = await import("./engine/trading.js");
  const rows = db.prepare(`
    SELECT o.mint, o.pair_address, o.price, o.observed_at, o.source
    FROM observations o
    JOIN (
      SELECT mint, pair_address, MAX(observed_at) t
      FROM observations
      GROUP BY mint, pair_address
    ) x ON x.mint = o.mint AND x.pair_address = o.pair_address AND x.t = o.observed_at
  `).all();
  const prices = new Map(rows.map(r => [r.mint + "|" + r.pair_address, r]));

  const config = { feeBps: 50, slippageBps: 25, maxPositionPct: 15, maxOpenPositions: 8, holdMs: 9*86400000 };
  for (let npc = 1; npc <= 10; npc++) processNpc(db, npc, config, prices, now);
  console.log("=== LIVE TRADING PASS COMPLETE ===");
}

const money=n=>`$${Number(n||0).toFixed(2)}`;




function renderLiveControl(db) {
  const config = loadConfig();
  const s = getLiveStatus(db, config);
  const show = (name, value) => console.log(`${name.padEnd(23)} ${value}`);

  console.log("\n================ LIVE SYSTEM CONTROL ================");
  show("A-LIST ENGINE", s.engine);
  show("ENGINE HEARTBEAT", s.engineHeartbeat);
  show("GECKOTERMINAL", s.gecko);
  show("GECKO PRICE FEED", s.geckoPrices);
  show("DISCOVERY SERVICE", s.discovery);
  show("ENGINE LAST UPDATE", s.engineLast);
  show("GECKO LAST PRICE", s.geckoLast);
  console.log("------------------------------------------------------");
  show("A-LIST OBSERVATIONS", `${s.gameObservations.total} total | ${s.gameObservations.fresh} last 5m`);
  show("A-LIST PAIRS UPDATED", s.gameObservations.pairs);
  show("SOURCE OBSERVATIONS", `${s.sourceObservations.total} total | ${s.sourceObservations.fresh} last 5m`);
  show("SOURCE PAIRS UPDATED", s.sourceObservations.pairs);
  if (s.gameObservations.error) show("GAME DB ERROR", s.gameObservations.error);
  if (s.sourceObservations.error) show("SOURCE DB ERROR", s.sourceObservations.error);
  console.log("======================================================");
  console.log("[A] START ALL   [X] STOP ALL   [L] LIVE STATUS");
}

export function renderDashboard(db, selected=1) {
  const pairNames = new Map(
    db.prepare('SELECT mint,pair_address,symbol,name FROM pairs').all()
      .map(r => [`${r.mint}|${r.pair_address}`, r])
  );
  const pairLabel = (r) => {
    const p = pairNames.get(`${r.mint}|${r.pair_address}`);
    if (!p) return r.mint;
    const symbol = String(p.symbol || '').trim();
    const name = String(p.name || '').trim();
    if (symbol && name) return `$${symbol} — ${name}`;
    if (symbol) return `$${symbol}`;
    if (name) return name;
    return r.mint;
  };
  const npc=db.prepare(`SELECT n.*,p.starting_cash,p.cash,p.realized_pnl FROM npc_profiles n
    JOIN portfolios p ON p.npc_id=n.id WHERE n.id=?`).get(selected);
  const prices=new Map(db.prepare(`SELECT o.mint,o.pair_address,o.price,o.observed_at,o.source,o.market_cap
    FROM observations o JOIN (SELECT mint,pair_address,MAX(observed_at) t FROM observations
    GROUP BY mint,pair_address) x ON x.mint=o.mint AND x.pair_address=o.pair_address AND x.t=o.observed_at`)
    .all().map(r=>[`${r.mint}|${r.pair_address}`,r]));
  const portfolio=markToMarket(db,selected,prices);
  const round=db.prepare("SELECT * FROM rounds WHERE status='active' ORDER BY id DESC LIMIT 1").get();
  const open=db.prepare("SELECT * FROM trades WHERE npc_id=? AND status='OPEN' ORDER BY entry_at DESC").all(selected);
  const closed=db.prepare("SELECT * FROM trades WHERE npc_id=? AND status='CLOSED' ORDER BY exit_at DESC LIMIT 8").all(selected);
  const dominance=db.prepare(`
    SELECT d.*
    FROM dominance d
    WHERE d.id = (
      SELECT x.id
      FROM dominance x
      WHERE x.mint=d.mint
        AND x.pair_address=d.pair_address
        AND x.state IN (
          '3 DAY CANDIDATE',
          '12 DAY CANDIDATE',
          'EXPLODE DOMINANCE'
        )
      ORDER BY
        CASE x.state
          WHEN 'EXPLODE DOMINANCE' THEN 3
          WHEN '12 DAY CANDIDATE' THEN 2
          WHEN '3 DAY CANDIDATE' THEN 1
          ELSE 0
        END DESC,
        x.id DESC
      LIMIT 1
    )
    ORDER BY d.activated_at DESC
    LIMIT 100
  `).all();
  const raw = db.prepare(`SELECT n.id,n.name,n.wins,n.xp,p.starting_cash,
    p.cash,p.realized_pnl FROM npc_profiles n JOIN portfolios p ON p.npc_id=n.id`).all();
  const leaderboard = raw.map(n => {
    const port = markToMarket(db, n.id, prices);
    const growth = port.equity - n.starting_cash;
    return { ...n, equity: port.equity, growth };
  }).sort((a,b) => b.growth - a.growth);
  const audit=verifyAudit(db);
  process.stdout.write("\x1b[H\x1b[J");
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║               ATUMPUMP — A-LIST SPECTATOR TERMINAL                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`PROFILE ${selected}/10  ${npc.name} | ${npc.strategy} | XP ${npc.xp} | WINS ${npc.wins}`);
  console.log(`CASH ${money(portfolio.cash)} | EQUITY ${money(portfolio.equity)} | REALIZED ${money(portfolio.realized)} | UNREALIZED ${money(portfolio.unrealized)}`);
  console.log(`ROUND ${round?.id ?? '-'} | ENDS ${round?new Date(round.ends_at).toISOString():'-'}`);
  console.log('\nOPEN TRADES');
  console.table(open.map(t=>{
    const obs = prices.get(t.mint+"|"+t.pair_address);
    const current = obs?.price || t.entry_price;
    const gain = (current - t.entry_price) * t.quantity - (t.entry_fee || 0);
    return {
      pair: pairLabel(t),
      entry: Number(t.entry_price).toExponential(4),
      now: obs?.price ? Number(obs.price).toExponential(4) : "-",
      qty: Number(t.quantity).toExponential(2),
      mcap: obs?.market_cap ? ("$"+Number(obs.market_cap).toLocaleString()) : "-",
      gain: (gain>=0?"+":"")+gain.toFixed(2),
      opened: new Date(t.entry_at).toISOString().slice(0,19)
    };
  }));
  console.log('RECENT CLOSED TRADES');
  console.table(closed.map(t=>({pair:pairLabel(t),entry:t.entry_price,exit:t.exit_price,pnl:t.realized_pnl,reason:t.exit_reason})));
  console.log('DOMINANCE RADAR');
  console.table(dominance.map(d=>{
    const obs = prices.get(d.mint+"|"+d.pair_address);
    return {
      pair: pairLabel(d),
      state: d.state,
      gate: d.gate,
      mcap: obs?.market_cap ? ("$"+Number(obs.market_cap).toLocaleString()).padEnd(16) : "-".padEnd(16),
      activated: new Date(d.activated_at).toISOString()
    };
  }));
  console.log('CHAMPION HOLDER LEADERBOARD — WINS');
  console.table(leaderboard.map((n,i)=>({rank:i+1,npc:n.name,growth:money(n.growth),equity:money(n.equity),cash:money(n.cash)})));
  console.log(`AUDIT CHAIN: ${audit.valid?'VALID':'FAILED'} | EVENTS ${audit.count}`);
  console.log('\n[S] NEXT NPC PROFILE    [R] START ROUND    [Q] QUIT DASHBOARD');
  renderLiveControl(db);
}


export async function dashboardLoop(db) {
  let selected = 1;
  let busy = false;

  const render = () => {
    renderDashboard(db, selected);
  };

  render();
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const live = setInterval(() => { if (!busy) render(); }, 6000);

  return new Promise(resolve => {
    const onKey = async key => {
      const k = key.toLowerCase();
      if (busy) return;

      if (k === "r") {
        busy = true;
        try { await startRound(db); }
        finally { busy = false; render(); }
      } else if (k === "s") {
        selected = selected % 10 + 1;
        render();
      } else if (k === "a") {
        busy = true;
        console.log("\n[CONTROL] STARTING LIVE SERVICES...");
        try {
          const result = startAll();
          console.log(result);
        } catch (e) {
          console.error("[START ERROR]", e.message);
        }
        busy = false;
        render();
      } else if (k === "x") {
        busy = true;
        console.log("\n[CONTROL] STOPPING MANAGED SERVICES...");
        try {
          console.log(stopAll());
        } catch (e) {
          console.error("[STOP ERROR]", e.message);
        }
        busy = false;
        render();
      } else if (k === "l") {
        render();
      } else if (k === "q" || key === "\u0003") {
        clearInterval(live);
        process.stdin.off("keypress", onKey);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        resolve();
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

// START ROUND handler added below
