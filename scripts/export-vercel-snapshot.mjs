import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const dbPath = process.env.ATUMPUMP_DB || path.join(root, 'data', 'atumpump.sqlite');
const outDir = path.join(root, 'public', 'data');
const outFile = path.join(outDir, 'leaderboard.json');
const now = Date.now();
const iso = new Date(now).toISOString();

if (!fs.existsSync(dbPath)) {
  console.error(`DATABASE NOT FOUND: ${dbPath}`);
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const tableNames = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table'"
).all().map(x => x.name);

const has = name => tableNames.includes(name);
const safeAll = (sql, params = []) => {
  try { return db.prepare(sql).all(...params); }
  catch (e) {
    console.warn(`QUERY SKIPPED: ${e.message}`);
    return [];
  }
};
const n = value => {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
};
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const first = (obj, keys) => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return null;
};

const marketRows = safeAll(`
  SELECT
    t.mint,
    t.name,
    t.symbol,
    t.discovery_source,
    t.eligible,
    p.pair_address,
    p.dex_id,
    p.pair_url,
    p.price_sol,
    p.liquidity_usd,
    p.volume_h24,
    p.fdv,
    p.market_cap,
    p.pair_created_at,
    p.first_seen_at,
    p.last_seen_at,
    p.active,
    COALESCE(o.price_sol, p.price_sol) AS latest_price_sol,
    COALESCE(o.liquidity_usd, p.liquidity_usd) AS latest_liquidity_usd,
    COALESCE(o.volume_h24, p.volume_h24) AS latest_volume_h24,
    COALESCE(o.fdv, p.fdv) AS latest_fdv,
    COALESCE(o.market_cap, p.market_cap) AS latest_market_cap,
    po.price_usd,
    po.sol_usd,
    base.price_sol AS baseline_price_sol,
    av.volume_usd AS all_time_volume_usd,
    av.trade_count AS all_time_trade_count,
    cs.trophy_count,
    cs.consecutive_wins,
    cs.appearances,
    cs.podium_finishes,
    cs.best_movement_sol,
    la.tier AS legendary_tier,
    la.direction AS legendary_direction,
    la.matching_rounds AS legendary_matching_rounds
  FROM tokens t
  JOIN market_pairs p ON p.mint = t.mint
  LEFT JOIN market_pair_observations o
    ON o.id = (
      SELECT o2.id
      FROM market_pair_observations o2
      WHERE o2.pair_address = p.pair_address
      ORDER BY o2.observed_at DESC, o2.id DESC
      LIMIT 1
    )
  LEFT JOIN price_observations po
    ON po.id = (
      SELECT po2.id
      FROM price_observations po2
      WHERE po2.mint = t.mint
      ORDER BY po2.observed_at DESC, po2.id DESC
      LIMIT 1
    )
  LEFT JOIN market_pair_observations base
    ON base.id = (
      SELECT b.id
      FROM market_pair_observations b
      WHERE b.pair_address = p.pair_address
        AND b.observed_at >= ?
        AND b.observed_at <= ?
        AND b.price_sol > 0
      ORDER BY b.observed_at ASC, b.id ASC
      LIMIT 1
    )
  LEFT JOIN token_all_time_volume av ON av.mint = t.mint
  LEFT JOIN champion_stats cs ON cs.mint = t.mint
  LEFT JOIN legendary_awards la ON la.mint = t.mint
  WHERE COALESCE(p.active, 1) = 1
    AND t.mint IS NOT NULL
    AND length(trim(t.mint)) > 20
    AND t.name IS NOT NULL
    AND length(trim(t.name)) > 0
  ORDER BY p.last_seen_at DESC
`, [now - 86400000, now]);

const byMint = new Map();

for (const row of marketRows) {
  const mint = clean(row.mint);
  if (!mint) continue;

  const latestPrice = n(row.latest_price_sol);
  const baselinePrice = n(row.baseline_price_sol);
  const change = baselinePrice > 0 && latestPrice !== null
    ? ((latestPrice - baselinePrice) / baselinePrice) * 100
    : null;

  const token = {
    mint,
    name: clean(row.name),
    symbol: clean(row.symbol),
    pair_address: row.pair_address,
    dex_id: row.dex_id,
    pair_url: row.pair_url,
    discovery_source: row.discovery_source,
    eligible: Boolean(row.eligible),
    price_sol: latestPrice,
    price_usd: n(row.price_usd),
    sol_usd: n(row.sol_usd),
    change_24h: change,
    market_cap: n(row.latest_market_cap),
    fdv: n(row.latest_fdv),
    volume_24h: n(row.latest_volume_h24),
    liquidity_usd: n(row.latest_liquidity_usd),
    all_time_volume_usd: n(row.all_time_volume_usd),
    all_time_trade_count: n(row.all_time_trade_count),
    trophy_count: n(row.trophy_count) ?? 0,
    consecutive_wins: n(row.consecutive_wins) ?? 0,
    appearances: n(row.appearances) ?? 0,
    podium_finishes: n(row.podium_finishes) ?? 0,
    best_movement_sol: n(row.best_movement_sol),
    legendary_tier: row.legendary_tier || null,
    legendary_direction: row.legendary_direction || null,
    legendary_matching_rounds: n(row.legendary_matching_rounds),
    source_labels: ['ATUMPUMP_MARKET'],
    source_count: 1
  };

  byMint.set(mint, token);
}

