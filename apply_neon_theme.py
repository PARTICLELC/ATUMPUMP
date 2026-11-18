from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

s = s.replace('cyan: "\\x1b[96m",', 'cyan: "\\x1b[97m",')
s = s.replace('gold: "\\x1b[93m",', 'gold: "\\x1b[92m",')
s = s.replace('green: "\\x1b[92m",', 'green: "\\x1b[92m",')
s = s.replace('red: "\\x1b[91m",', 'red: "\\x1b[97m",')

# Keep the existing module logic and route all former blue/gold references
# through the new white/neon-green global palette.
s = s.replace('C.cyan', 'C.white')
s = s.replace('C.gold', 'C.green')

# Live Round Watch local aliases follow the same palette.
s = s.replace('const cyan = C.white;', 'const cyan = C.white;')
s = s.replace('const gold = C.green;', 'const gold = C.green;')

p.write_text(s)
print("[APPLIED] Global palette: white + neon green. Blue and gold removed.")
