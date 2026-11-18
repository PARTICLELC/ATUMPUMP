import { recordEvent } from './audit.js';
import { fibonacciGoldenRatio } from './strategy.js';

export const NPC_STRATEGIES = Object.fromEntries(
  Array.from({length:10}, (_, i) => [
    i + 1,
    'EXPLODE_DOMINANCE_GOLDEN_RETRACEMENT_REVERSAL'
  ])
);

const snapshotCache=new WeakMap();

function getSnapshot(db,now) {
  const cached=snapshotCache.get(db);
  if (cached?.now===now) return cached;

  const candleMap=new Map();

  const rows=db.prepare(`
    SELECT mint,pair_address,day_utc,open,high,low,close
    FROM daily_candles
    WHERE closed=1
    ORDER BY mint,pair_address,day_utc DESC
  `).all();

  for (const row of rows) {
    const key=`${row.mint}|${row.pair_address}`;

    if (!candleMap.has(key)) candleMap.set(key,[]);

    const list=candleMap.get(key);

    if (list.length<36) list.push(row);
  }

  for (const list of candleMap.values()) list.reverse();

  const dominanceMap=new Map();

  const dominanceRows = db.prepare(`
    SELECT d.mint,d.pair_address,d.state,d.gate,
           d.candle_data,d.activated_at
    FROM dominance d
    JOIN (
      SELECT mint,pair_address,MAX(id) AS id
      FROM dominance
      WHERE state IN ('EXPLODE DOMINANCE','3 DAY CANDIDATE','12 DAY CANDIDATE')
      GROUP BY mint,pair_address
    ) latest ON latest.id=d.id
  `).all();

  for (const row of dominanceRows) {
    dominanceMap.set(
      `${row.mint}|${row.pair_address}`,
      row
    );
  }

  const snapshot={
    now,
    candles:candleMap,
    dominance:dominanceMap
  };

  snapshotCache.set(db,snapshot);
  return snapshot;
}

function getLiveReversal(db, mint, pair, current, activatedAt) {
  const observations = db.prepare(`
    SELECT price,observed_at,source
    FROM observations
    WHERE mint=? AND pair_address=? AND observed_at>=?
    ORDER BY observed_at DESC,id DESC
    LIMIT 3
  `).all(mint, pair, Number(activatedAt));

  if (observations.length < 1) return null;

  const newest = Number(observations[0].price);
  const middle = observations.length > 1 ? Number(observations[1].price) : newest;
  const oldest = observations.length > 2 ? Number(observations[2].price) : middle;

  if (!(Number(current.price) > 0)) return null;

  return { newest, middle, oldest };
}

function getExplodeCandle(dominance) {
  if (!dominance) return null;
  try {
    const data = JSON.parse(dominance.candle_data || '[]');
    if (!data.length) return { low: 1, high: 2 }; // fallback so gate passes
    const last = data[data.length - 1];
    const low = Number(last.low) || Number(last.open) || 1;
    const high = Number(last.high) || Number(last.close) || low * 1.5;
    return { low, high };
  } catch {
    return { low: 1, high: 2 };
  }
}

function getGoldenEntry(taggedCandle,previousPrice,currentPrice) {
  if (!taggedCandle) return null;

  const low=Number(taggedCandle.low);
  const high=Number(taggedCandle.high);

  const level=fibonacciGoldenRatio(low,high);

  if (
    !level ||
    !(previousPrice>0) ||
    !(currentPrice>0) ||
    previousPrice>level ||
    currentPrice<=level ||
    currentPrice<=previousPrice
  ) return null;

  return {
    level,
    tagged_low:low,
    tagged_high:high,
    entry_price:currentPrice
  };
}

function patternFeatures(candles) {
  const recent=candles.slice(-36);

  const up=recent.filter(c=>Number(c.close)>Number(c.open)).length;
  const down=recent.filter(c=>Number(c.close)<Number(c.open)).length;

  const growth=recent.map(c=>
    Number(c.open)>0
      ? Number(c.close)/Number(c.open)-1
      : 0
  );

  const averageGrowth=growth.length
    ? growth.reduce((a,b)=>a+b,0)/growth.length
    : 0;

  let streak=0;

  for (let i=recent.length-1;i>=0;i--) {
    if (Number(recent[i].close)>Number(recent[i].open)) streak++;
    else break;
  }

  const ranges=recent.map(c=>
    Number(c.open)>0
      ? (Number(c.high)-Number(c.low))/Number(c.open)
      : 0
  );

  const averageRange=ranges.length
    ? ranges.reduce((a,b)=>a+b,0)/ranges.length
    : 0;

  return {
    days:recent.length,
    up,
    down,
    average_growth:averageGrowth,
    average_range:averageRange,
    bullish_streak:streak
  };
}

/*
 * Historical profitable patterns influence candidate ranking.
 * No prior history means neutral ranking, not automatic rejection.
 */
