/**
 * ATUMPUMP DOMINANCE INSPECTOR
 * Run: node inspect_dominance.js
 * From: ~/ATUMPUMP/ATUMPUMP_A_LIST
 *
 * Diagnoses why evaluateDominance() returns 0 results.
 * Prints raw candle samples, gate checks, and failure reasons.
 */

import Database from 'better-sqlite3';
import { resolve } from 'path';

// ── Locate DB ────────────────────────────────────────────────────────────────
const DB_PATH = resolve('./data/atumpump.db');
const db = new Database(DB_PATH, { readonly: true });

// ── 1. Total candle count ────────────────────────────────────────────────────
const totalCandles = db.prepare(`SELECT COUNT(*) AS n FROM daily_candles`).get();
const closedCandles = db.prepare(`SELECT COUNT(*) AS n FROM daily_candles WHERE closed=1`).get();
console.log('\n══════ CANDLE INVENTORY ══════');
console.log(`Total candles  : ${totalCandles.n}`);
console.log(`Closed candles : ${closedCandles.n}`);

// ── 2. Distinct pairs with ≥3 closed candles ────────────────────────────────
const eligiblePairs = db.prepare(`
  SELECT mint, pair_address, COUNT(*) AS cnt
  FROM daily_candles
  WHERE closed=1
  GROUP BY mint, pair_address
  HAVING cnt >= 3
  ORDER BY cnt DESC
  LIMIT 20
`).all();

console.log(`\n══════ TOP 20 PAIRS BY CLOSED CANDLE COUNT ══════`);
eligiblePairs.forEach(r => console.log(`  ${r.cnt.toString().padStart(4)} closed  ${r.mint.slice(0,8)}…  ${r.pair_address.slice(0,8)}…`));

const pairsWithThree = db.prepare(`
  SELECT COUNT(*) AS n FROM (
    SELECT mint FROM daily_candles WHERE closed=1
    GROUP BY mint, pair_address HAVING COUNT(*) >= 3
  )
`).get();
console.log(`\nPairs with ≥3 closed candles: ${pairsWithThree.n}`);

// ── 3. Sample the last-3 candles for the top pair ───────────────────────────
if (eligiblePairs.length > 0) {
  const top = eligiblePairs[0];
  const sample = db.prepare(`
    SELECT day_utc, open, high, low, close, closed
    FROM daily_candles
    WHERE mint=? AND pair_address=? AND closed=1
    ORDER BY day_utc DESC
    LIMIT 12
  `).all(top.mint, top.pair_address).reverse();

  console.log(`\n══════ LAST 12 CANDLES — ${top.mint.slice(0,12)} ══════`);
  sample.forEach((c,i) => {
    const o = Number(c.open), cl = Number(c.close);
    const pct = o > 0 ? ((cl/o - 1)*100).toFixed(1) : 'N/A';
    const dir = cl >= o ? '▲' : '▼';
    console.log(`  [${i.toString().padStart(2)}] ${c.day_utc}  open=${o.toFixed(8)}  close=${cl.toFixed(8)}  ${dir} ${pct}%`);
  });

  // Manual gate checks on last-3
  const last3 = sample.slice(-3);
  console.log(`\n══════ GATE CHECK — last 3 of top pair ══════`);

  const isUp = c => Number(c.close) >= Number(c.open);
  const allUp = last3.every(isUp);
  console.log(`  All 3 up              : ${allUp}`);

  // Consecutive-day check
  const days = last3.map(c => c.day_utc).map(d => new Date(d).getTime());
  const MS_DAY = 86400000;
  const consecutive = days[1] - days[0] === MS_DAY && days[2] - days[1] === MS_DAY;
  console.log(`  Consecutive days      : ${consecutive}`);
  console.log(`    day[0]=${last3[0].day_utc}  day[1]=${last3[1].day_utc}  day[2]=${last3[2].day_utc}`);
  console.log(`    gap0→1=${days[1]-days[0]}ms  gap1→2=${days[2]-days[1]}ms  (expect ${MS_DAY}ms)`);

  // Gate A
  const gateA = allUp && consecutive;
  console.log(`  GATE A (3 UP 0 DOWN)  : ${gateA}`);

  // Gate C
  const o0 = Number(last3[0].open), c0 = Number(last3[0].close);
  const c1 = Number(last3[1].close);
  const c2 = Number(last3[2].close);
  console.log(`\n  Gate C breakdown:`);
  console.log(`    candle[0] open=${o0.toFixed(8)}  close=${c0.toFixed(8)}  close>=2×open? ${c0 >= o0*2}  (ratio=${o0>0?(c0/o0).toFixed(4):'∞'})`);
  console.log(`    candle[1] close=${c1.toFixed(8)}  >=2×c0? ${c1 >= c0*2}  (ratio=${c0>0?(c1/c0).toFixed(4):'∞'})`);
  console.log(`    candle[2] close=${c2.toFixed(8)}  >=2×c1? ${c2 >= c1*2}  (ratio=${c1>0?(c2/c1).toFixed(4):'∞'})`);
  const gateC = o0 > 0 && c0 >= o0*2 && c1 >= c0*2 && c2 >= c1*2;
  console.log(`  GATE C (EXPLODE)      : ${gateC}`);
}

