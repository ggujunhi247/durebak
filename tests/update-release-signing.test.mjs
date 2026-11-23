import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import test from 'node:test';
import {signUpdateRelease} from '../scripts/sign-update-release.mjs';
import {verifyUpdateManifest} from '../dist/update-trust.js';
import {schemaVersion} from '../dist/migrations.js';
import {protocolVersion} from '../dist/version.js';
import {downloadVerifiedUpdate} from '../dist/update-download.js';

test('release signing binds the exact tarball, compatibility and release coordinates',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const keyId=createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
 const bytes=Buffer.from('synthetic artifact');
 const issuedAt=1000;
 const release={version:'0.1.0-alpha.28',minUpdater:'0.1.0-alpha.27',schema:schemaVersion,protocol:protocolVersion,issuedAt};
 const manifests=signUpdateRelease(bytes,release,privateKey);
 assert.deepEqual(Object.keys(manifests),['darwin-x64','darwin-arm64','linux-x64','linux-arm64']);
 const context={current:release.minUpdater,channel:'alpha',platform:'linux',arch:'x64',schema:schemaVersion,protocol:protocolVersion,now:issuedAt};
 const envelope=manifests['linux-x64'];
 assert.equal(envelope.key_id,keyId);
 const result=verifyUpdateManifest(envelope,{[keyId]:publicKey},context);
 assert.equal(result.artifact.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(result.artifact.bytes,bytes.length);
 assert.throws(()=>verifyUpdateManifest(manifests['darwin-x64'],{[keyId]:publicKey},context),/incompatible_update_manifest/);
 const altered=Buffer.from(envelope.payload,'base64'); altered[0]^=1;
 assert.throws(()=>verifyUpdateManifest({...envelope,payload:altered.toString('base64')},{[keyId]:publicKey},context),/invalid_update_signature/);
});

test('download verifies the signed release and exact npm artifact before returning bytes',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const bytes=Buffer.from('a verified tarball');
 const target='0.1.0-alpha.28', current='0.1.0-alpha.27';
 const release={version:target,minUpdater:current,schema:schemaVersion,protocol:protocolVersion,issuedAt:1000};
 const envelope=signUpdateRelease(bytes,release,privateKey)['linux-x64'];
 const options={current,channel:'alpha',platform:'linux',arch:'x64',schema:schemaVersion,protocol:protocolVersion,now:1000};
 const keys={[envelope.key_id]:publicKey};
 const cdn='https://release-assets.githubusercontent.com/release-asset';
 function fixture(artifact,redirect=cdn,registryBytes=bytes){
  return async (url,init)=>{
   assert.equal(init.redirect,'manual');
   assert.equal(init.credentials,'omit');
   if(url.endsWith('/update-linux-x64.json'))return Response.json(envelope);
   if(url===`https://registry.npmjs.org/durebak/${target}`)return Response.json({name:'durebak',version:target,dist:{tarball:`https://registry.npmjs.org/durebak/-/durebak-${target}.tgz`,integrity:'sha512-'+createHash('sha512').update(registryBytes).digest('base64')}});
   if(url.startsWith('https://github.com/'))return Response.redirect(redirect);
   assert.equal(url,cdn);
   return new Response(artifact);
  };
 }
 assert.deepEqual(await downloadVerifiedUpdate(target,keys,options,fixture(bytes)),bytes);
 await assert.rejects(downloadVerifiedUpdate(target,keys,options,fixture(Buffer.alloc(bytes.length))),/update_artifact_digest_mismatch/);
 await assert.rejects(downloadVerifiedUpdate(target,keys,options,fixture(bytes,cdn,Buffer.alloc(bytes.length))),/update_artifact_digest_mismatch/);
 await assert.rejects(downloadVerifiedUpdate(target,keys,options,fixture(bytes,'https://example.org/')),/unsafe_update_redirect/);
});