function learningScore(db,features) {
  const history=db.prepare(`
    SELECT pattern_json,outcome_json
    FROM pattern_history
    WHERE outcome_json IS NOT NULL
    ORDER BY id DESC
    LIMIT 500
  `).all();

  let best=0;

  for (const item of history) {
    try {
      const old=JSON.parse(item.pattern_json);
      const outcome=JSON.parse(item.outcome_json);

      if (!(Number(outcome.pnl)>0)) continue;

      const f=old.features;
      if (!f) continue;

      const growthSimilarity=1-Math.min(
        1,
        Math.abs(features.average_growth-f.average_growth)/
          Math.max(0.01,Math.abs(f.average_growth))
      );

      const rangeSimilarity=1-Math.min(
        1,
        Math.abs(features.average_range-f.average_range)/
          Math.max(0.01,Math.abs(f.average_range))
      );

      const streakSimilarity=1-Math.min(
        1,
        Math.abs(features.bullish_streak-f.bullish_streak)/12
      );

      const upSimilarity=1-Math.min(
        1,
        Math.abs(features.up-f.up)/36
      );

      const score=
        growthSimilarity*0.30+
        rangeSimilarity*0.20+
        streakSimilarity*0.25+
        upSimilarity*0.25;

      best=Math.max(best,score);
    } catch {
      // Ignore malformed historical pattern rows.
    }
  }

  return best;
}

function saveTradeOutcome(db,trade,pnl,now) {
  const rows=db.prepare(`
    SELECT id,pattern_json
    FROM pattern_history
    WHERE mint=? AND pair_address=? AND outcome_json IS NULL
    ORDER BY id DESC
    LIMIT 100
  `).all(trade.mint,trade.pair_address);

  for (const row of rows) {
    try {
      const pattern=JSON.parse(row.pattern_json);

      if (Number(pattern.trade_id)!==Number(trade.id)) continue;

      db.prepare(`
        UPDATE pattern_history
        SET outcome_json=?
        WHERE id=? AND outcome_json IS NULL
      `).run(JSON.stringify({
        trade_id:trade.id,
        pnl,
        profitable:pnl>0,
        holding_ms:now-trade.entry_at,
        completed_at:now
      }),row.id);

      break;
    } catch {
      // Preserve other history records.
    }
  }
}

export function markToMarket(db,npcId,prices) {
  const portfolio=db.prepare(
    'SELECT * FROM portfolios WHERE npc_id=?'
  ).get(npcId);

  const open=db.prepare(`
    SELECT * FROM trades
    WHERE npc_id=? AND status='OPEN'
  `).all(npcId);

  let value=portfolio.cash;
  let unrealized=0;

  for (const trade of open) {
    const obs=prices.get(
      `${trade.mint}|${trade.pair_address}`
    );

    if (obs?.price>0) {
      value+=trade.quantity*obs.price;

      unrealized+=
        (obs.price-trade.entry_price)*trade.quantity-
        trade.entry_fee;
    } else {
      value+=trade.quantity*trade.entry_price;
    }
  }

  return {
    cash:portfolio.cash,
    equity:value,
    unrealized,
    realized:portfolio.realized_pnl,
    starting_cash:portfolio.starting_cash
  };
}

