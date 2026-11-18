from pathlib import Path

file = Path("src/control_center.mjs")
source = file.read_text()

start = source.index("function watchlist() {")
end = source.find("\nfunction ", start + 1)

if end == -1:
    raise SystemExit("STOP: Watchlist function boundary not found.")

section = source[start:end]

# Convert the existing renderer into a reusable refresh function.
section = section.replace(
    '  title("04 — CHAMPIONSHIP WATCHLIST");',
    '  const renderWatchlist = () => {\n    console.clear();\n    title("04 — CHAMPIONSHIP WATCHLIST");',
    1
)

# Indent the existing renderer body inside the callback.
lines = section.splitlines()
opening = lines[0]
closing = lines[-1]
body = lines[1:-1]

# Close the renderer after the existing output loop.
if not any("LIVE GAIN PERCENTAGE:" in line for line in body):
    raise SystemExit("STOP: LIVE GAIN display not found.")

if not any("rows.sort(" in line for line in body):
    raise SystemExit("STOP: Gain hierarchy sort not found.")

# The original function ends after the row-rendering loop.
section = "\n".join([opening] + body + [
    "  };",
    "",
    "  renderWatchlist();",
    '  console.log("\\n[LIVE] Watchlist refreshes every 72 seconds.");',
    '  console.log("[CONTROL] Press ENTER to return to Control Center.");',
    "",
    "  const refresh = setInterval(() => {",
    "    try {",
    "      renderWatchlist();",
    '      console.log("\\n[LIVE] Next refresh in 72 seconds.");',
    "    } catch (error) {",
    '      console.log(`[WATCHLIST REFRESH ERROR] ${error.message}`);',
    "    }",
    "  }, 72000);",
    "",
    "  try {",
    '    await ask("");',
    "  } finally {",
    "    clearInterval(refresh);",
    "  }",
    "}"
])

source = source[:start] + section + source[end:]
file.write_text(source)

print("[APPLIED] Module 04 live refresh: 72 seconds.")
print("[APPLIED] Gain hierarchy recalculated on every refresh.")
print("[APPLIED] ENTER returns to Control Center.")