const sourceFiles = [
  ['data/leaderboard_20.json', '20'],
  ['data/module20/leaderboard.json', '20'],
  ['data/leaderboards/20.json', '20'],
  ['data/leaderboard_13.json', '13'],
  ['data/module13/leaderboard.json', '13'],
  ['data/leaderboards/13.json', '13'],
  ['data/leaderboard_10.json', '10'],
  ['data/module10/leaderboard.json', '10'],
  ['data/leaderboards/10.json', '10'],
  ['data/module225/golden_picks_today.json', 'GOLDEN']
];

const sourceCounts = { '20': 0, '13': 0, '10': 0, GOLDEN: 0 };

for (const [file, label] of sourceFiles) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) continue;

  try {
    const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const list = Array.isArray(raw)
      ? raw
      : raw.tokens || raw.coins || raw.picks || raw.leaderboard || raw.data || [];

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const mint = clean(first(item, [
        'mint', 'token_address', 'address', 'contract_address',
        'tokenAddress', 'ca'
      ]));
      if (!mint) continue;

      const token = byMint.get(mint);
      if (!token) continue;

      if (!token.source_labels.includes(label)) {
        token.source_labels.push(label);
        token.source_count = token.source_labels.length;
        sourceCounts[label]++;
      }
    }
  } catch (error) {
    console.warn(`SOURCE FILE SKIPPED ${file}: ${error.message}`);
  }
}

const tokens = [...byMint.values()].map(token => {
  const change = Math.max(-100, Math.min(1000, token.change_24h ?? 0));
  const volume = Math.max(0, token.volume_24h ?? 0);
  const liquidity = Math.max(0, token.liquidity_usd ?? 0);
  const cap = Math.max(0, token.market_cap ?? 0);
  const allTime = Math.max(0, token.all_time_volume_usd ?? 0);
  const sourceBonus = Math.max(0, token.source_count - 1) * 5;
  const trophyBonus = Math.min(12, token.trophy_count * 2);
  const legendaryBonus = token.legendary_tier
    ? (String(token.legendary_tier).toUpperCase().includes('SUPER') ? 10 : 6)
    : 0;

  const rawScore =
    42 +
    change * 0.16 +
    Math.log10(volume + 1) * 3 +
    Math.log10(liquidity + 1) * 2 +
    Math.log10(cap + 1) * 0.5 +
    Math.log10(allTime + 1) * 1.5 +
    sourceBonus +
    trophyBonus +
    legendaryBonus;

  const score = Math.max(0, Math.min(100, rawScore));

  return {
    ...token,
    dominance_score: Number(score.toFixed(2)),
    trending: change >= 10 || token.source_count >= 2 || token.trophy_count > 0,
    source_labels: token.source_labels.sort()
  };
}).sort((a, b) =>
  b.dominance_score - a.dominance_score ||
  (b.change_24h ?? -Infinity) - (a.change_24h ?? -Infinity) ||
  (b.volume_24h ?? 0) - (a.volume_24h ?? 0)
);

tokens.forEach((token, index) => {
  token.rank = index + 1;
});

const activity = has('pair_buy_events')
  ? safeAll(`
      SELECT
        e.mint,
        e.buyer_address,
        e.signature,
        e.block_time,
        t.name,
        t.symbol
      FROM pair_buy_events e
      LEFT JOIN tokens t ON t.mint = e.mint
      WHERE e.buyer_address IS NOT NULL
        AND length(trim(e.buyer_address)) > 10
      ORDER BY COALESCE(e.block_time, e.recorded_at) DESC
      LIMIT 12
    `).map(event => ({
      type: 'BUY',
      mint: event.mint,
      name: event.name || 'Unknown token',
      symbol: event.symbol || '',
      buyer_address: event.buyer_address,
      signature: event.signature,
      timestamp: event.block_time || null,
      time_label: event.block_time
        ? new Date(event.block_time * 1000).toISOString()
        : 'RECORDED BUY EVENT'
    }))
  : [];

db.close();

const payload = {
  updated_at: iso,
  board_title: 'ATUMPUMP DOMINANCE',
  ranking_mode: 'UNIFIED',
  source_sets: ['20', '13', '10'],
  source_file_memberships: sourceCounts,
  tokens,
  activity,
  summary: {
    token_count: tokens.length,
    market_pair_records: marketRows.length,
    real_buyer_events: activity.length,
    source_file_memberships: sourceCounts,
    formula: '24h performance + volume + liquidity + market cap + all-time volume + source membership + championship achievements'
  }
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));

console.log('ATUMPUMP DOMINANCE EXPORT COMPLETE');
console.log(`DATABASE: ${dbPath}`);
console.log(`OUTPUT: ${outFile}`);
console.log(`VALID TOKENS: ${tokens.length}`);
console.log(`MARKET ROWS: ${marketRows.length}`);
console.log(`REAL BUY EVENTS: ${activity.length}`);
console.log(`SOURCE MEMBERSHIPS: ${JSON.stringify(sourceCounts)}`);
if (tokens.length) {
  const top = tokens[0];
  console.log(`TOP #1: ${top.name} (${top.symbol || 'NO SYMBOL'})`);
  console.log(`MINT: ${top.mint}`);
  console.log(`DOMINANCE: ${top.dominance_score}`);
}
if (tokens.some(t => !t.name || t.name === 'Unknown token')) {
  console.error('VALIDATION FAILED: unnamed tokens remain in the export.');
  process.exitCode = 3;
}
