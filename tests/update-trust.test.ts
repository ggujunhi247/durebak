import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyUpdateManifest,automaticUpdateBlockers} from '../src/update-trust.js';
const now=1800000000000;
const expected={current:'0.1.0-alpha.23',channel:'alpha' as const,platform:'linux',arch:'x64',schema:13,protocol:1,now};
const payload={schema:1,package:'durebak',version:'0.1.0-alpha.24',channel:'alpha',platform:'linux',arch:'x64',min_updater:'0.1.0-alpha.23',database_schema:13,protocol:1,issued_at:now-1000,expires_at:now+60000,artifact:{url:'https://github.com/ggujunhi247/durebak/releases/download/v0.1.0-alpha.24/durebak-0.1.0-alpha.24.tgz',sha256:'a'.repeat(64),bytes:1000}};
function fixture(data:unknown=payload){const {privateKey,publicKey}=generateKeyPairSync('ed25519');const bytes=Buffer.from(JSON.stringify(data));return {envelope:{key_id:'test',payload:bytes.toString('base64'),signature:sign(null,bytes,privateKey).toString('base64')},keys:{test:publicKey}};}
test('valid pinned-key manifest returns only verified release fields',()=>{
 const f=fixture();const verified=verifyUpdateManifest(f.envelope,f.keys,expected);assert.equal(verified.version,'0.1.0-alpha.24');assert.equal(verified.artifact.bytes,1000);
});
test('tampered, unknown-key and expired manifests cannot authorize an update',()=>{
 const f=fixture();assert.throws(()=>verifyUpdateManifest({...f.envelope,payload:Buffer.from('{}').toString('base64')},f.keys,expected),/invalid_update_signature/);
 assert.throws(()=>verifyUpdateManifest(f.envelope,{},expected),/unknown_update_key/);
 for(const changes of [{expires_at:now-1},{issued_at:now+1},{expires_at:now+604800001},{channel:'stable'},{platform:'darwin'},{database_schema:14},{protocol:2},{version:'0.1.0-alpha.22'},{min_updater:'0.1.0-alpha.24'},{artifact:{...payload.artifact,url:'https://attacker.invalid/file'}}]){
  const changed=fixture({...payload,...changes});assert.throws(()=>verifyUpdateManifest(changed.envelope,changed.keys,expected));
 }
});
test('production automatic apply remains blocked without trust and maintenance/recovery proof',()=>{
 const blockers=automaticUpdateBlockers('linux');assert.ok(blockers.includes('release_trust_not_configured'));assert.ok(blockers.includes('maintenance_gate_unavailable'));assert.ok(blockers.includes('recovery_worker_unavailable'));
 assert.ok(automaticUpdateBlockers('win32').includes('unsupported_storage_platform'));
});
