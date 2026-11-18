from pathlib import Path

path = Path("src/championship_engine.mjs")
source = path.read_text()

old = """      sql.setHolder.run(winner.mint, now, round.id);
      sql.watchlist.run(winner.mint, now);
      sql.event.run(round.id, winner.mint, now, winner.movement_sol);"""

new = """      sql.setHolder.run(winner.mint, now, round.id);

      const winnerGainPercent =
        winner.opening_price_sol > 0 && winner.closing_price_sol > 0
          ? ((winner.closing_price_sol / winner.opening_price_sol) - 1) * 100
          : null;

      if (
        winnerGainPercent !== null &&
        Number.isFinite(winnerGainPercent) &&
        winnerGainPercent >= 80
      ) {
        sql.watchlist.run(winner.mint, now);
        console.log(
          "[WATCHLIST ADDED] Champion gain:",
          winnerGainPercent.toFixed(2) + "%"
        );
      } else {
        console.log(
          "[WATCHLIST SKIPPED] Champion gain:",
          winnerGainPercent === null
            ? "UNAVAILABLE"
            : winnerGainPercent.toFixed(2) + "%",
          "| Required: +80.00%"
        );
      }

      sql.event.run(round.id, winner.mint, now, winner.movement_sol);"""

if source.count(old) != 1:
    raise SystemExit("PATCH STOPPED: Expected champion insertion block not found exactly once.")

path.write_text(source.replace(old, new))
print("[APPLIED] Championship Watchlist requires +80% or higher round gain.")