// ── 4. How many pairs have 3 consecutive UP candles anywhere in last 36? ────
console.log(`\n══════ SCANNING ALL PAIRS — 3 CONSECUTIVE UP ══════`);
const allPairs = db.prepare(`
  SELECT DISTINCT mint, pair_address FROM daily_candles WHERE closed=1
`).all();

let gateACount = 0, gateCCount = 0, noConsecutive = 0, notAllUp = 0;
let sampleGateA = null, sampleGateC = null;

for (const pair of allPairs) {
  const candles = db.prepare(`
    SELECT day_utc, open, high, low, close
    FROM daily_candles
    WHERE mint=? AND pair_address=? AND closed=1
    ORDER BY day_utc DESC
    LIMIT 36
  `).all(pair.mint, pair.pair_address).reverse();

  if (candles.length < 3) continue;
  const last3 = candles.slice(-3);

  const isUp = c => Number(c.close) >= Number(c.open);
  const allUp = last3.every(isUp);

  const days = last3.map(c => c.day_utc).map(d => new Date(d).getTime());
  const MS = 86400000;
  const consec = days[1]-days[0] === MS && days[2]-days[1] === MS;

  if (!consec) { noConsecutive++; continue; }
  if (!allUp)  { notAllUp++;     continue; }

  gateACount++;
  if (!sampleGateA) sampleGateA = { pair, last3 };

  const o0 = Number(last3[0].open), c0 = Number(last3[0].close);
  const c1 = Number(last3[1].close), c2 = Number(last3[2].close);
  if (o0 > 0 && c0 >= o0*2 && c1 >= c0*2 && c2 >= c1*2) {
    gateCCount++;
    if (!sampleGateC) sampleGateC = { pair, last3 };
  }
}

console.log(`  Pairs failing consecutive-day check : ${noConsecutive}`);
console.log(`  Pairs failing all-up check          : ${notAllUp}`);
console.log(`  GATE A qualifiers (last window)     : ${gateACount}`);
console.log(`  GATE C qualifiers (last window)     : ${gateCCount}`);

if (sampleGateA) {
  const { pair, last3 } = sampleGateA;
  console.log(`\n══════ GATE A SAMPLE ══════`);
  console.log(`  mint=${pair.mint.slice(0,16)}…`);
  last3.forEach((c,i) => console.log(`  [${i}] ${c.day_utc}  open=${Number(c.open).toFixed(8)}  close=${Number(c.close).toFixed(8)}`));
}

if (sampleGateC) {
  const { pair, last3 } = sampleGateC;
  console.log(`\n══════ GATE C SAMPLE ══════`);
  console.log(`  mint=${pair.mint.slice(0,16)}…`);
  last3.forEach((c,i) => console.log(`  [${i}] ${c.day_utc}  open=${Number(c.open).toFixed(8)}  close=${Number(c.close).toFixed(8)}`));
}

// ── 5. Existing dominance table ──────────────────────────────────────────────
const domCount = db.prepare(`SELECT COUNT(*) AS n FROM dominance`).get();
const domSample = db.prepare(`SELECT * FROM dominance ORDER BY activated_at DESC LIMIT 5`).all();
console.log(`\n══════ DOMINANCE TABLE ══════`);
console.log(`  Total rows: ${domCount.n}`);
domSample.forEach(r => console.log(`  ${r.state}  ${r.gate}  ${r.mint.slice(0,10)}…`));

// ── 6. day_utc format sample ─────────────────────────────────────────────────
const daySample = db.prepare(`SELECT day_utc FROM daily_candles WHERE closed=1 LIMIT 5`).all();
console.log(`\n══════ day_utc FORMAT SAMPLE ══════`);
daySample.forEach(r => console.log(`  "${r.day_utc}"`));
console.log(`\n  (consecutiveDays math expects ISO date strings parseable by new Date())`);

// ── 7. Check if consecutiveDays uses day string diff or ms diff ──────────────
// Print the actual gap between the two most recent closed day_utc values for top pair
if (eligiblePairs.length > 0) {
  const top = eligiblePairs[0];
  const recent = db.prepare(`
    SELECT day_utc FROM daily_candles
    WHERE mint=? AND pair_address=? AND closed=1
    ORDER BY day_utc DESC LIMIT 3
  `).all(top.mint, top.pair_address);

  console.log(`\n══════ RAW day_utc GAPS (top pair) ══════`);
  recent.forEach((r,i) => {
    const ms = new Date(r.day_utc).getTime();
    console.log(`  [${i}] "${r.day_utc}"  → ${ms}  (${isNaN(ms)?'UNPARSEABLE':'ok'})`);
  });
  if (recent.length >= 2) {
    const gap = new Date(recent[0].day_utc).getTime() - new Date(recent[1].day_utc).getTime();
    console.log(`  Gap [0]→[1]: ${gap}ms  expect 86400000ms`);
  }
}

db.close();
console.log('\n══════ INSPECTION COMPLETE ══════\n');
