from pathlib import Path

p = Path("src/control_center.mjs")
s = p.read_text()

replacements = [
(
'''      if (!response.ok) {
        console.log("[USD FEED] DexScreener HTTP " + response.status);
        continue;
      }''',
'''      if (!response.ok) {
        continue;
      }'''
),
(
'''    } catch (error) {
      console.log("[USD FEED ERROR] " + error.message);
    }''',
'''    } catch (error) {
      continue;
    }'''
),
(
'''        const opening = "$" + openingValue.toExponential(8);
        const current = "$" + currentValue.toExponential(8);
        const movement = `${movementValue >= 0 ? "+" : "-"}$${Math.abs(movementValue).toExponential(8)}`;''',
'''        const formatUsd = value => {
          const number = Number(value);
          if (!Number.isFinite(number)) return "N/A";
          return "$" + number.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: Math.abs(number) < 0.01 ? 18 : 2
          });
        };

        const opening = formatUsd(openingValue);
        const current = formatUsd(currentValue);
        const movement = `${movementValue >= 0 ? "+" : "-"}${formatUsd(Math.abs(movementValue))}`;'''
),
(
'''        const money = value =>
          Number.isFinite(value) && value > 0
            ? "$" + value.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})
            : "N/A";''',
'''        const money = value => {
          const number = Number(value);
          if (!Number.isFinite(number) || number <= 0) return "N/A";
          return "$" + number.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: number < 0.01 ? 18 : 2
          });
        };'''
),
(
'''    process.stdout.write("\\x1b[H" + frame + "\\n\\x1b[J");''',
'''    process.stdout.write("\\x1b[2J\\x1b[H" + frame + "\\n");'''
),
(
'''    } catch (error) {
      process.stderr.write(`\\n[USD REFRESH ERROR] ${error.message}\\n`);
    }''',
'''    } catch (error) {
      // Keep background refresh errors out of the live display.
    }'''
),
(
'''    } catch (error) {
      process.stderr.write(`\\n[LIVE WATCH ERROR] ${error.message}\\n`);
    }''',
'''    } catch (error) {
      // Keep renderer errors from corrupting the live display.
    }'''
)
]

for old, new in replacements:
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"[STOPPED] Expected one matching block, found {count}: {old[:90]!r}")
    s = s.replace(old, new, 1)

p.write_text(s)
print("[APPLIED] Clean full-screen redraw, quiet background USD feed, fixed-decimal USD formatting.")
