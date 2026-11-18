from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

old = '''        const medal = index === 0 ? "🏆" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${String(index + 1).padStart(2, " ")} `;
        const gainColor = percent > 0 ? green : percent < 0 ? red : cyan;

        log(
          `${gold}${medal}${reset} ${cyan}${symbol.padEnd(13)}${reset} ${gainColor}${gain.padEnd(11)}${reset} ${opening.padEnd(20)} ${current.padEnd(20)} ${gainColor}${movement}${reset}`
        );
        log(`     ${cyan}MINT:${reset} ${entry.mint}`);
        log(`     ${cyan}PAIR:${reset} ${entry.pair_address ?? "N/A"}`);'''

new = '''        const medal = index === 0 ? "🏆" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${String(index + 1).padStart(2, " ")} `;
        const gainColor = percent > 0 ? green : percent < 0 ? red : cyan;

        const identity = DB.prepare(`
          SELECT name, symbol, pair_address, market_cap, fdv,
                 volume_h24, liquidity_usd
          FROM tokens
          LEFT JOIN market_pairs USING(mint)
          WHERE tokens.mint = ?
          ORDER BY market_pairs.liquidity_usd DESC
          LIMIT 1
        `).get(entry.mint) ?? {};

        const tokenName = String(identity.name ?? entry.name ?? "NAME NOT REGISTERED");
        const ticker = String(identity.symbol ?? entry.symbol ?? symbol);
        const marketCap = Number(identity.market_cap ?? identity.fdv);
        const volume24h = Number(identity.volume_h24);
        const liquidity = Number(identity.liquidity_usd);

        const money = value =>
          Number.isFinite(value) && value > 0
            ? "$" + value.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})
            : "N/A";

        log("");
        log(`${gold}╔══════════════════════════════════════════════════════════════════════╗${reset}`);
        log(`${gold}║ ${medal} ${tokenName.slice(0, 58).padEnd(58)} ║${reset}`);
        log(`${gold}╚══════════════════════════════════════════════════════════════════════╝${reset}`);
        log(`${cyan}TOKEN TICKER:${reset}       ${ticker}`);
        log(`${cyan}ROUND RANK:${reset}         #${index + 1}`);
        log(`${cyan}ROUND GAIN:${reset}         ${gainColor}${gain}${reset}`);
        log(`${cyan}OPENING PRICE USD:${reset}  ${opening}`);
        log(`${cyan}CURRENT PRICE USD:${reset} ${current}`);
        log(`${cyan}MOVEMENT USD:${reset}      ${gainColor}${movement}${reset}`);
        log(`${cyan}MARKET CAPITALIZATION:${reset} ${money(marketCap)}`);
        log(`${cyan}24H TRADING VOLUME:${reset}    ${money(volume24h)}`);
        log(`${cyan}LIQUIDITY USD:${reset}         ${money(liquidity)}`);
        log(`${cyan}FULL MINT ADDRESS:${reset} ${entry.mint}`);
        log(`${cyan}PAIR ADDRESS:${reset}      ${entry.pair_address ?? identity.pair_address ?? "N/A"}`);
        log(`${gold}${"─".repeat(74)}${reset}`);'''

if old not in s:
    raise SystemExit("[STOPPED] Live-round profile block did not match. No changes written.")

s = s.replace(old, new, 1)
p.write_text(s)
print("[APPLIED] Professional live-round token profiles with name, ticker, rank, gain, USD prices, movement, market cap, 24H volume, liquidity, mint and pair.")
