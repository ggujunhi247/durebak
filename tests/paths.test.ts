import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {dataDirectory} from '../src/client.js';

test('new installations use home .durebak and explicit locations retain precedence',t=>{
  const home=mkdtempSync(join(tmpdir(),'durebak-home-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  assert.equal(dataDirectory(undefined,{},home),join(home,'.durebak'));
  assert.equal(existsSync(join(home,'.durebak')),false);
  assert.equal(dataDirectory('custom',{DUREBAK_DATA_DIR:'env',XDG_DATA_HOME:'xdg'},home),resolve('custom'));
  assert.equal(dataDirectory(undefined,{DUREBAK_DATA_DIR:'env',XDG_DATA_HOME:'xdg'},home),resolve('env'));
  assert.equal(dataDirectory(undefined,{XDG_DATA_HOME:join(home,'xdg')},home),join(home,'xdg','durebak'));
});
test('existing legacy data stays discoverable and ambiguous defaults require an explicit choice',t=>{
  const home=mkdtempSync(join(tmpdir(),'durebak-legacy-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const legacy=join(home,'.local','share','durebak'),current=join(home,'.durebak');
  mkdirSync(legacy,{recursive:true});writeFileSync(join(legacy,'runtime.sqlite'),'fixture');
  assert.equal(dataDirectory(undefined,{},home),legacy);
  mkdirSync(current);writeFileSync(join(current,'runtime.sqlite'),'fixture');
  assert.throws(()=>dataDirectory(undefined,{},home),/ambiguous_data_directory/);
  assert.equal(dataDirectory(current,{},home),current);
});

test('managed storage rejects directory symlinks and contains untrusted identifiers',async t=>{
  const {symlinkSync,readdirSync,statSync}=await import('node:fs');
  const {managedCredentialPath,managedRecordPath}=await import('../src/paths.js');
  const root=mkdtempSync(join(tmpdir(),'durebak-path-boundary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const data=join(root,'data'),outside=join(root,'outside');mkdirSync(outside,{mode:0o700});
  const record=managedRecordPath(data,'../../outside','../../secret','snapshot');
  assert.ok(record.startsWith(join(data,'records')+'/'));assert.ok(!record.slice(data.length).includes('..'));
  assert.equal(statSync(data).mode&0o777,0o700);
  symlinkSync(outside,join(data,'credentials'),'dir');
  assert.throws(()=>managedCredentialPath(data),/unsafe_data_directory/);
  const other=join(root,'other');mkdirSync(other,{mode:0o700});symlinkSync(outside,join(other,'records'),'dir');
  assert.throws(()=>managedRecordPath(other,'workspace','task','snapshot'),/unsafe_data_directory/);
  assert.deepEqual(readdirSync(outside),[]);
});
