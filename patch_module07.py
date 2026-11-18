from pathlib import Path

path = Path("src/control_center.mjs")
source = path.read_text()

old = '''  const summary = DB.prepare(`
    SELECT
      COUNT(*) AS observations,
      COUNT(DISTINCT mint) AS unique_tokens,
      MIN(observed_at) AS first_observation,
      MAX(observed_at) AS latest_observation
    FROM price_observations
  `).get();

  console.log("OBSERVATION HISTORY");
  table([summary]);

  const movements = DB.prepare(`
    WITH ranked AS (
      SELECT mint, price_sol, observed_at,
        ROW_NUMBER() OVER (
          PARTITION BY mint ORDER BY observed_at ASC
        ) AS first_rank,
        ROW_NUMBER() OVER (
          PARTITION BY mint ORDER BY observed_at DESC
        ) AS last_rank
      FROM price_observations
      WHERE observed_at >= ?
    ),
    opening AS (
      SELECT mint, price_sol AS opening_price
      FROM ranked WHERE first_rank=1
    ),
    closing AS (
      SELECT mint, price_sol AS current_price
      FROM ranked WHERE last_rank=1
    )
    SELECT o.mint, o.opening_price, c.current_price,
      c.current_price-o.opening_price AS movement_sol
    FROM opening o JOIN closing c USING(mint)
    WHERE o.opening_price IS NOT NULL
      AND c.current_price IS NOT NULL
    ORDER BY movement_sol DESC
    LIMIT 20
  `).all(Date.now() - 86400000);

  console.log("\\n24-HOUR OBSERVED-WINDOW MOVEMENT");
  table(movements);'''

new = '''  const formatSol = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    return number.toFixed(18).replace(/\\\\.?0+$/, "");
  };

  const formatTimestamp = value => {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp).toLocaleString()
      : "N/A";
  };

  const field = (label, value) =>
    console.log(`${C.white}${label.padEnd(23)}${C.reset}${value}`);

  const summary = DB.prepare(`
    SELECT
      COUNT(*) AS observations,
      COUNT(DISTINCT mint) AS unique_tokens,
      MIN(observed_at) AS first_observation,
      MAX(observed_at) AS latest_observation
    FROM price_observations
  `).get();

  console.log(`\\\\n${C.green}OBSERVATION HISTORY${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);
  field("TOTAL OBSERVATIONS", Number(summary.observations).toLocaleString("en-US"));
  field("UNIQUE TOKENS", Number(summary.unique_tokens).toLocaleString("en-US"));
  field("FIRST OBSERVATION", formatTimestamp(summary.first_observation));
  field("LATEST OBSERVATION", formatTimestamp(summary.latest_observation));

  const windowStart = Date.now() - 86400000;
  const movements = DB.prepare(`
    WITH ranked AS (
      SELECT mint, price_sol, observed_at,
        ROW_NUMBER() OVER (
          PARTITION BY mint ORDER BY observed_at ASC
        ) AS first_rank,
        ROW_NUMBER() OVER (
          PARTITION BY mint ORDER BY observed_at DESC
        ) AS last_rank
      FROM price_observations
      WHERE observed_at >= ?
    ),
    opening AS (
      SELECT mint, price_sol AS opening_price
      FROM ranked WHERE first_rank=1
    ),
    closing AS (
      SELECT mint, price_sol AS current_price
      FROM ranked WHERE last_rank=1
    )
    SELECT o.mint, t.name, t.symbol,
      o.opening_price, c.current_price,
      c.current_price-o.opening_price AS movement_sol
    FROM opening o
    JOIN closing c USING(mint)
    LEFT JOIN tokens t ON t.mint=o.mint
    WHERE o.opening_price IS NOT NULL
      AND c.current_price IS NOT NULL
    ORDER BY movement_sol DESC
    LIMIT 20
  `).all(windowStart);

  const positiveCount = movements.filter(row => Number(row.movement_sol) > 0).length;
  const negativeCount = movements.filter(row => Number(row.movement_sol) < 0).length;
  const unchangedCount = movements.filter(row => Number(row.movement_sol) === 0).length;

  console.log(`\\\\n${C.green}24-HOUR OBSERVED-WINDOW MOVEMENT${C.reset}`);
  console.log(`${C.white}RANKED BY HIGHEST POSITIVE SOL MOVEMENT${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);
  field("WINDOW START", formatTimestamp(windowStart));
  field("WINDOW END", formatTimestamp(Date.now()));
  field("QUALIFIED PAIRS", movements.length);
  field("POSITIVE MOVERS", `${C.green}${positiveCount}${C.reset}`);
  field("NEGATIVE MOVERS", negativeCount);
  field("UNCHANGED", unchangedCount);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);

  if (!movements.length) {
    console.log(`${C.white}No qualifying price observations in the 24-hour window.${C.reset}`);
  }

  movements.forEach((row, index) => {
    const opening = Number(row.opening_price);
    const current = Number(row.current_price);
    const movement = Number(row.movement_sol);
    const gain = Number.isFinite(opening) && opening > 0 &&
      Number.isFinite(current)
      ? ((current / opening) - 1) * 100
      : null;
    const gainText = gain === null
      ? "N/A"
      : `${gain > 0 ? "+" : ""}${gain.toFixed(2)}%`;
    const movementColor = movement > 0
      ? C.green
      : movement < 0
        ? C.white
        : C.dim;

    console.log(`${C.green}#${String(index + 1).padStart(2, "0")}  ${row.symbol ?? "UNKNOWN"}${C.reset}  ${movementColor}${gainText}${C.reset}`);
    console.log(`${C.white}${row.name ?? "NAME NOT REGISTERED"}${C.reset}`);
    field("OPENING PRICE", `${formatSol(row.opening_price)} SOL`);
    field("CURRENT PRICE", `${formatSol(row.current_price)} SOL`);
    field("SOL MOVEMENT", `${movementColor}${formatSol(row.movement_sol)} SOL${C.reset}`);
    field("FULL MINT ADDRESS", row.mint);
    console.log(`${C.green}${"─".repeat(72)}${C.reset}`);
  });

  console.log(`${C.green}END OF 24-HOUR MOVEMENT REPORT${C.reset}`);
  console.log(`${C.white}Ranking and movement values use the existing observed-window price records.${C.reset}`);
  console.log(`${C.green}${"=".repeat(72)}${C.reset}`);'''

if old not in source:
    raise SystemExit("[STOP] Module 07 source block did not match. No changes written.")

source = source.replace(old, new, 1)
path.write_text(source)
print("[APPLIED] Module 07 analytics presentation upgraded.")
