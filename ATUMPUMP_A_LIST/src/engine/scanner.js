import { recordEvent } from './audit.js';

const utcDay = ms => new Date(ms).toISOString().slice(0,10);

export function ingestObservations(db, rows, now=Date.now()) {
  const pair = db.prepare(`
    INSERT INTO pairs(
      mint,pair_address,symbol,name,source,first_seen_at,last_seen_at
    )
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(mint,pair_address) DO UPDATE SET
      symbol=excluded.symbol,
      name=excluded.name,
      source=excluded.source,
      last_seen_at=MAX(pairs.last_seen_at,excluded.last_seen_at)
  `);

  const obs = db.prepare(`
    INSERT OR IGNORE INTO observations(
      mint,pair_address,price,observed_at,source
    )
    VALUES(?,?,?,?,?)
  `);

  let accepted=0;

  for (const r of rows) {
    const price=Number(r.price);
    const at=Number(r.observed_at);

    if (!r.mint || !r.pair_address ||
        !(price>0) || !Number.isFinite(at)) continue;

    pair.run(
      r.mint,r.pair_address,r.symbol || 'UNKNOWN',
      r.name || '',r.source || 'ATUMPUMP_MODULE_21',
      at,at
    );

    obs.run(
      r.mint,r.pair_address,price,at,
      r.source || 'ATUMPUMP_MODULE_21'
    );

    accepted++;
  }

  return accepted;
}

export function rebuildDailyCandles(db, now=Date.now(), allHistory=false) {
  const todayStart=Date.parse(`${utcDay(now)}T00:00:00.000Z`);

  const query=allHistory
    ? db.prepare(`
        SELECT mint,pair_address,price,observed_at
        FROM observations
        WHERE price>0
        ORDER BY mint,pair_address,observed_at,id
      `)
    : db.prepare(`
        SELECT mint,pair_address,price,observed_at
        FROM observations
        WHERE price>0 AND observed_at>=?
        ORDER BY mint,pair_address,observed_at,id
      `);

  const upsert=db.prepare(`
    INSERT INTO daily_candles(
      mint,pair_address,day_utc,open,high,low,close,samples,closed
    )
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(mint,pair_address,day_utc) DO UPDATE SET
      open=excluded.open,
      high=excluded.high,
      low=excluded.low,
      close=excluded.close,
      samples=excluded.samples,
      closed=excluded.closed
  `);

  let current=null;
  let written=0;

  function flush() {
    if (!current) return;

    const start=Date.parse(`${current.day}T00:00:00.000Z`);

    const values = [
      current.mint,current.pair,current.day,
      current.open,current.high,current.low,current.close,
      current.samples,start+86400000<=now ? 1 : 0
    ];

    let saved = false;
    let lastError;

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        upsert.run(...values);
        saved = true;
        break;
      } catch (error) {
        lastError = error;
        const message = String(error.message || error);
        if (!/database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)) {
          throw error;
        }
        // Synchronous bounded backoff for Node's synchronous SQLite driver.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0,
          Math.min(2000, 150 * (attempt + 1)));
      }
    }

    if (!saved) throw lastError;
    written++;
  }

  // Materialize and close the SELECT cursor before writing candles.
  // Keeping an active read cursor while upserting on the same connection
  // can trigger SQLITE_BUSY_SNAPSHOT under concurrent WAL activity.
  const rows = allHistory
    ? query.all()
    : query.all(todayStart);

  for (const r of rows) {
    const day=utcDay(Number(r.observed_at));
    const key=`${r.mint}|${r.pair_address}|${day}`;
    const price=Number(r.price);

    if (!current || current.key!==key) {
      flush();
      current={
        key,mint:r.mint,pair:r.pair_address,day,
        open:price,high:price,low:price,close:price,samples:1
      };
    } else {
      current.high=Math.max(current.high,price);
      current.low=Math.min(current.low,price);
      current.close=price;
      current.samples++;
    }
  }

  flush();
  return written;
}


function isUp(c) {
  return Number(c.close) > Number(c.open);
}

function consecutiveDays(candles) {
  for (let i = 1; i < candles.length; i++) {
    const previous = Date.parse(`${candles[i - 1].day_utc}T00:00:00Z`);
    const current = Date.parse(`${candles[i].day_utc}T00:00:00Z`);
    if (current - previous !== 86400000) return false;
  }
  return true;
}


function gateFor(candles) {
  const last3  = candles.slice(-3);
  const last12 = candles.slice(-12);

  const isUp = c => Number(c.close) > Number(c.open) * 0.98;
  const isUp3 = last3.length === 3 && last3.every(isUp);

  const explosive = last3.some(c => Number(c.open) > 0 && Number(c.close) >= Number(c.open) * 1.8);

  const twelveDay = last12.length >= 8 && last12.filter(isUp).length >= 8;

  const threeDay = isUp3;

  return [
    explosive ? { state: 'EXPLODE DOMINANCE',  gate: 'THREE_CANDLE_100_PERCENT_GROWTH', candles: last3  } : null,
    twelveDay ? { state: '12 DAY CANDIDATE',   gate: '12_UP_0_DOWN',                   candles: last12 } : null,
    threeDay  ? { state: '3 DAY CANDIDATE',    gate: '3_UP_0_DOWN',                    candles: last3  } : null,
  ].filter(Boolean);
}


export function evaluateDominance(db, now=Date.now()) {
  const pairs = db.prepare(`
    SELECT DISTINCT mint, pair_address
    FROM daily_candles
    WHERE closed=1
  `).all();

  const getCandles = db.prepare(`
    SELECT day_utc, open, high, low, close
    FROM daily_candles
    WHERE mint=? AND pair_address=? AND closed=1
    ORDER BY day_utc ASC
    LIMIT 36
  `);

  // Permanent deduplication: same mint + pair + state + gate never inserts twice.
  const alreadyHas = db.prepare(`
    SELECT 1 FROM dominance
    WHERE mint=? AND pair_address=? AND state=? AND gate=?
    LIMIT 1
  `);

  const insert = db.prepare(`
    INSERT INTO dominance(
      mint, pair_address, state, gate, candle_days, candle_data, activated_at
    ) VALUES(?,?,?,?,?,?,?)
  `);

  const events = [];

  for (const p of pairs) {
    const candles = getCandles.all(p.mint, p.pair_address);
    if (candles.length < 3) continue;

    // gateFor returns an array — process each qualification independently.
    const qualifications = gateFor(candles);

    for (const q of qualifications) {
      const { state, gate, candles: qc } = q;

      if (alreadyHas.get(p.mint, p.pair_address, state, gate)) continue;

      const days = qc.map(c => c.day_utc);
      const data = qc.map(c => ({
        day:   c.day_utc,
        open:  Number(c.open),
        high:  Number(c.high),
        low:   Number(c.low),
        close: Number(c.close),
        growth_pct: Number(c.open) > 0
          ? (Number(c.close) / Number(c.open) - 1) * 100
          : null
      }));

      insert.run(
        p.mint, p.pair_address,
        state, gate,
        JSON.stringify(days),
        JSON.stringify(data),
        now
      );

      recordEvent(db, 'DOMINANCE_GATE_CHANGED', {
        mint: p.mint, pair_address: p.pair_address,
        state, gate, days
      }, now);

      events.push({ ...p, state, gate });
    }
  }

  return events;
}
