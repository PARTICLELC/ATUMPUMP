from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("function championHolder()")
end = s.index("\nfunction watchlist()", start)

replacement = r'''
function championHolder() {
  title("03 — CHAMPION HOLDER");

  if (!exists("champion_holder")) {
    return console.log("Champion holder table unavailable.");
  }

  const rows = DB.prepare(`
    SELECT
      ch.*,
      t.name AS token_name,
      t.symbol AS token_symbol
    FROM champion_holder ch
    LEFT JOIN tokens t ON t.mint = ch.mint
  `).all();

  if (!rows.length) {
    console.log("No champion crowned yet.");
    return;
  }

  for (const row of rows) {
    console.log(`${C.gold}🏆 CHAMPION HOLDER${C.reset}`);
    console.log("--------------------------------------------");
    console.log(`TOKEN NAME: ${row.token_name || "NAME NOT FOUND"}`);
    console.log(`TOKEN TICKER: ${row.token_symbol || "TICKER NOT FOUND"}`);
    console.log(`MINT: ${row.mint}`);
    console.log(`SINCE: ${row.since_at}`);
    console.log(`ROUND: ${row.round_id}`);
  }
}
'''

s = s[:start] + replacement + s[end:]
p.write_text(s)
print("[APPLIED] Champion Holder now displays token name and ticker.")
