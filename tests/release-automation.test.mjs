import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {channelForTag, assertRegistryArtifact, publishVerified} from '../scripts/publish-release.mjs';

test('automatic release derives only supported version channels',()=>{
 for(const [tag,channel] of [['v1.2.3','latest'],['v1.2.3-alpha.4','alpha'],['v1.2.3-beta.2','beta'],['v1.2.3-rc.1','rc']])assert.equal(channelForTag(tag),channel);
 for(const tag of ['v1.2.3-dev.1','v1.2.3;echo x','main','v1.2.3-alpha'])assert.throws(()=>channelForTag(tag));
});
const bytes=Buffer.from('verified package');
const dist={integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`,tarball:'https://registry.npmjs.org/durebak/-/durebak-1.2.3.tgz'};
test('registry verification rejects changed bytes and absent integrity',()=>{
 assert.doesNotThrow(()=>assertRegistryArtifact(bytes,dist));
 assert.throws(()=>assertRegistryArtifact(Buffer.from('changed'),dist),/registry_artifact_mismatch/);
 assert.throws(()=>assertRegistryArtifact(bytes,{}),/registry_integrity_required/);
});
test('a retry skips publication only when the existing registry tarball matches',async()=>{
 let publishes=0;
 const result=await publishVerified({bytes,readDist:async()=>dist,publish:async()=>publishes++,download:async()=>bytes});
 assert.equal(publishes,0);assert.equal(result,'already_published');
 await assert.rejects(publishVerified({bytes,readDist:async()=>dist,publish:async()=>publishes++,download:async()=>Buffer.from('changed')}),/registry_tarball_mismatch/);
 assert.equal(publishes,0);
});
test('new publication verifies metadata and downloaded bytes after publish',async()=>{
 let reads=0,publishes=0;
 const result=await publishVerified({bytes,readDist:async()=>++reads===1?null:dist,publish:async()=>publishes++,download:async()=>bytes});
 assert.equal(result,'published');assert.equal(publishes,1);
 await assert.rejects(publishVerified({bytes,readDist:async()=>null,publish:async()=>{},download:async()=>bytes}),/registry_version_missing/);
});
test('registry outages stop publication instead of being treated as a missing version',async()=>{
 let publishes=0;
 await assert.rejects(publishVerified({bytes,readDist:async()=>{throw new Error('network_failure');},publish:async()=>publishes++,download:async()=>bytes}),/network_failure/);
 assert.equal(publishes,0);
});
