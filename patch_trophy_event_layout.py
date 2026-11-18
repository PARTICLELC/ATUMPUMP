from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

old = '''    const events = DB.prepare(`
      SELECT * FROM championship_events
      ORDER BY id DESC LIMIT 30
    `).all();
    table(events);'''

new = '''    const events = DB.prepare(`
      SELECT
        e.id,
        e.round_id,
        e.mint,
        t.name,
        t.symbol,
        e.awarded_at,
        e.trophy_increment,
        e.movement_sol,
        CASE
          WHEN re.opening_price_sol > 0
            AND re.closing_price_sol > 0
          THEN ((re.closing_price_sol / re.opening_price_sol) - 1) * 100
          ELSE NULL
        END AS gain_percent,
        re.opening_price_sol,
        re.closing_price_sol,
        t.pair_address
      FROM championship_events e
      LEFT JOIN tokens t ON t.mint = e.mint
      LEFT JOIN round_entries re
        ON re.round_id = e.round_id AND re.mint = e.mint
      ORDER BY e.id DESC
      LIMIT 30
    `).all();

    console.log("RECENT CHAMPIONSHIP WINNERS — FULL TOKEN IDENTITY");
    console.log("GAIN = ROUND CLOSING PRICE VS ROUND OPENING PRICE");
    console.log("------------------------------------------------------------");

    if (!events.length) {
      console.log("No championship trophy events recorded.");
    }

    for (const event of events) {
      const gain = Number(event.gain_percent);
      const gainText = Number.isFinite(gain)
        ? `${gain >= 0 ? "+" : ""}${gain.toFixed(2)}%`
        : "N/A";
      const awardedAt = Number(event.awarded_at);

      console.log("------------------------------------------------------------");
      console.log(`EVENT ID: ${event.id}`);
      console.log(`ROUND: ${event.round_id}`);
      console.log(`EXACT TOKEN NAME: ${event.name ?? "NAME NOT REGISTERED"}`);
      console.log(`TOKEN TICKER: ${event.symbol ?? "SYMBOL NOT REGISTERED"}`);
      console.log(`FULL MINT ADDRESS: ${event.mint}`);
      console.log(`ROUND GAIN: ${gainText}`);
      console.log(`OPENING PRICE: ${event.opening_price_sol ?? "N/A"} SOL`);
      console.log(`CLOSING PRICE: ${event.closing_price_sol ?? "N/A"} SOL`);
      console.log(`MOVEMENT: ${event.movement_sol} SOL`);
      console.log(`TROPHIES AWARDED: +${event.trophy_increment}`);
      console.log(`PAIR ADDRESS: ${event.pair_address ?? "PAIR NOT REGISTERED"}`);
      console.log(`AWARDED AT: ${
        Number.isFinite(awardedAt) && awardedAt > 0
          ? new Date(awardedAt).toLocaleString()
          : "N/A"
      }`);
    }
    console.log("------------------------------------------------------------");'''

if old not in s:
    raise SystemExit("[STOPPED] Trophy event block did not match. No changes written.")

p.write_text(s.replace(old, new, 1))
print("[APPLIED] Trophy event layout: exact token name, ticker, mint, round gain, prices, movement, trophy count, pair, timestamp.")
