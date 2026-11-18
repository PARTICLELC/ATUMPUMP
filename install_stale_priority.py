from pathlib import Path

p = Path("src/market_capture.mjs")
s = p.read_text()

start = s.find("const getUnobservedTokens = db.prepare(`")
end = s.find("`);", start)

if start < 0 or end < 0:
    raise SystemExit("ABORT: scheduler not found")

section = s[start:end + 3]

old_never = "      ), 0) > 0 THEN 1"
old_stale = "      ), 0) > 0 THEN 2"

if section.count(old_never) != 1 or section.count(old_stale) != 1:
    raise SystemExit("ABORT: expected scheduler priorities not found exactly once")

section = section.replace(old_never, "      ), 0) > 0 THEN 2", 1)
section = section.replace(old_stale, "      ), 0) > 0 THEN 1", 1)

backup = p.with_suffix(".mjs.before_stale_priority")
backup.write_text(s)

p.write_text(s[:start] + section + s[end + 3:])

print("INSTALLED: stale high-volume tokens now precede never-observed tokens.")
print("BACKUP:", backup)
