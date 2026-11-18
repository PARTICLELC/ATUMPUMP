from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

start = s.rfind('console.log(`${C.white}`);')
if start < 0:
    raise SystemExit("[STOPPED] Could not locate the ATUM banner.")

marker = "ATUMPUMP CHAMPIONSHIP CONTROL CENTER"
pos = s.find(marker, start)
if pos < 0:
    raise SystemExit("[STOPPED] Could not locate the Control Center title.")

end = s.find("\n", pos)
if end < 0:
    end = len(s)

logo = r'''
  █████╗ ████████╗██╗   ██╗███╗   ███╗██████╗ ██╗   ██╗███╗   ███╗██████╗
 ██╔══██╗╚══██╔══╝██║   ██║████╗ ████║██╔══██╗██║   ██║████╗ ████║██╔══██╗
 ███████║   ██║   ██║   ██║██╔████╔██║██████╔╝██║   ██║██╔████╔██║██████╔╝
 ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║██╔═══╝ ██║   ██║██║╚██╔╝██║██╔═══╝
 ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║██║     ╚██████╔╝██║ ╚═╝ ██║██║
 ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝      ╚═════╝ ╚═╝     ╚═╝╚═╝
'''

replacement = (
    'console.log(`${C.green}' + logo + '${C.reset}`);'
    '\n  console.log(`${C.white}       ATUMPUMP CHAMPIONSHIP CONTROL CENTER${C.reset}`);'
)

s = s[:start] + replacement + s[end:]
p.write_text(s)

print("[APPLIED] ATUMPUMP unified logo — neon green; subtitle white.")
