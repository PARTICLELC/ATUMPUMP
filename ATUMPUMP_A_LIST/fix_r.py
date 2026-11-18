from pathlib import Path
p = Path("src/dashboard.js")
text = p.read_text()

start = text.find("function startRound")
end = text.find("const money=")
old_start = text[start:end]

new_start = '''async function startRound(db) {
  const now = Date.now();
  const ends = now + 72 * 3600000;
  db.prepare("UPDATE rounds SET status='closed' WHERE status='active'").run();
  db.prepare("INSERT INTO rounds(started_at, ends_at, status) VALUES(?,?, 'active')").run(now, ends);
  console.log("\\n=== NEW ROUND STARTED ===");

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

'''

text = text.replace(old_start, new_start)
text = text.replace(
    "if(key.toLowerCase()==='r') { startRound(db); renderDashboard(db,selected); return; }",
    "if(key.toLowerCase()==='r') { startRound(db).then(() => renderDashboard(db,selected)); return; }"
)
p.write_text(text)
print("Clean patch applied")
