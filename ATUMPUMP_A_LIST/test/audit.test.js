import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { recordEvent, verifyAudit } from '../src/engine/audit.js';

test('audit chain verifies appended events',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE audit_events(id INTEGER PRIMARY KEY,event_type TEXT,payload TEXT,created_at INTEGER,previous_hash TEXT,event_hash TEXT)`);
  recordEvent(db,'TEST',{ok:true},123);
  recordEvent(db,'TEST2',{n:2},124);
  assert.equal(verifyAudit(db).valid,true);
  db.close();
});
