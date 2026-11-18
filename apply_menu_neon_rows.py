from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.index("function showMenu() {")
end = s.index("\nasync function main()", start)
block = s[start:end]

labels = [
    " 1. LIVE MARKET SCANNER",
    " 2. 7.2-MINUTE LEADERBOARD",
    " 3. CHAMPION HOLDER",
    " 4. CHAMPIONSHIP WATCHLIST",
    " 5. TROPHY COLLECTION",
    " 6. HISTORICAL ROUND ARCHIVE",
    " 7. MARKET MOVEMENT ANALYTICS",
    " 8. SYSTEM DIAGNOSTICS",
    " 9. INFINITE PAIR DISCOVERY — START",
    "10. GECKOTERMINAL LIQUIDITY — START",
    "11. DEXSCREENER LIQUIDITY REFRESH — START",
    "12. PAIR INTELLIGENCE CENTER",
    "13. ALL MARKET SERVICES — START",
    "14. ALL CONTROLLED MARKET SERVICES — STOP",
    "15. MARKET SERVICE STATUS",
    "16. LIVE ROUND WATCH — START",
    " 0. EXIT",
]

for label in labels:
    old = f'  console.log("{label}");'
    new = f'  console.log(`${{C.green}}{label}${{C.reset}}`);'
    if block.count(old) != 1:
        raise SystemExit(f"[STOPPED] Could not uniquely locate: {label}")
    block = block.replace(old, new, 1)

# Four additional neon-green text rows; all other text stays white.
accent_rows = [
    '  console.log(`${C.white}       ATUMPUMP CHAMPIONSHIP CONTROL CENTER${C.reset}`);',
    '  console.log("============================================================");',
]
for old in accent_rows:
    if block.count(old) != 1:
        raise SystemExit("[STOPPED] Menu accent target not found uniquely.")

block = block.replace(
    accent_rows[0],
    '  console.log(`${C.green}       ATUMPUMP CHAMPIONSHIP CONTROL CENTER${C.reset}`);'
)
block = block.replace(
    accent_rows[1],
    '  console.log(`${C.green}============================================================${C.reset}`);',
    1
)

# Accent the separator above the menu and the separator below it.
block = block.replace(
    '  console.log("============================================================");',
    '  console.log(`${C.green}============================================================${C.reset}`);',
    1
)
# The bottom separator is the remaining plain separator.
block = block.replace(
    '  console.log("============================================================");',
    '  console.log(`${C.green}============================================================${C.reset}`);',
    1
)

s = s[:start] + block + s[end:]
p.write_text(s)
print("[APPLIED] All 17 numbered rows neon green; four additional menu accents neon green.")
