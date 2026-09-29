import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { exportRecord } from '../src/records.js';

test('bounded UTF-8 artifact pages preserve original, cache is scoped and disposable', t => {
  const dir = mkdtempSync(join(tmpdir(), 'durebak-records-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const a = store.register('a', 'a', 'codex').session;
  const b = store.register('b', 'b', 'claude').session;
  const artifact = store.putArtifact(a, '가나다라마');
  const first = store.readArtifact(a, artifact.hash, 0, 4);
  assert.equal(first.content, '가'); assert.equal(first.next, 3); assert.equal(first.has_more, true);
  assert.equal(first.cache_hit, false);
  assert.equal(store.readArtifact(a, artifact.hash, 0, 4).cache_hit, true);
  assert.throws(() => store.readArtifact(b, artifact.hash), /not_found/);
  assert.throws(() => store.readArtifact(a, artifact.hash, 1, 4), /invalid_offset/);
  assert.equal(store.readArtifact(a, artifact.hash, 3, 4096).content, '나다라마');
  assert.equal(store.clearCache(a).deleted, 2);
  assert.equal(store.readArtifact(a, artifact.hash, 0, 4).cache_hit, false);
  assert.equal(store.readArtifact(a, artifact.hash).content, '가나다라마');
});

test('deterministic record export never overwrites manually edited documents', t => {
  const dir = mkdtempSync(join(tmpdir(), 'durebak-export-'));
  const store = new Store(join(dir, 'data'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const a = store.register('a', 'a', 'codex').session;
  const task = store.createTask(a, { title:'Bug', criteria:'Regression passes', key:'task' });
  const first = store.record(a, task.id);
  assert.deepEqual(store.record(a, task.id), first);
  assert.equal(first.llm_calls, 0);
  const path = join(dir, 'result.md');
  assert.equal(exportRecord(path, first.markdown).status, 'created');
  assert.equal(exportRecord(path, first.markdown).status, 'unchanged');
  writeFileSync(path, 'manual edit');
  assert.throws(() => exportRecord(path, first.markdown), /export_conflict/);
  assert.equal(readFileSync(path, 'utf8'), 'manual edit');
});

test('legacy oversized cached pages are bypassed and rebuilt without modifying originals', async t => {
  const {DatabaseSync}=await import('node:sqlite');
  const {hash}=await import('../src/store.js');
  const dir=mkdtempSync(join(tmpdir(),'durebak-cache-upgrade-'));
  const store=new Store(dir);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const a=store.register('a','reader','codex').session;
  const content='\u0000'.repeat(6000);const artifact=store.putArtifact(a,content);
  const db=new DatabaseSync(join(dir,'runtime.sqlite'));
  const value=JSON.stringify({content:content.slice(0,4096),offset:0,next:4096,total_bytes:6000,has_more:true});
  try {db.prepare('INSERT INTO cache(workspace,key,value,bytes,touched) VALUES(?,?,?,?,?)').run(a.workspace,hash(JSON.stringify(['range-v1',artifact.hash,0,4096])),value,Buffer.byteLength(value),Date.now());}finally{db.close();}
  const page=store.readArtifact(a,artifact.hash);
  assert.equal(page.cache_hit,false);assert.ok(Buffer.byteLength(JSON.stringify(page))<16384);
  assert.equal(store.readArtifact(a,artifact.hash).cache_hit,true);
  let restored=page.content,offset=page.next;
  while(offset<6000){const next=store.readArtifact(a,artifact.hash,offset);restored+=next.content;offset=next.next;}
  assert.equal(restored,content);assert.equal(hash(restored),artifact.hash);
});
