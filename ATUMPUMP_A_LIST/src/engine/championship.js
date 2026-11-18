import { markToMarket } from './trading.js';
import { recordEvent } from './audit.js';

export function settleChampionshipIfDue(db, config, prices, now=Date.now()) {
  const round=db.prepare("SELECT * FROM rounds WHERE status='active' ORDER BY id DESC LIMIT 1").get();
  if(!round || now<round.ends_at) return null;
  const npcs=db.prepare('SELECT id FROM npc_profiles ORDER BY id').all();
  const results=npcs.map(n=>{
    const p=markToMarket(db,n.id,prices);
    return {npc_id:n.id,equity:p.equity,return_pct:(p.equity/p.starting_cash-1)*100};
  });
  results.sort((a,b)=>b.return_pct-a.return_pct || b.equity-a.equity || a.npc_id-b.npc_id);
  const insert=db.prepare('INSERT INTO round_results(round_id,npc_id,equity,return_pct,rank) VALUES(?,?,?,?,?)');
  results.forEach((r,i)=>insert.run(round.id,r.npc_id,r.equity,r.return_pct,i+1));
  const winner=results[0];
  db.prepare("UPDATE rounds SET status='complete',winner_npc_id=?,finalized_at=? WHERE id=? AND status='active'")
    .run(winner.npc_id,now,round.id);
  db.prepare('UPDATE npc_profiles SET wins=wins+1 WHERE id=?').run(winner.npc_id);
  db.prepare('INSERT INTO xp_ledger(npc_id,amount,reason,created_at) VALUES(?,?,?,?)')
    .run(winner.npc_id,500,'72_HOUR_CHAMPIONSHIP_WIN',now);
  db.prepare('UPDATE npc_profiles SET xp=xp+500 WHERE id=?').run(winner.npc_id);
  db.prepare("INSERT INTO rounds(started_at,ends_at,status) VALUES(?,?,'active')").run(now,now+config.roundMs);
  recordEvent(db,'CHAMPIONSHIP_SETTLED',{roundId:round.id,winnerNpcId:winner.npc_id,results},now);
  return {roundId:round.id,winner,results};
}
