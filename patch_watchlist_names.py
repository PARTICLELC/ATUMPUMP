from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("function watchlist()")
end = s.index("\nfunction ", start + 1)

replacement = r'''
function watchlist() {
  title("04 — CHAMPIONSHIP WATCHLIST");

  if (!exists("championship_watchlist")) {
    return console.log("Watchlist table unavailable.");
  }

  const rows = DB.prepare(`
    SELECT
      w.*,
      t.name AS token_name,
      t.symbol AS token_symbol
    FROM championship_watchlist w
    LEFT JOIN tokens t ON t.mint = w.mint
    ORDER BY w.rowid DESC
  `).all();

  console.log(`Watchlist records: ${rows.length}`);

  if (!rows.length) {
    console.log("No watchlist records.");
    return;
  }

  for (const row of rows) {
    console.log("--------------------------------------------");
    console.log(`TOKEN NAME: ${row.token_name || "NAME NOT REGISTERED"}`);
    console.log(`TOKEN TICKER: ${row.token_symbol || "TICKER NOT REGISTERED"}`);
    console.log(`MINT: ${row.mint}`);
    console.log(`ADDED AT: ${row.added_at}`);
    console.log(`REASON: ${row.reason}`);
  }
}
'''

s = s[:start] + replacement + s[end:]
p.write_text(s)
print("[APPLIED] Watchlist now displays token names and tickers.")