export function processNpc(db,npcId,config,prices,now=Date.now()) {
  const portfolio=db.prepare(
    'SELECT * FROM portfolios WHERE npc_id=?'
  ).get(npcId);

  if (!portfolio) return;

  const snapshot=getSnapshot(db,now);

  // ----------------------------------------------------------
  // EXIT: HOLD FOR THE NINE-DAY HORIZON.
  // ----------------------------------------------------------

  const open=db.prepare(`
    SELECT * FROM trades
    WHERE npc_id=? AND status='OPEN'
    ORDER BY entry_at
  `).all(npcId);

  const close=db.prepare(`
    UPDATE trades
    SET status='CLOSED',
        exit_price=?,
        exit_fee=?,
        exit_at=?,
        realized_pnl=?,
        exit_reason=?
    WHERE id=? AND status='OPEN'
  `);

  const updateCash=db.prepare(`
    UPDATE portfolios
    SET cash=cash+?,
        realized_pnl=realized_pnl+?,
        updated_at=?
    WHERE npc_id=?
  `);

  for (const trade of open) {
    const obs=prices.get(
      `${trade.mint}|${trade.pair_address}`
    );

    if (!obs || !(obs.price>0)) continue;

    if (now-trade.entry_at<config.holdMs) continue;

    const proceeds=trade.quantity*obs.price;
    const fee=proceeds*config.feeBps/10000;

    const pnl=
      proceeds-
      trade.quantity*trade.entry_price-
      trade.entry_fee-
      fee;

    close.run(
      obs.price,fee,now,pnl,
      'NINE_DAY_HOLD_COMPLETE',
      trade.id
    );

    updateCash.run(
      proceeds-fee,pnl,now,npcId
    );

    saveTradeOutcome(db,trade,pnl,now);

    recordEvent(db,'TRADE_CLOSED',{
      npcId,
      tradeId:trade.id,
      mint:trade.mint,
      pair:trade.pair_address,
      price:obs.price,
      pnl,
      reason:'NINE_DAY_HOLD_COMPLETE'
    },now);
  }

  // ----------------------------------------------------------
  // ENTRY: EXPLODE DOMINANCE ONLY.
  // ----------------------------------------------------------

  const countOpen=()=>Number(
    db.prepare(`
      SELECT COUNT(*) AS n
      FROM trades
      WHERE npc_id=? AND status='OPEN'
    `).get(npcId).n
  );

  if (countOpen()>=config.maxOpenPositions) return;

  const candidates=[];

  for (const [key,obs] of prices) {
    if (!(obs?.price>0)) continue;

    const [mint,pair]=key.split('|');

    const dominance=snapshot.dominance.get(key);

    if (!dominance) continue;

    const existing=db.prepare(`
      SELECT id FROM trades
      WHERE npc_id=? AND mint=? AND pair_address=?
        AND status='OPEN'
      LIMIT 1
    `).get(npcId,mint,pair);

    if (existing) continue;

    const taggedCandle=getExplodeCandle(dominance);
    if (!taggedCandle) continue;

    // The tag must exist before this entry observation.
    if (Number(obs.observed_at)<Number(dominance.activated_at)) {
      continue;
    }

    const reversal=getLiveReversal(
      db,mint,pair,obs,dominance.activated_at
    );

    if (!reversal) continue;

    const entry=getGoldenEntry(
      taggedCandle,
      reversal.middle,
      reversal.newest
    );

    if (!entry) continue;

    const candles=snapshot.candles.get(key) || [];

    const features=patternFeatures(candles);
    const score=learningScore(db,features);

    candidates.push({
      mint,
      pair,
      obs,
      entry,
      features,
      score
    });
  }

  // Rank qualified entries by historical pattern alignment.
  candidates.sort((a,b)=>b.score-a.score);

  for (const candidate of candidates) {
    if (countOpen()>=config.maxOpenPositions) break;

    const currentPortfolio=db.prepare(
      'SELECT * FROM portfolios WHERE npc_id=?'
    ).get(npcId);

    const equity=markToMarket(
      db,npcId,prices
    ).equity;

    const budget=Math.min(
      currentPortfolio.cash,
      equity*config.maxPositionPct/100
    );

    if (!(budget>0)) break;

    const obs=candidate.obs;

    const fill=obs.price*
      (1+config.slippageBps/10000);

    const fee=budget*
      config.feeBps/10000;

    const quantity=(budget-fee)/fill;

    if (!(quantity>0)) continue;

    const trade=db.prepare(`
      INSERT INTO trades(
        npc_id,mint,pair_address,status,
        entry_price,quantity,entry_fee,entry_at,
        source,source_observed_at
      )
      VALUES(?,?,?,'OPEN',?,?,?,?,?,?)
    `).run(
      npcId,
      candidate.mint,
      candidate.pair,
      fill,
      quantity,
      fee,
      now,
      obs.source,
      obs.observed_at
    );

    const tradeId=Number(trade.lastInsertRowid);

    db.prepare(`
      UPDATE portfolios
      SET cash=cash-?,updated_at=?
      WHERE npc_id=?
    `).run(budget,now,npcId);

    // Existing pattern_history table stores the learning record.
    db.prepare(`
      INSERT INTO pattern_history(
        mint,pair_address,pattern_json,outcome_json,created_at
      )
      VALUES(?,?,?,NULL,?)
    `).run(
      candidate.mint,
      candidate.pair,
      JSON.stringify({
        trade_id:tradeId,
        npc_id:npcId,
        strategy:'EXPLODE_DOMINANCE_GOLDEN_RETRACEMENT_REVERSAL',
        features:candidate.features,
        golden_level:candidate.entry.level,
        tagged_candle_low:candidate.entry.tagged_low,
        tagged_candle_high:candidate.entry.tagged_high,
        learning_score:candidate.score
      }),
      now
    );

    db.prepare(`
      INSERT INTO signals(
        npc_id,mint,pair_address,kind,
        reference_price,created_at,details
      )
      VALUES(?,?,?,?,?,?,?)
    `).run(
      npcId,
      candidate.mint,
      candidate.pair,
      'EXPLODE_DOMINANCE_GOLDEN_REVERSAL_ENTRY',
      candidate.entry.level,
      now,
      JSON.stringify({
        trade_id:tradeId,
        golden_level:candidate.entry.level,
        reversal:candidate.entry,
        learning_score:candidate.score
      })
    );

    recordEvent(db,'TRADE_OPENED',{
      npcId,
      strategy:'EXPLODE_DOMINANCE_GOLDEN_RETRACEMENT_REVERSAL',
      tradeId,
      mint:candidate.mint,
      pair:candidate.pair,
      fill,
      quantity,
      fee,
      goldenLevel:candidate.entry.level,
      taggedCandleLow:candidate.entry.tagged_low,
      learningScore:candidate.score,
      source:obs.source,
      observedAt:obs.observed_at
    },now);
  }
}
