import crypto from 'node:crypto';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
export function recordEvent(db,type,payload,now=Date.now()) {
  const previous=db.prepare('SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1').get()?.event_hash || 'ATUMPUMP-A-LIST-GENESIS';
  const body=JSON.stringify(payload);
  const hash=sha(`${previous}|${type}|${body}|${now}`);
  db.prepare('INSERT INTO audit_events(event_type,payload,created_at,previous_hash,event_hash) VALUES(?,?,?,?,?)')
    .run(type,body,now,previous,hash);
  return hash;
}
export function verifyAudit(db) {
  const rows=db.prepare('SELECT * FROM audit_events ORDER BY id').all();
  let prev='ATUMPUMP-A-LIST-GENESIS';
  for(const r of rows) {
    const expected=sha(`${prev}|${r.event_type}|${r.payload}|${r.created_at}`);
    if(r.previous_hash!==prev || r.event_hash!==expected) return {valid:false,failed_id:r.id};
    prev=r.event_hash;
  }
  return {valid:true,count:rows.length,head:prev};
}
